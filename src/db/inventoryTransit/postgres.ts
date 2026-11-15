/**
 * In-transit shipments on Postgres, answering in MongoDB's shape (shipmentDoc.ts). An import
 * builds each shipment, event and the report as MongoDB would hold them, then makes their rows
 * with the copy's own builder (inventoryRows), so it writes what a re-copy of MongoDB would.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { inventoryTransitShipments, inventoryTransitLines, inventoryTransitReports, inventoryTransitEvents, inventoryRevision } from '../schema/inventory.ts';
import { inventoryRows, type InventorySource } from '../copy/inventoryRows.ts';
import { newId } from '../ids.ts';
import { transitSignature } from '../../purchasing/transitSignature.ts';
import { shipmentDoc } from './shipmentDoc.ts';
import type { Loose } from '../../types/records.ts';
import type { TransitPublish, TransitPublished } from './types.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ShipmentRow = typeof inventoryTransitShipments.$inferSelect;
type LineRow = typeof inventoryTransitLines.$inferSelect;

const CHUNK = 400;

const EMPTY: InventorySource = {
  inventoryItems: [], inventorySalesRecords: [], inventoryTransitShipments: [], inventoryTransitReports: [],
  inventoryTransitEvents: [], inventoryRevision: [], inventoryStockImports: [], inventoryStockBackups: [], inventoryStockState: []
};

/** The copy's own rows for these documents; a document the copy would skip is an error here. */
function rowsOf(part: Partial<InventorySource>) {
  const problems: { reason?: string }[] = [];
  const rows = inventoryRows({ ...EMPTY, ...part }, problems as never);
  const bad = (problems as { action?: string; reason?: string }[]).find(p => p.action === 'skipped');
  if (bad) throw new Error(`That transit record can’t be stored: ${bad.reason ?? 'unreadable'}`);
  return rows;
}

async function withLines(db: Db | Tx, rows: ShipmentRow[]): Promise<Loose[]> {
  if (!rows.length) return [];
  const lines: LineRow[] = [];
  for (let i = 0; i < rows.length; i += 5000) {
    lines.push(...await (db as Db).select().from(inventoryTransitLines)
      .where(inArray(inventoryTransitLines.shipmentId, rows.slice(i, i + 5000).map(r => r.id))).orderBy(asc(inventoryTransitLines.position)));
  }
  const by = new Map<string, LineRow[]>();
  for (const l of lines) (by.get(l.shipmentId) ?? by.set(l.shipmentId, []).get(l.shipmentId)!).push(l);
  return rows.map(r => shipmentDoc(r, by.get(r.id) ?? []));
}

// "C" collation: MongoDB sorts text by bytes, so '10' < '9' < 'a' here too.
const bytes = (col: unknown) => sql`${col} COLLATE "C"`;

export async function listActiveShipments(db: Db): Promise<Loose[]> {
  const rows = await db.select().from(inventoryTransitShipments).where(eq(inventoryTransitShipments.active, true))
    .orderBy(asc(bytes(inventoryTransitShipments.poNumber)), asc(bytes(inventoryTransitShipments.containerNumber)), asc(bytes(inventoryTransitShipments.location)));
  return withLines(db, rows);
}

export async function findShipmentsByPo(db: Db, po: string): Promise<Loose[]> {
  const rows = await db.select().from(inventoryTransitShipments)
    .where(sql`lower(btrim(${inventoryTransitShipments.poNumber}, E' \t\r\n\f\v')) = ${po.toLowerCase()}`)
    .orderBy(desc(inventoryTransitShipments.active), sql`${inventoryTransitShipments.importedAt} DESC NULLS LAST`, asc(inventoryTransitShipments.id))
    .limit(50);
  return withLines(db, rows);
}

/** The line fields Mongoose's schema keeps (it drops anything else). */
const LINE_FIELDS = ['product', 'sku', 'poNumber', 'containerNumber', 'location', 'poDate', 'poEtaDate', 'supplierSoNumber', 'siplNumber',
  'slabs', 'quantity', 'units', 'supplier', 'freightForwarder', 'shipDate', 'portEtaDate', 'etaDate', 'vessel', 'customerReference',
  'supplierPurchaseNote', 'status'];
const lineOf = (l: Loose) => Object.fromEntries(LINE_FIELDS.filter(k => l[k] !== undefined).map(k => [k, l[k]]));

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

