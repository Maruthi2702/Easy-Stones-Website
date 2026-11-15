/**
 * Accounting (3rd-party freight) on Postgres, answering in MongoDB's shape (accountingDoc.ts). A save builds the
 * record as MongoDB would hold it (same defaults), then makes its rows with the copy's own builders (carrierRowOf,
 * chargeRowsOf, invoiceRowOf… in copy/accountingRows.ts), so it writes what a re-copy of MongoDB would.
 *
 * `save…` is `UPDATE … WHERE version = __v`: none matched → null → the route's 409, as MongoDB's version check.
 */
import { and, asc, desc, eq, exists, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../copy/plan.ts';
import { locations } from '../schema/reference.ts';
import {
  acctCarriers, acctCarrierInvoices, acctFreightCharges, acctFreightChargeFlags, acctInvoiceCharges, acctPayments,
  acctPaymentCharges, acctAudit
} from '../schema/accounting.ts';
import { carrierRowOf, invoiceRowOf, chargeRowsOf, invoiceChargeRowsOf, paymentRowsOf, auditRowOf, type AccountingLinks } from '../copy/accountingRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import type { CopyProblem } from '../copy/values.ts';
import { newId, isId } from '../ids.ts';
import { newTxnId } from '../../accounting/ids.ts';
import { carrierDoc, invoiceDoc, chargeDoc, paymentDoc, auditDoc } from './accountingDoc.ts';
import type { AccountingStore, ChargeQuery } from './types.ts';
import type { Loose } from '../../types/records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** MongoDB's duplicate-key error, which the routes already answer (409 "already exists"). */
const duplicate = (what: string) => Object.assign(new Error(`Duplicate ${what}`), { code: 11000 });
/** Postgres' unique-violation, however drizzle wrapped it. */
const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return (e?.code ?? e?.cause?.code) === '23505';
};
const unique = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
  try { return await run(); } catch (err) { throw isUniqueViolation(err) ? duplicate(what) : err; }
};

