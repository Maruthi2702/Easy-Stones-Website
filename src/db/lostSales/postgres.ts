/**
 * Lost sales on Postgres, answering in MongoDB's shape (lostSaleDoc.ts). A save builds the
 * record as MongoDB would hold it (same defaults, trimming and checks), then makes its row
 * with the copy's own builder (lostSaleRowOf), so it writes what a re-copy of MongoDB would.
 */
import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { lostSales } from '../schema/misc.ts';
import { locations } from '../schema/reference.ts';
import { customers } from '../schema/customers.ts';
import { lostSaleRowOf } from '../copy/miscRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import { lostSaleDoc } from './lostSaleDoc.ts';
import { REASONS, validationError } from './rules.ts';
import type { Loose } from '../../types/records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const select = (db: Db | Tx) => (db as Db).select({ r: lostSales, locationName: locations.name })
  .from(lostSales).leftJoin(locations, eq(locations.id, lostSales.locationId));

/** Same rule as MongoDB's: '*' sees all; otherwise the assigned branches, plus a record with no branch. */
const visibleTo = (assigned: readonly string[]): SQL | undefined => (assigned.includes('*') ? undefined
  : or(isNull(lostSales.locationId), inArray(locations.name, [...assigned])));

export async function listLostSales(db: Db, assigned: readonly string[]): Promise<Loose[]> {
  const rows = await select(db).where(visibleTo(assigned)).orderBy(desc(lostSales.lostAt), desc(lostSales.createdAt), desc(lostSales.id));
  return rows.map(x => lostSaleDoc(x.r, x.locationName));
}

async function rowFor(tx: Db | Tx, doc: Loose) {
  const ref = await referenceIndexOf(tx as Db);
  const wanted = typeof doc.customerId === 'string' ? doc.customerId.toLowerCase() : '';
  const found = /^[0-9a-f]{24}$/.test(wanted)
    ? await (tx as Db).select({ id: customers.id }).from(customers).where(eq(customers.id, wanted)) : [];
  const row = lostSaleRowOf(doc, ref, { customerIds: new Set(found.map(f => f.id)) }, []);
  if (!row) throw new Error('That lost sale can’t be stored: it has no id.');
  return row;
}

/** What Mongoose's schema does on a save: trim the two names, default what is missing, refuse a missing name or a reason off the list. */
function schemaChecked(doc: Loose, partial: boolean): Loose {
  const out = { ...doc };
  for (const k of ['customerName', 'productName']) if (typeof out[k] === 'string') out[k] = out[k].trim();
  const problems: string[] = [];
  for (const k of ['customerName', 'productName']) if (!partial ? !out[k] : (k in out && !out[k])) problems.push(`${k}: Path \`${k}\` is required.`);
  if (out.reason !== undefined && !REASONS.includes(out.reason)) problems.push(`reason: \`${out.reason}\` is not a valid enum value for path \`reason\`.`);
  if (problems.length) throw validationError(problems, partial);
  return out;
}

export async function createLostSale(db: Db, doc: Loose): Promise<Loose> {
  const now = new Date();
  const full = schemaChecked({
    lengthInches: 0, widthInches: 0, sfPerSlab: 0, slabsCount: 1, totalSf: 0, pricePerSf: 0, totalLostValue: 0,
    reason: 'Out of Stock', location: 'Seattle', competitorName: '', notes: '', salesRepName: '', salesRepId: null,
    customerId: null, productId: null, date: now, ...doc, createdAt: now, updatedAt: now
  }, false);
  return db.transaction(async tx => {
    const row = await rowFor(tx, full);
    await tx.insert(lostSales).values(row);
    const [saved] = await select(tx).where(eq(lostSales.id, row.id));
    return lostSaleDoc(saved.r, saved.locationName);
  });
}

export async function updateLostSale(db: Db, id: string, assigned: readonly string[], set: Loose): Promise<Loose | null> {
  const defined = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
  const checked = schemaChecked(defined, true);
  return db.transaction(async tx => {
    const [found] = await select(tx).where(and(eq(lostSales.id, id.toLowerCase()), visibleTo(assigned))).for('update', { of: lostSales });
    if (!found) return null;
    const doc = { ...lostSaleDoc(found.r, found.locationName), ...checked, updatedAt: new Date() };
    const row = await rowFor(tx, doc);
    const { id: _id, createdAt: _created, ...columns } = row;
    await tx.update(lostSales).set(columns).where(eq(lostSales.id, found.r.id));
    const [saved] = await select(tx).where(eq(lostSales.id, found.r.id));
    return lostSaleDoc(saved.r, saved.locationName);
  });
}

export async function deleteLostSale(db: Db, id: string, assigned: readonly string[]): Promise<boolean> {
  const rows = await select(db).where(and(eq(lostSales.id, id.toLowerCase()), visibleTo(assigned)));
  if (!rows.length) return false;
  await db.delete(lostSales).where(eq(lostSales.id, rows[0].r.id));
  return true;
}
