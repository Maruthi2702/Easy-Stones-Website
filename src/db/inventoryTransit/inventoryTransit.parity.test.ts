/**
 * In-transit shipments, through the data layer and the real Inventory Analysis router: each
 * request run on MongoDB, then on Postgres, must answer the same and leave the same records
 * behind (Postgres' rows are compared with what the copy makes of MongoDB's — inventoryRows
 * is the spec). Ids MongoDB makes for itself can't match Postgres', so shipments are matched
 * by PO / container / branch and events by their shipment.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { asc } from 'drizzle-orm';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import InventoryTransitShipment from '../../models/InventoryTransitShipment.ts';
import InventoryTransitReport, { InventoryTransitEvent } from '../../models/InventoryTransitReport.ts';
import InventoryRevision from '../../models/InventoryRevision.ts';
import { inventoryRows, type InventorySource } from '../copy/inventoryRows.ts';
import { inventoryTransitShipments, inventoryTransitLines, inventoryTransitEvents, inventoryTransitReports, inventoryRevision } from '../schema/inventory.ts';
import { publishTransit, findShipmentsByPo } from './index.ts';
import { publishTransitReport } from '../../services/inventoryTransitImport.ts';
import createRouter from '../../routes/inventoryAnalysis.ts';
import type { TransitShipment, TransitLine } from '../../types/inventory.ts';
import type { Loose } from '../../types/records.ts';

let t: WriteParity;
let app: express.Express;

const line = (over: Partial<TransitLine> = {}): TransitLine => ({
  product: 'Carrara Prima Select 3CM', sku: 'CPS3', poNumber: 'P1', poDate: new Date('2026-09-01T07:00:00Z'), poEtaDate: null,
  supplierSoNumber: 'SO1', siplNumber: '', slabs: 31, quantity: 2237.89, units: 'SF', location: 'Richmond', supplier: 'Rossi',
  freightForwarder: 'FF', shipDate: new Date('2026-10-01T07:00:00Z'), portEtaDate: null, etaDate: new Date('2026-11-24T08:00:00Z'),
  containerNumber: 'C1', vessel: 'MSC', customerReference: '', supplierPurchaseNote: '', status: 'INTRANSIT', ...over
});
const ship = (po: string, container: string, location = 'Richmond', lines: Partial<TransitLine>[] = [{}, { slabs: 21, quantity: 1515.99 }]): TransitShipment => ({
  poNumber: po, containerNumber: container, location,
  lines: lines.map(l => line({ poNumber: po, containerNumber: container, location, ...l }))
});
const base = { sourceFilename: 'SPS.xls', sourceHash: 'abc', importedByName: 'Krish', complete: true };

beforeAll(async () => {
  t = await openWriteParity(async () => {}, 'DB_INVENTORY_TRANSIT');
  app = express();
  app.use(express.json());
  app.use(createRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = { id: 'u1', username: 'krish', permissions: [] }; next(); },
    requirePermission: () => (_req: Loose, _res: Loose, next: () => void) => next(),
    uploadMemory: multer({ storage: multer.memoryStorage() })
  } as never));
}, 240000);
afterAll(async () => { await t?.close(); });

let n = 0;
/** One report on each database (the same id and moment). */
async function publish(shipments: TransitShipment[], branches: string[], over: Partial<typeof base> = {}) {
  const importId = `import-${++n}`, importedAt = new Date('2026-11-10T17:30:00.000Z');
  const args = { importId, importedAt, shipments, coverage: branches, ...base, ...over };
  const { mongo, postgres } = await t.both(() => publishTransit(args));
  expect(normalize(postgres)).toEqual(normalize(mongo));
  await expectSameRows();
  return mongo;
}

/** Rows keyed by what they are, not by the ids each database made. */
function canon(r: ReturnType<typeof inventoryRows> | { s: Loose[]; l: Loose[]; e: Loose[]; r: Loose[] }) {
  const rows = 's' in r ? r : { s: r.inventoryTransitShipments as Loose[], l: r.inventoryTransitLines as Loose[], e: r.inventoryTransitEvents as Loose[], r: r.inventoryTransitReports as Loose[] };
  const key = new Map(rows.s.map(x => [x.id as string, JSON.stringify([x.poNumber, x.containerNumber, x.location])]));
  const sort = (a: Loose[], f: (x: Loose) => string) => [...a].sort((x, y) => f(x).localeCompare(f(y)));
  return normalize({
    shipments: sort(rows.s.map(x => ({ ...x, id: key.get(x.id) })), x => x.id),
    lines: sort(rows.l.map(x => ({ ...x, shipmentId: key.get(x.shipmentId) })), x => `${x.shipmentId}${String(x.position).padStart(4, '0')}`),
    events: sort(rows.e.map(x => {
      const { _id, __v, ...snapshot } = (x.snapshot ?? {}) as Loose;
      return { ...x, id: undefined, shipmentId: key.get(x.shipmentId), snapshot: x.snapshot ? snapshot : null };
    }), x => `${x.shipmentId}${x.action}${x.reportId}`),
    reports: sort(rows.r, x => x.id)
  });
}