export async function publishTransit(db: Db, { importId, importedAt, shipments, coverage, complete, sourceFilename, sourceHash, importedByName }: TransitPublish): Promise<TransitPublished> {
  return db.transaction(async tx => {
    // The inventory's publication counter, taken first: it also queues two imports one after the other (as MongoDB's transaction does).
    await tx.insert(inventoryRevision).values({ id: 'inventory', revision: 1 })
      .onConflictDoUpdate({ target: inventoryRevision.id, set: { revision: sql`${inventoryRevision.revision} + 1` } });

    const previousRows = coverage.length ? await tx.select().from(inventoryTransitShipments).where(inArray(inventoryTransitShipments.location, coverage)) : [];
    const previous = await withLines(tx, previousRows);
    const identity = (s: { poNumber: string; containerNumber: string; location: string }) => JSON.stringify([s.poNumber, s.containerNumber, s.location]);
    const prior = new Map(previous.map(s => [identity(s as never), s]));
    const present = new Set(shipments.map(identity));
    const now = new Date();

    const docs: Loose[] = [], events: Loose[] = [];
    for (const shipment of shipments) {
      const before = prior.get(identity(shipment)), signature = transitSignature(shipment);
      const keepConfirmation = before?.active !== false && before?.confirmedSignature === signature;
      const doc: Loose = {
        ...(before ?? { _id: newId(), createdAt: now }),
        poNumber: shipment.poNumber, containerNumber: shipment.containerNumber, location: shipment.location,
        lines: shipment.lines.map(lineOf),
        active: true, reportId: importId, sourceSignature: signature, importedAt, importedByName,
        ...(keepConfirmation ? {} : { usableReceiptDate: null, receiptConfirmedAt: null, receiptConfirmedBy: '', confirmedSignature: '' }),
        inactiveReason: undefined, inactiveAt: undefined, updatedAt: now
      };
      docs.push(doc);
      events.push({ _id: newId(), shipmentId: doc._id, reportId: importId, action: 'reported', at: importedAt, actor: importedByName, snapshot: shipment });
    }
    const withdrawn = complete ? previous.filter(s => s.active !== false && !present.has(identity(s as never))) : [];
    for (const s of withdrawn) {
      docs.push({ ...s, active: false, inactiveReason: 'not-reported', inactiveAt: importedAt, updatedAt: now });
      events.push({ _id: newId(), shipmentId: s._id, reportId: importId, action: 'not-reported', at: importedAt, actor: importedByName, snapshot: s });
    }

    const rows = rowsOf({ inventoryTransitShipments: docs, inventoryTransitEvents: events,
      inventoryTransitReports: [{ _id: importId, branches: coverage, complete, sourceFilename, sourceHash, importedAt, importedByName,
        lineCount: shipments.reduce((n, s) => n + s.lines.length, 0), shipmentCount: shipments.length, withdrawnCount: withdrawn.length }] });

    const known = new Set(previousRows.map(r => r.id));
    const touched = rows.inventoryTransitShipments;
    await insertChunks(touched.filter(r => !known.has(r.id)), c => tx.insert(inventoryTransitShipments).values(c));
    for (const r of touched.filter(r => known.has(r.id))) {
      const { id, createdAt: _created, ...columns } = r;
      await tx.update(inventoryTransitShipments).set(columns).where(eq(inventoryTransitShipments.id, id));
    }
    // A shipment's lines are replaced whole by the import; a withdrawn one keeps its own.
    const replaced = new Set(shipments.map(s => (prior.get(identity(s))?._id as string | undefined)).filter((x): x is string => !!x));
    const newOnes = new Set(touched.filter(r => !known.has(r.id)).map(r => r.id));
    const reported = new Set(docs.slice(0, shipments.length).map(d => d._id as string));
    for (const id of reported) if (replaced.has(id)) await tx.delete(inventoryTransitLines).where(eq(inventoryTransitLines.shipmentId, id));
    await insertChunks(rows.inventoryTransitLines.filter(l => reported.has(l.shipmentId) && (replaced.has(l.shipmentId) || newOnes.has(l.shipmentId))),
      c => tx.insert(inventoryTransitLines).values(c));
    await insertChunks(rows.inventoryTransitEvents, c => tx.insert(inventoryTransitEvents).values(c));
    await tx.insert(inventoryTransitReports).values(rows.inventoryTransitReports);
    return { importId, importedAt, shipmentCount: shipments.length, withdrawnCount: withdrawn.length };
  });
}

const activeAt = (branches: string[]) => and(eq(inventoryTransitShipments.active, true), inArray(inventoryTransitShipments.location, branches));

/** Purchasing: the shipments still in transit at these branches, in id order. */
export async function shipmentsForBranches(db: Db, branches: string[]): Promise<Loose[]> {
  if (!branches.length) return [];
  const rows = await db.select().from(inventoryTransitShipments).where(activeAt(branches)).orderBy(asc(bytes(inventoryTransitShipments.id)));
  return withLines(db, rows);
}

/** Purchasing: the one active shipment at these branches a receiving date may be confirmed for. */
export async function findShipmentForReceipt(db: Db, id: string, branches: string[]): Promise<Loose | null> {
  if (!branches.length) return null;
  const rows = await db.select().from(inventoryTransitShipments).where(and(eq(inventoryTransitShipments.id, id), activeAt(branches))).limit(1);
  return (await withLines(db, rows))[0] ?? null;
}

/** Purchasing: save the confirmed receiving date and its history line, together. */
export async function saveReceiptConfirmation(db: Db, shipment: Loose, { date, signature, at, by }: { date: string; signature: string; at: Date; by: string }): Promise<void> {
  await db.transaction(async tx => {
    const id = String(shipment._id);
    await tx.update(inventoryTransitShipments).set({
      usableReceiptDate: new Date(date), receiptConfirmedAt: at, receiptConfirmedBy: by, confirmedSignature: signature, updatedAt: new Date()
    }).where(eq(inventoryTransitShipments.id, id));
    await tx.insert(inventoryTransitEvents).values({ id: newId(), shipmentId: id, at, actor: by, action: 'receipt-confirmed', snapshot: { date, signature } });
  });
}