const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, m => `\\${m}`)}%`;
const person = (p: Loose | null | undefined) => ({ id: p?.id ?? '', name: p?.name ?? '' });
const lower = (id: unknown) => String(id).toLowerCase();

/** A record can't be stored: the copy skipped it, or blanked a link the save named. */
function mustStore(what: string, problems: CopyProblem[]) {
  const bad = problems.find(p => (p.outcome === 'skipped' || p.outcome === 'blanked') && p.field !== 'location_id');
  if (bad) throw new Error(`${what} can’t be stored: ${bad.field} (${bad.reason}).`);
}

/** The schema's defaults, as Mongoose applies them to a new record. */
const blankPayment = () => ({ paymentId: '', paidOn: '', method: '', reference: '', recordedAt: null, recordedBy: { id: '', name: '' } });
const withPayment = (p: Loose | undefined) => ({ ...blankPayment(), ...p, recordedBy: person(p?.recordedBy) });

function newCarrierDoc(doc: Loose, now: Date): Loose {
  return {
    aliases: [], paymentTerms: 'per_delivery', active: true, notes: '', ...doc,
    createdBy: person(doc.createdBy), updatedBy: person(doc.updatedBy), createdAt: now, updatedAt: now, __v: 0
  };
}

function newChargeDoc(doc: Loose, now: Date): Loose {
  return {
    soNumber: '', customerName: '', deliveryDate: '', location: '', carrierId: null, carrierNameRaw: '', bolNumber: '',
    amountCents: null, description: '', notes: '', status: 'draft', invoiceId: null, handSet: [], approvedAt: null,
    voidedAt: null, voidReason: '', ...doc,
    flags: (doc.flags || []).map((f: Loose) => ({ _id: newId(), detail: '', at: now, resolvedAt: null, ...f, resolvedBy: person(f.resolvedBy) })),
    approvedBy: person(doc.approvedBy), voidedBy: person(doc.voidedBy), payment: withPayment(doc.payment),
    createdBy: person(doc.createdBy), updatedBy: person(doc.updatedBy), createdAt: now, updatedAt: now, __v: 0
  };
}

function newInvoiceDoc(doc: Loose, now: Date): Loose {
  return {
    invoiceDate: '', chargeIds: [], locations: [], status: 'draft', notes: '', approvedAt: null, voidedAt: null, voidReason: '', ...doc,
    approvedBy: person(doc.approvedBy), voidedBy: person(doc.voidedBy), payment: withPayment(doc.payment),
    createdBy: person(doc.createdBy), updatedBy: person(doc.updatedBy), createdAt: now, updatedAt: now, __v: 0
  };
}

export function pgStore(tx: Db | Tx): AccountingStore {
  const db = tx as Db;

  /** Of these ids, the ones a row exists for (what a link may point at). */
  const known = async (table: PgTable & { id: PgColumn }, ids: unknown[]): Promise<Set<string>> => {
    const wanted = [...new Set(ids.filter(isId).map(lower))];
    if (!wanted.length) return new Set();
    return new Set((await db.select({ id: table.id }).from(table).where(inArray(table.id, wanted))).map(r => (r as { id: string }).id));
  };
  const linksFor = async (ids: { carriers?: unknown[]; invoices?: unknown[]; charges?: unknown[] }): Promise<AccountingLinks> => ({
    ref: await referenceIndexOf(db),
    deliveryIdByTicket: { has: () => true },
    carrierIds: await known(acctCarriers, ids.carriers ?? []),
    invoiceIds: await known(acctCarrierInvoices, ids.invoices ?? []),
    chargeIds: await known(acctFreightCharges, ids.charges ?? [])
  });

  // ── Reading ──
  const chargesWhere = async (where: SQL | undefined, tail?: { order?: SQL[]; limit?: number; offset?: number }): Promise<Loose[]> => {
    let q = db.select({ c: acctFreightCharges, location: locations.name }).from(acctFreightCharges)
      .leftJoin(locations, eq(locations.id, acctFreightCharges.locationId)).where(where).$dynamic();
    if (tail?.order) q = q.orderBy(...tail.order);
    if (tail?.limit !== undefined) q = q.limit(tail.limit);
    if (tail?.offset) q = q.offset(tail.offset);
    const rows = await q;
    if (!rows.length) return [];
    const flags = await db.select().from(acctFreightChargeFlags).where(inArray(acctFreightChargeFlags.chargeId, rows.map(r => r.c.id)));
    return rows.map(r => chargeDoc(r.c, r.location ?? '', flags.filter(f => f.chargeId === r.c.id)));
  };
  const chargeById = async (id: unknown) => (isId(id) ? (await chargesWhere(eq(acctFreightCharges.id, lower(id))))[0] ?? null : null);

  const invoicesWhere = async (where: SQL | undefined, tail?: { order?: SQL[]; limit?: number; offset?: number }): Promise<Loose[]> => {
    let q = db.select().from(acctCarrierInvoices).where(where).$dynamic();
    if (tail?.order) q = q.orderBy(...tail.order);
    if (tail?.limit !== undefined) q = q.limit(tail.limit);
    if (tail?.offset) q = q.offset(tail.offset);
    const rows = await q;
    if (!rows.length) return [];
    const links = await db.select().from(acctInvoiceCharges).where(inArray(acctInvoiceCharges.invoiceId, rows.map(r => r.id))).orderBy(asc(acctInvoiceCharges.position));
    return rows.map(r => invoiceDoc(r, links.filter(l => l.invoiceId === r.id).map(l => l.chargeId)));
  };
  const invoiceById = async (id: unknown) => (isId(id) ? (await invoicesWhere(eq(acctCarrierInvoices.id, lower(id))))[0] ?? null : null);

  const paymentsWhere = async (where: SQL): Promise<Loose | null> => {
    const [row] = await db.select().from(acctPayments).where(where);
    if (!row) return null;
    const links = await db.select().from(acctPaymentCharges).where(eq(acctPaymentCharges.paymentRowId, row.id)).orderBy(asc(acctPaymentCharges.position));
    return paymentDoc(row, links.map(l => l.chargeId));
  };

  /** A charge with an open review flag that still matters (not void). */
  const needsReview = (): SQL => sql`(${exists(db.select({ one: sql`1` }).from(acctFreightChargeFlags)
    .where(and(eq(acctFreightChargeFlags.chargeId, acctFreightCharges.id), isNull(acctFreightChargeFlags.resolvedAt))))} and ${acctFreightCharges.status} <> 'void')`;

  const chargeFilter = (q: ChargeQuery, ignoreStatus = false, status = q.status): SQL | undefined => {
    const parts: (SQL | undefined)[] = [];
    if (q.location) parts.push(eq(locations.name, q.location));
    else if (!q.branches.includes('*')) parts.push(q.branches.length ? inArray(locations.name, q.branches) : sql`false`);
    if (!ignoreStatus) {
      if (['draft', 'approved', 'paid', 'void'].includes(status)) parts.push(eq(acctFreightCharges.status, status));
      if (status === 'flagged') parts.push(needsReview());
      if (status === 'to_approve') parts.push(or(eq(acctFreightCharges.status, 'draft'), needsReview()));
      if (status === 'missing_price') parts.push(and(isNull(acctFreightCharges.amountCents), eq(acctFreightCharges.status, 'draft')));
    }
    if (q.carrierId) parts.push(eq(acctFreightCharges.carrierId, lower(q.carrierId)));
    if (q.from) parts.push(gte(acctFreightCharges.deliveryDay, q.from));
    if (q.to) parts.push(lte(acctFreightCharges.deliveryDay, q.to));
    if (q.search) {
      const like = likePattern(q.search);
      parts.push(or(
        ilike(acctFreightCharges.soNumber, like), ilike(acctFreightCharges.customerName, like), ilike(acctFreightCharges.bolNumber, like),
        ilike(acctFreightCharges.carrierNameRaw, like), ilike(acctFreightCharges.description, like),
        ilike(acctFreightCharges.paymentId, like), ilike(acctFreightCharges.paymentReference, like)
      ));
    }
    return and(...parts);
  };
  const countCharges = async (where: SQL | undefined) => Number((await db.select({ n: sql<number>`count(*)` }).from(acctFreightCharges)
    .leftJoin(locations, eq(locations.id, acctFreightCharges.locationId)).where(where))[0].n);
  const newestFirst = [sql`${acctFreightCharges.deliveryDay} desc nulls last`, desc(acctFreightCharges.createdAt), desc(acctFreightCharges.id)];

  // ── Writing ──
  const writeCharge = async (doc: Loose) => {
    const problems: CopyProblem[] = [];
    const links = await linksFor({ carriers: [doc.carrierId], invoices: [doc.invoiceId] });
    const made = chargeRowsOf(doc, links, problems);
    if (!made) throw new Error('A freight charge can’t be stored: no id or source.');
    mustStore('A freight charge', problems);
    // A branch the Locations list doesn't have, or a carrier / invoice that isn't there: refuse it rather than lose the link.
    if (doc.location && !made.row.locationId) throw Object.assign(new Error(`There is no branch called “${doc.location}” on the Locations list.`), { code: 'UNKNOWN_BRANCH' });
    if (doc.carrierId && !made.row.carrierId) throw new Error('A freight charge can’t be stored: no such carrier.');
    if (doc.invoiceId && !made.row.invoiceId) throw new Error('A freight charge can’t be stored: no such invoice.');
    return made;
  };
  const writeInvoice = async (doc: Loose) => {
    const problems: CopyProblem[] = [];
    const links = await linksFor({ carriers: [doc.carrierId], charges: doc.chargeIds });
    const row = invoiceRowOf(doc, links, problems);
    if (!row) throw new Error('A carrier invoice can’t be stored: no carrier or total.');
    mustStore('A carrier invoice', problems);
    const charges = invoiceChargeRowsOf(doc, links, problems);
    if (charges.length !== (doc.chargeIds || []).length) throw new Error('A carrier invoice can’t be stored: one of its charges isn’t there.');
    return { row, charges };
  };

  return {
    session: null,

    async carriers(ids) {
      const wanted = ids ? ids.filter(isId).map(lower) : null;
      if (wanted && !wanted.length) return [];
      const rows = await db.select().from(acctCarriers).where(wanted ? inArray(acctCarriers.id, wanted) : undefined)
        .orderBy(desc(acctCarriers.active), sql`${acctCarriers.name} collate "C"`, asc(acctCarriers.id));
      return rows.map(carrierDoc);
    },
    async carrier(id) {
      if (!isId(id)) return null;
      const [row] = await db.select().from(acctCarriers).where(eq(acctCarriers.id, lower(id)));
      return row ? carrierDoc(row) : null;
    },
    async carriersExcept(exceptId) {
      const rows = await db.select().from(acctCarriers).where(isId(exceptId) ? ne(acctCarriers.id, lower(exceptId)) : undefined);
      return rows.map(carrierDoc);
    },
    async createCarrier(doc) {
      const full = newCarrierDoc({ _id: newId(), ...doc }, new Date());
      const row = carrierRowOf(full, []);
      if (!row) throw new Error('A carrier can’t be stored.');
      await unique('carrier', () => db.insert(acctCarriers).values(row));
      return full;
    },
    async saveCarrier(doc) {
      const next = { ...doc, updatedAt: new Date(), __v: doc.__v + 1 };
      const row = carrierRowOf(next, []);
      if (!row) throw new Error('A carrier can’t be stored.');
      const { id, createdAt: _c, ...set } = row;
      const done = await unique('carrier', () => db.update(acctCarriers).set(set).where(and(eq(acctCarriers.id, id), eq(acctCarriers.version, doc.__v))).returning({ id: acctCarriers.id }));
      return done.length ? this.carrier(id) : null;
    },
    chargesWaitingForCarrier: () => chargesWhere(and(eq(acctFreightCharges.status, 'draft'), isNull(acctFreightCharges.carrierId), ne(acctFreightCharges.carrierNameRaw, ''))),

    charge: chargeById,
    async chargesByIds(ids) {
      const wanted = ids.filter(isId).map(lower);
      // Oldest first: the order MongoDB hands them back in (the order they were made).
      return wanted.length ? chargesWhere(inArray(acctFreightCharges.id, wanted), { order: [asc(acctFreightCharges.createdAt), asc(acctFreightCharges.id)] }) : [];
    },
    async chargeForDelivery(deliveryId) { return (await chargesWhere(eq(acctFreightCharges.deliveryTicketId, deliveryId)))[0] ?? null; },
    async openDeliveryChargeIds() {
      const rows = await db.select({ t: acctFreightCharges.deliveryTicketId }).from(acctFreightCharges)
        .where(and(eq(acctFreightCharges.source, 'delivery'), ne(acctFreightCharges.status, 'void')));
      return rows.map(r => r.t).filter((t): t is string => Boolean(t));
    },
    async list(q, page, limit) {
      const where = chargeFilter(q);
      const [total, items, summaryRows, flagged, missingPrice, toApprove] = await Promise.all([
        countCharges(where),
        chargesWhere(where, { order: newestFirst, limit, offset: (page - 1) * limit }),
        db.select({ status: acctFreightCharges.status, count: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${acctFreightCharges.amountCents}), 0)` })
          .from(acctFreightCharges).leftJoin(locations, eq(locations.id, acctFreightCharges.locationId))
          .where(chargeFilter(q, true)).groupBy(acctFreightCharges.status),
        countCharges(chargeFilter(q, false, 'flagged')),
        countCharges(chargeFilter(q, false, 'missing_price')),
        countCharges(chargeFilter(q, false, 'to_approve'))
      ]);
      const summary = Object.fromEntries(['draft', 'approved', 'paid', 'void'].map(s => {
        const row = summaryRows.find(r => r.status === s);
        return [s, { count: Number(row?.count || 0), cents: Number(row?.cents || 0) }];
      }));
      return { total, items, summary, flagged, missingPrice, toApprove };
    },
    async exportCharges(q, max) {
      const where = chargeFilter(q);
      const [total, items] = await Promise.all([countCharges(where), chargesWhere(where, { order: newestFirst, limit: max })]);
      return { total, items };
    },
    async createCharge(doc) {
      const full = newChargeDoc({ _id: newId(), ...doc }, new Date());
      const { row, flags } = await writeCharge(full);
      await unique('freight charge', async () => {
        await db.insert(acctFreightCharges).values(row);
        if (flags.length) await db.insert(acctFreightChargeFlags).values(flags);
      });
      return (await chargeById(row.id))!;
    },
    async saveCharge(doc) {
      const { row, flags } = await writeCharge({ ...doc, updatedAt: new Date(), __v: doc.__v + 1 });
      const { id, createdAt: _c, ...set } = row;
      const done = await db.update(acctFreightCharges).set(set).where(and(eq(acctFreightCharges.id, id), eq(acctFreightCharges.version, doc.__v))).returning({ id: acctFreightCharges.id });
      if (!done.length) return null;
      await db.delete(acctFreightChargeFlags).where(eq(acctFreightChargeFlags.chargeId, id));
      if (flags.length) await db.insert(acctFreightChargeFlags).values(flags);
      return chargeById(id);
    },

    invoice: invoiceById,
    async listInvoices(q) {
      const where = and(
        q.branches.includes('*') ? undefined : sql`${acctCarrierInvoices.locations} <@ ${q.branches.length ? sql`ARRAY[${sql.join(q.branches.map(b => sql`${b}`), sql`, `)}]::text[]` : sql`'{}'::text[]`}`,
        q.status !== 'all' ? eq(acctCarrierInvoices.status, q.status) : undefined,
        q.carrierId ? eq(acctCarrierInvoices.carrierId, lower(q.carrierId)) : undefined
      );
      const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(acctCarrierInvoices).where(where);
      const items = await invoicesWhere(where, {
        order: [sql`${acctCarrierInvoices.invoiceDate} desc nulls last`, desc(acctCarrierInvoices.createdAt), desc(acctCarrierInvoices.id)],
        limit: q.limit, offset: (q.page - 1) * q.limit
      });
      return { total: Number(n), items };
    },
    async createInvoice(doc) {
      const full = newInvoiceDoc({ _id: newId(), ...doc }, new Date());
      const { row, charges } = await writeInvoice(full);
      await unique('carrier invoice', async () => {
        await db.insert(acctCarrierInvoices).values(row);
        if (charges.length) await db.insert(acctInvoiceCharges).values(charges);
      });
      return (await invoiceById(row.id))!;
    },
    async saveInvoice(doc) {
      const { row, charges } = await writeInvoice({ ...doc, updatedAt: new Date(), __v: doc.__v + 1 });
      const { id, createdAt: _c, ...set } = row;
      const done = await unique('carrier invoice', () => db.update(acctCarrierInvoices).set(set).where(and(eq(acctCarrierInvoices.id, id), eq(acctCarrierInvoices.version, doc.__v))).returning({ id: acctCarrierInvoices.id }));
      if (!done.length) return null;
      await db.delete(acctInvoiceCharges).where(eq(acctInvoiceCharges.invoiceId, id));
      if (charges.length) await db.insert(acctInvoiceCharges).values(charges);
      return invoiceById(id);
    },

    paymentByRequestId: requestId => paymentsWhere(eq(acctPayments.requestId, requestId)),
    paymentByPaymentId: paymentId => paymentsWhere(eq(acctPayments.paymentId, paymentId)),
    async createPayment(doc) {
      const full = { _id: newId(), approvedInSameStep: false, reference: '', recordedAt: new Date(), ...doc, recordedBy: person(doc.recordedBy) };
      const problems: CopyProblem[] = [];
      const links = await linksFor({ carriers: [doc.carrierId], invoices: [doc.invoiceId], charges: doc.chargeIds });
      const made = paymentRowsOf(full, links, problems);
      if (!made) throw new Error('A payment can’t be stored.');
      mustStore('A payment', problems);
      if (made.charges.length !== (doc.chargeIds || []).length) throw new Error('A payment can’t be stored: one of its charges isn’t there.');
      await unique('payment', async () => {
        await db.insert(acctPayments).values(made.row);
        if (made.charges.length) await db.insert(acctPaymentCharges).values(made.charges);
      });
      return (await paymentsWhere(eq(acctPayments.id, made.row.id)))!;
    },

    async addAudit(entries) {
      if (!entries.length) return;
      const now = new Date();
      const rows = entries.map(e => {
        const row = auditRowOf({ _id: newId(), txnId: newTxnId(), paymentId: '', at: now, changes: [], note: '', ...e, by: person(e.by) }, []);
        if (!row) throw new Error('A history line can’t be stored.');
        return row;
      });
      // Ids rise in the order given, so "newest first" is the order they were written.
      await unique('history line', () => db.insert(acctAudit).values(rows));
    },
    async auditFor(entityType, entityId, limit) {
      const rows = await db.select().from(acctAudit).where(and(eq(acctAudit.entityType, entityType), eq(acctAudit.entityId, entityId)))
        .orderBy(desc(acctAudit.at), desc(acctAudit.id)).limit(limit);
      return rows.map(auditDoc);
    }
  };
}