async function expectSameRows() {
  const source: InventorySource = {
    inventoryItems: [], inventorySalesRecords: [], inventoryTransitShipments: await InventoryTransitShipment.find().lean() as Loose[],
    inventoryTransitReports: await InventoryTransitReport.find().lean() as Loose[], inventoryTransitEvents: await InventoryTransitEvent.find().lean() as Loose[],
    inventoryRevision: [], inventoryStockImports: [], inventoryStockBackups: [], inventoryStockState: []
  };
  const built = inventoryRows(source, []);
  const db = t.pg.db;
  const pgRows = {
    s: await db.select().from(inventoryTransitShipments).orderBy(asc(inventoryTransitShipments.id)) as Loose[],
    l: await db.select().from(inventoryTransitLines) as Loose[],
    e: await db.select().from(inventoryTransitEvents) as Loose[],
    r: await db.select().from(inventoryTransitReports) as Loose[]
  };
  expect(canon(pgRows)).toEqual(canon(built));
  const rev = await db.select().from(inventoryRevision);
  expect(rev[0]?.revision ?? 0).toBe((await InventoryRevision.findById('inventory').lean())?.revision ?? 0);
}

describe('publishing a report', () => {
  it('stores the shipments, their lines in order, an event each and the report; a second one updates in place', async () => {
    const first = await publish([ship('15364', 'TEMU1', 'Richmond'), ship('P2', 'CONT2', 'Richmond')], ['Richmond']);
    expect(first.shipmentCount).toBe(2);
    await publish([ship('15364', 'TEMU1', 'Richmond', [{ slabs: 30 }, { slabs: 21 }, { slabs: 4, status: 'INTRANSIT ETA 11/30' }])], ['Richmond']);
  });

  it('a complete report withdraws what it no longer lists, and a later one brings it back', async () => {
    const out = await publish([ship('P2', 'CONT2', 'Richmond')], ['Richmond']);
    expect(out.withdrawnCount).toBe(1);
    await publish([ship('P2', 'CONT2', 'Richmond'), ship('15364', 'TEMU1', 'Richmond')], ['Richmond']);
  });

  it('a partial report keeps the unlisted ones, and other branches are left alone', async () => {
    await publish([ship('P3', 'CONT3', 'Seattle')], ['Seattle'], { complete: false });
    const out = await publish([ship('P4', 'CONT4', 'Richmond')], ['Richmond'], { complete: false });
    expect(out.withdrawnCount).toBe(0);
    await publish([ship('P5', 'CONT5', 'Seattle')], ['Seattle', 'Richmond'], { complete: true, sourceFilename: '' });
  });

  it('an empty complete report clears its branch', async () => {
    await publish([], ['Seattle']);
  });

  it('a confirmed receipt is kept while the shipment is unchanged and cleared when it changes', async () => {
    const { transitSignature } = await import('../../purchasing/transitSignature.ts');
    const same = ship('P6', 'CONT6', 'Spokane');
    await publish([same], ['Spokane']);
    await InventoryTransitShipment.updateOne({ poNumber: 'P6' }, { $set: { usableReceiptDate: new Date('2026-12-01T08:00:00Z'), receiptConfirmedAt: new Date('2026-11-10T17:00:00Z'),
      receiptConfirmedBy: 'Dee', confirmedSignature: transitSignature(same) } });
    await t.resync();
    await publish([same], ['Spokane']);
    const mongoKept = await InventoryTransitShipment.findOne({ poNumber: 'P6' }).lean();
    expect(mongoKept!.receiptConfirmedBy).toBe('Dee');
    await publish([ship('P6', 'CONT6', 'Spokane', [{ slabs: 99 }])], ['Spokane']);
    expect((await InventoryTransitShipment.findOne({ poNumber: 'P6' }).lean())!.receiptConfirmedBy).toBe('');
  });

  it('the service refuses a branch the report does not cover, on both', async () => {
    const send = () => publishTransitReport({ shipments: [ship('P7', 'CONT7', 'Seattle')], branches: ['Richmond'], complete: true }).then(() => 'ok', (e: Error) => e.message);
    const { mongo, postgres } = await t.both(send);
    expect(postgres).toBe(mongo);
    expect(mongo).toMatch(/branches covered/);
  });
});

describe('reading', () => {
  it('lists the active shipments in PO order, with their lines, through the route', async () => {
    await publish([ship('9', 'B', 'Richmond'), ship('10', 'A', 'Richmond'), ship('9', 'A', 'Richmond')], ['Richmond']);
    const { mongo, postgres } = await t.both(async () => { const r = await request(app).get('/in-transit'); return { status: r.status, body: r.body }; });
    expect(postgres.status).toBe(200);
    const noIds = (b: Loose) => normalize(b.shipments.map(({ _id, ...rest }: Loose) => rest));
    expect(noIds(postgres.body)).toEqual(noIds(mongo.body));
    // Byte order, not numeric: '10' before '9'; other branches' shipments from the tests above follow.
    expect(mongo.body.shipments.map((s: Loose) => `${s.poNumber}/${s.containerNumber}`).slice(0, 3)).toEqual(['10/A', '9/A', '9/B']);
    expect(mongo.body.shipments[0].lines).toHaveLength(2);
    expect(mongo.body.shipments[0].lines[0].etaDate).toBe('2026-11-24T08:00:00.000Z');
  });

  it('finds a PO # whatever the capitals or blanks, active first', async () => {
    await publish([ship(' ab-12 ', 'C1', 'Richmond'), ship('AB-12', 'C2', 'Seattle')], ['Richmond', 'Seattle'], { complete: false });
    for (const po of ['AB-12', 'ab-12', 'nothing', 'AB.12']) {
      const { mongo, postgres } = await t.both(() => findShipmentsByPo(po));
      const noIds = (rows: Loose[]) => normalize(rows.map(({ _id, ...rest }) => rest));
      expect(noIds(postgres)).toEqual(noIds(mongo));
      if (po === 'AB-12') expect(mongo.map(s => s.active)).toEqual([true, true]);
    }
  });
});
