/**
 * Payments received on Postgres, answering in MongoDB's shape (paymentDoc.ts). A save
 * builds the payment as MongoDB would hold it, then makes its rows with the copy's own
 * builder (paymentRowsOf), so it writes what a re-copy of MongoDB would.
 */
import { and, eq, inArray, isNull, asc } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { paymentsReceived, paymentHistory } from '../schema/operations.ts';
import { locations } from '../schema/reference.ts';
import { customers } from '../schema/customers.ts';
import { paymentRowsOf } from '../copy/operationsRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import { paymentDoc } from './paymentDoc.ts';
import type { Loose } from '../../types/records.ts';
import type { PaymentFigure, PaymentHistoryEntry } from './types.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const withHistory = async (db: Db | Tx, rows: { p: typeof paymentsReceived.$inferSelect; locationName: string | null }[]): Promise<Loose[]> => {
  if (!rows.length) return [];
  const lines = await (db as Db).select().from(paymentHistory).where(inArray(paymentHistory.paymentId, rows.map(r => r.p.id)));
  return rows.map(r => paymentDoc(r.p, r.locationName, lines.filter(l => l.paymentId === r.p.id)));
};

const selectPayments = (db: Db | Tx) => (db as Db).select({ p: paymentsReceived, locationName: locations.name })
  .from(paymentsReceived).leftJoin(locations, eq(locations.id, paymentsReceived.locationId));

export async function listPayments(db: Db, names: readonly string[], date: string): Promise<Loose[]> {
  if (!names.length) return [];
  const rows = await selectPayments(db).where(and(inArray(locations.name, [...names]), eq(paymentsReceived.day, date)))
    .orderBy(asc(paymentsReceived.createdAt), asc(paymentsReceived.id));
  return withHistory(db, rows);
}

export async function findPayment(db: Db, id: string): Promise<Loose | null> {
  const rows = await selectPayments(db).where(eq(paymentsReceived.id, id.toLowerCase()));
  return (await withHistory(db, rows))[0] ?? null;
}

export async function paymentFigures(db: Db, location: string, date: string, live: boolean): Promise<PaymentFigure[]> {
  const rows = await selectPayments(db).where(and(eq(locations.name, location), eq(paymentsReceived.day, date),
    live ? isNull(paymentsReceived.voidedAt) : undefined));
  return rows.map(r => ({ method: r.p.method, cents: r.p.cents, voidedAt: r.p.voidedAt }));
}

/** Rows for a payment as MongoDB would hold it; the customer link is kept only if that customer exists. */
async function rowsFor(tx: Db | Tx, doc: Loose) {
  const ref = await referenceIndexOf(tx as Db);
  const wanted = typeof doc.customerId === 'string' ? doc.customerId.toLowerCase() : '';
  const found = /^[0-9a-f]{24}$/.test(wanted)
    ? await (tx as Db).select({ id: customers.id }).from(customers).where(eq(customers.id, wanted)) : [];
  const built = paymentRowsOf(doc, ref, { customerIds: new Set(found.map(f => f.id)) }, []);
  if (!built) throw new Error('That payment can’t be stored: it has no branch, day, method or amount.');
  return built;
}

export async function addPayment(db: Db, id: string, location: string, value: Loose, by: string, at: Date): Promise<Loose | null> {
  return db.transaction(async tx => {
    const [taken] = await tx.select({ id: paymentsReceived.id }).from(paymentsReceived).where(eq(paymentsReceived.id, id.toLowerCase()));
    if (taken) return null;
    const doc = { _id: id.toLowerCase(), location, ...value, enteredBy: by, updatedBy: by, voidedAt: null,
      history: [{ at, by, action: 'added' }], createdAt: at, updatedAt: at };
    const built = await rowsFor(tx, doc);
    await tx.insert(paymentsReceived).values(built.payment);
    if (built.history.length) await tx.insert(paymentHistory).values(built.history);
    return (await withHistory(tx, await selectPayments(tx).where(eq(paymentsReceived.id, built.payment.id))))[0];
  });
}

export async function changePayment(db: Db, id: string, set: Loose, entry: PaymentHistoryEntry): Promise<Loose | null> {
  return db.transaction(async tx => {
    const [found] = await tx.select({ p: paymentsReceived, locationName: locations.name }).from(paymentsReceived)
      .leftJoin(locations, eq(locations.id, paymentsReceived.locationId))
      .where(eq(paymentsReceived.id, id.toLowerCase())).for('update', { of: paymentsReceived });
    if (!found) return null;
    const [existing] = await withHistory(tx, [found]);
    const doc = { ...existing, ...set, history: [...existing.history, entry], updatedAt: new Date() };
    const built = await rowsFor(tx, doc);
    const { id: _id, createdAt: _created, ...columns } = built.payment;
    await tx.update(paymentsReceived).set(columns).where(eq(paymentsReceived.id, found.p.id));
    await tx.delete(paymentHistory).where(eq(paymentHistory.paymentId, found.p.id));
    if (built.history.length) await tx.insert(paymentHistory).values(built.history);
    return (await withHistory(tx, await selectPayments(tx).where(eq(paymentsReceived.id, found.p.id))))[0];
  });
}
