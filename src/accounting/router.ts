import type { Loose } from '../types/records.ts';
import type { Request, Response, NextFunction } from 'express';
/**
 * Accounting API (2026-10-09) — mounted at /api/accounting.
 *
 *   app.use('/api/accounting', createAccountingRouter({ authenticate, sync }));
 *
 * Every route checks its own permission (permissions.js — never the role's
 * name) and the person's branches: a charge or invoice in a branch they
 * aren't assigned answers 404, as if it weren't there. Every change writes a
 * history line in the same transaction as the change itself, and every edit
 * carries the version the person was looking at, so a stale screen can't
 * overwrite someone else's work (409).
 *
 * Every history line has its own transaction ID (TX-…), and every payment its
 * payment ID (PAY-…) in the payment register (acct_payments), copied onto
 * each charge it paid — see ids.js.
 */
import express from 'express';
import type { ZodType } from 'zod';
import { FREIGHT, CARRIERS, can } from './permissions.ts';
import { inAccountingTransaction, accountingStore, type AccountingStore, type ChargeQuery } from '../db/accounting/index.ts';
import {
  normalizeCarrierName, editProblem, approveProblem, unapproveProblem, payProblem, voidProblem,
  invoiceChargesProblem, invoiceApproveProblem, invoicePayProblem, invoiceVoidProblem,
  canSeeBranch, branchClause, STATUS_LABELS, approvesWhenPaid, paymentBatchProblem
} from './freightRules.ts';
import { newPaymentId } from './ids.ts';
import { sumCents } from './money.ts';
import * as S from './schemas.ts';

const EXPORT_MAX_ROWS = 5000;

class HttpError extends Error {
  declare status: number;
  declare extra: Record<string, unknown>;

  constructor(status: number, message: string, extra: Loose = {}) { super(message); this.status = status; this.extra = extra; }
}

const actor = (req: Request) => ({ id: String(req.user?.id || ''), name: req.user?.displayName || req.user?.username || '' });
const branchesOf = (req: Request) => req.user?.assignedLocations || [];

/** Any one of these permissions. */
const requireAny = (...perms: string[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (perms.some((p) => can(req.user, p))) return next();
  return res.status(403).json({ error: 'Your role doesn’t have access to this. Ask an admin to turn it on under Users & Roles.' });
};
const requireAll = (...perms: string[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (perms.every((p) => can(req.user, p))) return next();
  return res.status(403).json({ error: 'Your role doesn’t have access to this. Ask an admin to turn it on under Users & Roles.' });
};

const parse = (schema: ZodType<Loose>, data: unknown) => {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, S.firstIssue(r.error));
  return r.data;
};

/** Runs `fn(store)` as one transaction: all of it lands, or none of it. */
const inTransaction = inAccountingTransaction;

const history = (store: AccountingStore, entries: Loose[]) => store.addAudit(entries);

const diff = (doc: Loose, set: Loose) => Object.entries(set)
  .filter(([f, v]) => String(doc[f] ?? '') !== String(v ?? ''))
  .map(([f, v]) => ({ field: f, from: doc[f] ?? null, to: v ?? null }));

const checkVersion = (doc: Loose, version: unknown, what = 'This charge') => {
  if (doc.__v !== version) throw new HttpError(409, `${what} was changed by someone else. Reload to see the latest, then try again.`);
};

const CHANGED_AT_THE_SAME_MOMENT = 'Someone else changed this at the same moment. Reload and try again.';

/** Saves a record that was read in this request; someone else saving it first is the same 409 as a stale screen. */
async function saved(write: Promise<Loose | null>): Promise<Loose> {
  const out = await write;
  if (!out) throw new HttpError(409, CHANGED_AT_THE_SAME_MOMENT);
  return out;
}

/** The charge if it exists and is in one of the person's branches. */
async function chargeFor(req: Request, id: unknown, store: AccountingStore) {
  const doc = await store.charge(id);
  if (!doc || !canSeeBranch(branchesOf(req), doc.location)) throw new HttpError(404, 'Charge not found.');
  return doc;
}

async function invoiceFor(req: Request, id: unknown, store: AccountingStore) {
  const doc = await store.invoice(id);
  const mine = doc && (doc.locations || []).every((l: string) => canSeeBranch(branchesOf(req), l));
  if (!mine) throw new HttpError(404, 'Invoice not found.');
  return doc;
}

const handle = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) return res.status((err as Error & Loose).status).json({ error: (err as Error).message, ...(err as Error & Loose).extra });
    // Postgres only: a branch that isn't on the Locations list can't be linked (MongoDB kept any text).
    if ((err as Error & Loose)?.code === 'UNKNOWN_BRANCH') return res.status(400).json({ error: (err as Error).message });
    if ((err as Error & Loose)?.code === 11000) return res.status(409).json({ error: 'That already exists — check for a duplicate.' });
    if ((err as Error)?.name === 'VersionError') return res.status(409).json({ error: CHANGED_AT_THE_SAME_MOMENT });
    console.error('[accounting]', req.method, req.originalUrl, err);
    return res.status(500).json({ error: 'Something went wrong on our side. Nothing was changed.' });
  }
};

/** A charge for the screens, with its carrier's name and terms. */
const present = (c: Loose, carriersById: Loose) => {
  const carrier = c.carrierId ? carriersById.get(String(c.carrierId)) : null;
  return {
    ...c,
    version: c.__v,
    carrier: carrier ? { _id: carrier._id, name: carrier.name, paymentTerms: carrier.paymentTerms, active: carrier.active } : null,
    openFlags: (c.flags || []).filter((f: Loose) => !f.resolvedAt)
  };
};

const carriersMap = async (store: AccountingStore, ids: readonly unknown[] | null = null) =>
  new Map((await store.carriers(ids)).map((c) => [String(c._id), c]));

/**
 * Record a payment on a charge or invoice: approve it first if it's a draft
 * (one step), then mark it paid. Returns the history lines to write — two
 * for a one-step payment, so the approval is on the record as its own line.
 */
function markPaid(doc: Loose, body: Loose, by: Loose, now: Date, paymentId: string, entityType: string, chargeNote = '') {
  const lines: Loose[] = [];
  const base = { entityType, entityId: String(doc._id), by, at: now, paymentId };
  if (approvesWhenPaid(doc)) {
    doc.status = 'approved';
    doc.approvedAt = now;
    doc.approvedBy = by;
    lines.push({ ...base, action: 'approved', changes: [{ field: 'status', from: 'draft', to: 'approved' }],
      note: [`Approved and paid in one step · ${paymentId}`, chargeNote].filter(Boolean).join(' · ') });
  }
  const from = doc.status;
  doc.status = 'paid';
  doc.payment = { paymentId, paidOn: body.paidOn, method: body.method, reference: body.reference, recordedAt: now, recordedBy: by };
  lines.push({ ...base, action: 'paid', changes: [{ field: 'status', from, to: 'paid' }],
    note: [`${paymentId} · Paid ${body.paidOn} by ${body.method}${body.reference ? ` #${body.reference}` : ''}`, chargeNote].filter(Boolean).join(' · ') });
  return lines;
}

/** The payment an earlier copy of this same request already recorded. */
const priorPayment = async (requestId: string | undefined, store: AccountingStore) => (requestId
  ? store.paymentByRequestId(requestId)
  : null);

/** The answer to a repeated request: what the first one paid, as it is now. */
async function replayed(req: Request, payment: Loose) {
  if (!(payment.locations || []).every((l: string) => canSeeBranch(branchesOf(req), l))) throw new HttpError(404, 'Payment not found.');
  const store = await accountingStore();
  const [charges, carriers] = await Promise.all([store.chargesByIds(payment.chargeIds), carriersMap(store)]);
  return { items: charges.map((c) => present(c, carriers)), payment, replayed: true };
}

/** The charge list's query: the person's branches, the screen's filters. A branch they can't see is a 403. */
function chargeQuery(req: Request, q: Loose): ChargeQuery {
  if (!branchClause(branchesOf(req), q.location)) throw new HttpError(403, 'You don’t have access to that branch.');
  return { branches: branchesOf(req), location: q.location, status: q.status, carrierId: q.carrierId, from: q.from, to: q.to, search: q.search };
}

export default function createAccountingRouter({ authenticate, sync = null }: Loose = {}) {
  const router = express.Router();
  router.use(authenticate);

  // ── Freight charges ────────────────────────────────────────────────────

  router.get('/freight-charges', requireAll(FREIGHT.VIEW), handle(async (req: Request, res: Response) => {
    const q = parse(S.listQuery, req.query);
    const store = await accountingStore();
    const [found, carriers] = await Promise.all([store.list(chargeQuery(req, q), q.page, q.limit), carriersMap(store)]);
    res.json({
      items: found.items.map((d) => present(d, carriers)), total: found.total, page: q.page, limit: q.limit,
      summary: { ...found.summary, flagged: found.flagged, missingPrice: found.missingPrice, toApprove: found.toApprove }
    });
  }));

  // Every row matching the filters, for PDF / Excel. (SPS has no import, so no
  // SPS file — owner, 2026-10-09; the Excel sheet is what gets keyed into it.)
  router.get('/freight-charges/export', requireAll(FREIGHT.VIEW, FREIGHT.EXPORT), handle(async (req: Request, res: Response) => {
    const q = parse(S.listQuery, { ...req.query, page: 1, limit: 100 });
    const store = await accountingStore();
    const [found, carriers] = await Promise.all([store.exportCharges(chargeQuery(req, q), EXPORT_MAX_ROWS), carriersMap(store)]);
    res.json({ items: found.items.map((d) => present(d, carriers)), total: found.total, truncated: found.total > found.items.length });
  }));

  router.get('/freight-charges/:id', requireAll(FREIGHT.VIEW), handle(async (req: Request, res: Response) => {
    const store = await accountingStore();
    const doc = await chargeFor(req, req.params.id, store);
    const carriers = await carriersMap(store, doc.carrierId ? [doc.carrierId] : []);
    const found = doc.invoiceId ? await store.invoice(doc.invoiceId) : null;
    const invoice = found ? { _id: found._id, invoiceNumber: found.invoiceNumber, status: found.status } : null;
    const out: Record<string, unknown> = { ...present(doc, carriers), invoice };
    if (can(req.user, FREIGHT.HISTORY)) out.history = await store.auditFor('charge', String(doc._id), 200);
    res.json(out);
  }));

  router.get('/freight-charges/:id/history', requireAll(FREIGHT.VIEW, FREIGHT.HISTORY), handle(async (req: Request, res: Response) => {
    const store = await accountingStore();
    const doc = await chargeFor(req, req.params.id, store);
    res.json(await store.auditFor('charge', String(doc._id), 500));
  }));

  router.post('/freight-charges', requireAll(FREIGHT.VIEW, FREIGHT.ADD), handle(async (req: Request, res: Response) => {
    const body = parse(S.manualCharge, req.body);
    if (!canSeeBranch(branchesOf(req), body.location)) throw new HttpError(403, 'You don’t have access to that branch.');
    const carrier = await (await accountingStore()).carrier(body.carrierId);
    if (!carrier) throw new HttpError(400, 'That carrier doesn’t exist.');
    if (!carrier.active) throw new HttpError(400, `${carrier.name} is deactivated.`);
    const by = actor(req);
    const created = await inTransaction(async (store) => {
      const doc = await store.createCharge({
        source: 'manual', location: body.location, deliveryDate: body.deliveryDate, carrierId: carrier._id,
        amountCents: body.amount, description: body.description, soNumber: body.soNumber,
        customerName: body.customerName, bolNumber: body.bolNumber, notes: body.notes,
        status: 'draft', createdBy: by, updatedBy: by
      });
      await history(store, [{ entityType: 'charge', entityId: String(doc._id), action: 'created', by, note: `Added by hand: ${body.description}` }]);
      return doc;
    });
    res.status(201).json(present(created, await carriersMap(await accountingStore(), [carrier._id])));
  }));

  router.patch('/freight-charges/:id', requireAll(FREIGHT.VIEW, FREIGHT.EDIT), handle(async (req: Request, res: Response) => {
    const body = parse(S.chargeEdit, req.body);
    const by = actor(req);
    const done = await inTransaction(async (store) => {
      const doc = await chargeFor(req, req.params.id, store);
      checkVersion(doc, body.version);
      const problem = editProblem(doc);
      if (problem) throw new HttpError(400, problem);
      const set: Loose = {};
      if (body.amount !== undefined) set.amountCents = body.amount;
      if (body.carrierId !== undefined) {
        if (body.carrierId) {
          const carrier = await store.carrier(body.carrierId);
          if (!carrier) throw new HttpError(400, 'That carrier doesn’t exist.');
          set.carrierId = carrier._id;
        } else set.carrierId = null;
      }
      for (const f of ['bolNumber', 'soNumber', 'customerName', 'deliveryDate', 'description', 'notes']) {
        if (body[f] !== undefined) set[f] = body[f];
      }
      const changes = diff(doc, set);
      if (!changes.length) return doc;
      for (const c of changes) doc[c.field] = set[c.field];
      // On a schedule-made charge, a field corrected by hand stops following the delivery.
      if (doc.source === 'delivery') {
        const followed = new Set(['amountCents', 'carrierId', 'bolNumber', 'soNumber', 'customerName', 'deliveryDate']);
        doc.handSet = [...new Set([...(doc.handSet || []), ...changes.map((c) => c.field).filter((f) => followed.has(f))])];
      }
      doc.updatedBy = by;
      const out = await saved(store.saveCharge(doc));
      await history(store, [{ entityType: 'charge', entityId: String(doc._id), action: 'edited', by, changes }]);
      return out;
    });
    const store = await accountingStore();
    res.json(present(done, await carriersMap(store, done.carrierId ? [done.carrierId] : [])));
  }));

  /**
   * Approve / unapprove / pay several charges at once — all of them or none:
   * one charge that can't move stops the whole batch, with the reason.
   */
  const bulk = ({ schema, problemFor, apply, action, note }: { schema: ZodType<Loose>; problemFor: (doc: Loose, carrier: Loose | undefined) => string | null; apply: (doc: Loose, body: Loose, by: Loose) => void; action: string; note?: (body: Loose) => string }) => handle(async (req: Request, res: Response) => {
    const body = parse(schema, req.body);
    const by = actor(req);
    const done = await inTransaction(async (store) => {
      const docs: Loose[] = [];
      for (const item of body.items) {
        const doc = await chargeFor(req, item.id, store);
        checkVersion(doc, item.version, `SO# ${doc.soNumber || '—'}`);
        docs.push(doc);
      }
      const carriers = await carriersMap(store, docs.map((d) => d.carrierId).filter(Boolean));
      const problems = docs
        .map((d) => ({ id: String(d._id), soNumber: d.soNumber, problem: problemFor(d, carriers.get(String(d.carrierId))) }))
        .filter((p) => p.problem);
      if (problems.length) {
        const first = problems[0];
        throw new HttpError(400, `${first.soNumber ? `SO# ${first.soNumber}: ` : ''}${first.problem}`, { problems });
      }
      const entries: Loose[] = [];
      const out: Loose[] = [];
      for (const doc of docs) {
        const before = { status: doc.status };
        apply(doc, body, by);
        doc.updatedBy = by;
        const next = await saved(store.saveCharge(doc));
        out.push(next);
        entries.push({ entityType: 'charge', entityId: String(doc._id), action, by, changes: [{ field: 'status', from: before.status, to: next.status }], note: note ? note(body) : '' });
      }
      await history(store, entries);
      return out;
    });
    const carriers = await carriersMap(await accountingStore());
    res.json({ items: done.map((d: Loose) => present(d, carriers)) });
  });

  router.post('/freight-charges/approve', requireAll(FREIGHT.VIEW, FREIGHT.APPROVE), bulk({
    schema: S.bulkItems,
    problemFor: (d: Loose, carrier: Loose | undefined) => approveProblem(d, carrier),
    apply: (d: Loose, _b: Loose, by: Loose) => { d.status = 'approved'; d.approvedAt = new Date(); d.approvedBy = by; },
    action: 'approved'
  }));

  router.post('/freight-charges/unapprove', requireAll(FREIGHT.VIEW, FREIGHT.APPROVE), bulk({
    schema: S.bulkItems,
    problemFor: (d: Loose) => unapproveProblem(d),
    apply: (d: Loose) => { d.status = 'draft'; d.approvedAt = null; d.approvedBy = { id: '', name: '' }; },
    action: 'unapproved'
  }));

  /**
   * Mark charges paid — one payment, to one carrier, all of them or none.
   * A draft is approved in the same step when the person can also approve
   * (payProblem); the history then shows both lines. The payment goes in the
   * register with its own PAY- id, copied onto each charge and history line.
   */
  router.post('/freight-charges/pay', requireAll(FREIGHT.VIEW, FREIGHT.PAY), handle(async (req: Request, res: Response) => {
    const body = parse(S.bulkPay, req.body);
    const by = actor(req);
    const canApprove = can(req.user, FREIGHT.APPROVE);
    const out = await inTransaction(async (store) => {
      const prior = await priorPayment(body.requestId, store);
      if (prior) return { prior };
      const docs: Loose[] = [];
      for (const item of body.items) {
        const doc = await chargeFor(req, item.id, store);
        checkVersion(doc, item.version, `SO# ${doc.soNumber || '—'}`);
        docs.push(doc);
      }
      const batch = paymentBatchProblem(docs);
      if (batch) throw new HttpError(400, batch);
      const carriers = await carriersMap(store, docs.map((d) => d.carrierId).filter(Boolean));
      const problems = docs
        .map((d) => ({ id: String(d._id), soNumber: d.soNumber, problem: payProblem(d, { carrier: carriers.get(String(d.carrierId)), canApprove }) }))
        .filter((p) => p.problem);
      if (problems.length) {
        const first = problems[0];
        throw new HttpError(400, `${first.soNumber ? `SO# ${first.soNumber}: ` : ''}${first.problem}`, { problems });
      }
      const now = new Date();
      const paymentId = newPaymentId(now);
      const entries: Loose[] = [];
      const oneStep = docs.some(approvesWhenPaid);
      const paid: Loose[] = [];
      for (const doc of docs) {
        entries.push(...markPaid(doc, body, by, now, paymentId, 'charge'));
        doc.updatedBy = by;
        paid.push(await saved(store.saveCharge(doc)));
      }
      const payment = await store.createPayment({
        paymentId, requestId: body.requestId, kind: 'charges', carrierId: docs[0].carrierId,
        chargeIds: docs.map((d) => d._id), locations: [...new Set(docs.map((d) => d.location))],
        totalCents: sumCents(docs.map((d) => d.amountCents)), paidOn: body.paidOn, method: body.method,
        reference: body.reference, approvedInSameStep: oneStep, recordedAt: now, recordedBy: by
      });
      await history(store, entries);
      return { docs: paid, payment };
    });
    if (out.prior) return res.json(await replayed(req, out.prior));
    const carriers = await carriersMap(await accountingStore());
    res.json({ items: out.docs!.map((d: Loose) => present(d, carriers)), payment: out.payment });
  }));

  router.post('/freight-charges/:id/void', requireAll(FREIGHT.VIEW, FREIGHT.VOID), handle(async (req: Request, res: Response) => {
    const body = parse(S.voidBody, req.body);
    const by = actor(req);
    const done = await inTransaction(async (store) => {
      const doc = await chargeFor(req, req.params.id, store);
      checkVersion(doc, body.version);
      const problem = voidProblem(doc);
      if (problem) throw new HttpError(400, problem);
      const from = doc.status;
      doc.status = 'void';
      doc.voidedAt = new Date();
      doc.voidedBy = by;
      doc.voidReason = body.reason;
      doc.updatedBy = by;
      const out = await saved(store.saveCharge(doc));
      await history(store, [{ entityType: 'charge', entityId: String(doc._id), action: 'voided', by, changes: [{ field: 'status', from, to: 'void' }], note: body.reason }]);
      return out;
    });
    res.json(present(done, await carriersMap(await accountingStore())));
  }));

  // "I've looked at it": clears the review flags (the history keeps them).
  router.post('/freight-charges/:id/resolve-flags', requireAll(FREIGHT.VIEW, FREIGHT.EDIT), handle(async (req: Request, res: Response) => {
    const body = parse(S.versionOnly, req.body);
    const by = actor(req);
    const done = await inTransaction(async (store) => {
      const doc = await chargeFor(req, req.params.id, store);
      checkVersion(doc, body.version);
      const open = doc.flags.filter((f: Loose) => !f.resolvedAt);
      if (!open.length) return doc;
      for (const f of open) { f.resolvedAt = new Date(); f.resolvedBy = by; }
      doc.updatedBy = by;
      const out = await saved(store.saveCharge(doc));
      await history(store, [{ entityType: 'charge', entityId: String(doc._id), action: 'reviewed', by, note: open.map((f: Loose) => f.detail).join('; ') }]);
      return out;
    });
    res.json(present(done, await carriersMap(await accountingStore())));
  }));

  // ── Payments ───────────────────────────────────────────────────────────

  // Look a payment up by its PAY- id: what went out, to whom, and every
  // charge it paid. Only when all of it is in the person's branches.
  router.get('/payments/:paymentId', requireAll(FREIGHT.VIEW), handle(async (req: Request, res: Response) => {
    const id = S.paymentIdParam.safeParse(req.params.paymentId);
    if (!id.success) throw new HttpError(404, 'Payment not found.');
    const store = await accountingStore();
    const payment = await store.paymentByPaymentId(id.data);
    if (!payment || !(payment.locations || []).every((l: string) => canSeeBranch(branchesOf(req), l))) throw new HttpError(404, 'Payment not found.');
    const [charges, carriers, found] = await Promise.all([
      store.chargesByIds(payment.chargeIds),
      carriersMap(store),
      payment.invoiceId ? store.invoice(payment.invoiceId) : null
    ]);
    charges.sort((a, b) => (a.deliveryDate < b.deliveryDate ? -1 : a.deliveryDate > b.deliveryDate ? 1 : 0));
    const invoice = found ? { _id: found._id, invoiceNumber: found.invoiceNumber, status: found.status, totalCents: found.totalCents } : null;
    const carrier = payment.carrierId ? carriers.get(String(payment.carrierId)) : null;
    res.json({
      ...payment,
      carrier: carrier ? { _id: carrier._id, name: carrier.name } : null,
      invoice,
      charges: charges.map((c) => present(c, carriers))
    });
  }));

  // ── Carriers ───────────────────────────────────────────────────────────

  router.get('/carriers', requireAny(CARRIERS.VIEW, FREIGHT.VIEW), handle(async (req: Request, res: Response) => {
    const list = await (await accountingStore()).carriers(null);
    res.json(list.map((c) => ({ ...c, version: c.__v })));
  }));

  const carrierAliasesClash = async (store: AccountingStore, names: string[], exceptId: unknown = null) => {
    const keys = names.map(normalizeCarrierName).filter(Boolean);
    const others = await store.carriersExcept(exceptId);
    for (const o of others) {
      const theirs = [o.nameKey, ...(o.aliases || []).map(normalizeCarrierName)];
      const hit = keys.find((k: string) => theirs.includes(k));
      if (hit) return o.name;
    }
    return null;
  };

  router.post('/carriers', requireAll(CARRIERS.ADD), handle(async (req: Request, res: Response) => {
    const body = parse(S.carrierCreate, req.body);
    const by = actor(req);
    const nameKey = normalizeCarrierName(body.name);
    if (!nameKey) throw new HttpError(400, 'Enter the carrier name.');
    const clash = await carrierAliasesClash(await accountingStore(), [body.name, ...body.aliases]);
    if (clash) throw new HttpError(409, `That name is already used by ${clash}.`);
    const created = await inTransaction(async (store) => {
      const doc = await store.createCarrier({ ...body, nameKey, createdBy: by, updatedBy: by });
      await history(store, [{ entityType: 'carrier', entityId: String(doc._id), action: 'created', by, note: `${doc.name} (${doc.paymentTerms === 'per_invoice' ? 'paid per invoice' : 'paid per delivery'})` }]);
      return doc;
    });
    if (sync) await sync.matchUnassigned(by).catch(() => {});
    res.status(201).json({ ...created, version: created.__v });
  }));

  router.patch('/carriers/:id', requireAll(CARRIERS.EDIT), handle(async (req: Request, res: Response) => {
    const body = parse(S.carrierEdit, req.body);
    const by = actor(req);
    const done = await inTransaction(async (store) => {
      const doc = await store.carrier(req.params.id);
      if (!doc) throw new HttpError(404, 'Carrier not found.');
      checkVersion(doc, body.version, 'This carrier');
      const set: Loose = {};
      if (body.name !== undefined) { set.name = body.name; set.nameKey = normalizeCarrierName(body.name); }
      if (body.aliases !== undefined) set.aliases = body.aliases;
      if (body.paymentTerms !== undefined) set.paymentTerms = body.paymentTerms;
      if (body.notes !== undefined) set.notes = body.notes;
      const clash = await carrierAliasesClash(store, [set.name ?? doc.name, ...(set.aliases ?? doc.aliases)], doc._id);
      if (clash) throw new HttpError(409, `That name is already used by ${clash}.`);
      const changes = diff(doc, { ...set, aliases: set.aliases ? set.aliases.join(', ') : doc.aliases.join(', ') })
        .filter((c) => c.field !== 'nameKey');
      Object.assign(doc, set);
      doc.updatedBy = by;
      const out = await saved(store.saveCarrier(doc));
      if (changes.length) await history(store, [{ entityType: 'carrier', entityId: String(doc._id), action: 'edited', by, changes }]);
      return out;
    });
    if (sync) await sync.matchUnassigned(by).catch(() => {});
    res.json({ ...done, version: done.__v });
  }));

  const setCarrierActive = (active: boolean) => handle(async (req: Request, res: Response) => {
    const body = parse(S.versionOnly, req.body);
    const by = actor(req);
    const done = await inTransaction(async (store) => {
      const doc = await store.carrier(req.params.id);
      if (!doc) throw new HttpError(404, 'Carrier not found.');
      checkVersion(doc, body.version, 'This carrier');
      if (doc.active === active) return doc;
      doc.active = active;
      doc.updatedBy = by;
      const out = await saved(store.saveCarrier(doc));
      await history(store, [{ entityType: 'carrier', entityId: String(doc._id), action: active ? 'reactivated' : 'deactivated', by }]);
      return out;
    });
    res.json({ ...done, version: done.__v });
  });
  router.post('/carriers/:id/deactivate', requireAll(CARRIERS.DEACTIVATE), setCarrierActive(false));
  router.post('/carriers/:id/reactivate', requireAll(CARRIERS.DEACTIVATE), setCarrierActive(true));

  // ── Carrier invoices ───────────────────────────────────────────────────

  const presentInvoice = (o: Loose, carriers: Loose, charges: Loose[] | null = null) => {
    const carrier = carriers.get(String(o.carrierId));
    return {
      ...o, version: o.__v,
      carrier: carrier ? { _id: carrier._id, name: carrier.name, paymentTerms: carrier.paymentTerms } : null,
      ...(charges && { charges: charges.map((c: Loose) => present(c, carriers)) })
    };
  };

  /** Load and check charges for an invoice; returns the docs. */
  async function invoiceCharges(req: Request, ids: string[], carrierId: unknown, invoiceId: unknown, store: AccountingStore) {
    const docs: Loose[] = [];
    for (const id of [...new Set(ids)]) docs.push(await chargeFor(req, id, store));
    const problem = invoiceChargesProblem(docs, carrierId, { invoiceId });
    if (problem) throw new HttpError(400, problem);
    return docs;
  }

  router.get('/carrier-invoices', requireAll(FREIGHT.VIEW), handle(async (req: Request, res: Response) => {
    const q = parse(S.invoiceListQuery, req.query);
    const store = await accountingStore();
    const [found, carriers] = await Promise.all([
      store.listInvoices({ branches: branchesOf(req), status: q.status, carrierId: q.carrierId, page: q.page, limit: q.limit }),
      carriersMap(store)
    ]);
    res.json({ items: found.items.map((d) => presentInvoice(d, carriers)), total: found.total, page: q.page, limit: q.limit });
  }));

  router.get('/carrier-invoices/:id', requireAll(FREIGHT.VIEW), handle(async (req: Request, res: Response) => {
    const store = await accountingStore();
    const inv = await invoiceFor(req, req.params.id, store);
    const [charges, carriers] = await Promise.all([store.chargesByIds(inv.chargeIds), carriersMap(store)]);
    const out: Record<string, unknown> = presentInvoice(inv, carriers, charges);
    if (can(req.user, FREIGHT.HISTORY)) out.history = await store.auditFor('invoice', String(inv._id), 200);
    res.json(out);
  }));

  router.post('/carrier-invoices', requireAll(FREIGHT.VIEW, FREIGHT.ADD), handle(async (req: Request, res: Response) => {
    const body = parse(S.invoiceCreate, req.body);
    const carrier = await (await accountingStore()).carrier(body.carrierId);
    if (!carrier) throw new HttpError(400, 'That carrier doesn’t exist.');
    const by = actor(req);
    const created = await inTransaction(async (store) => {
      const charges = await invoiceCharges(req, body.chargeIds, carrier._id, null, store);
      const inv = await store.createInvoice({
        carrierId: carrier._id, invoiceNumber: body.invoiceNumber, invoiceDate: body.invoiceDate,
        totalCents: body.total, chargeIds: charges.map((c) => c._id), locations: [...new Set(charges.map((c) => c.location))],
        notes: body.notes, status: 'draft', createdBy: by, updatedBy: by
      });
      for (const c of charges) { c.invoiceId = inv._id; c.updatedBy = by; await saved(store.saveCharge(c)); }
      await history(store, [
        { entityType: 'invoice', entityId: String(inv._id), action: 'created', by, note: `${carrier.name} invoice #${inv.invoiceNumber}, ${charges.length} charge(s)` },
        ...charges.map((c) => ({ entityType: 'charge', entityId: String(c._id), action: 'added_to_invoice', by, note: `Invoice #${inv.invoiceNumber}` }))
      ]);
      return inv;
    });
    res.status(201).json(presentInvoice(created, await carriersMap(await accountingStore())));
  }));

  router.patch('/carrier-invoices/:id', requireAll(FREIGHT.VIEW, FREIGHT.EDIT), handle(async (req: Request, res: Response) => {
    const body = parse(S.invoiceEdit, req.body);
    const by = actor(req);
    const done = await inTransaction(async (store) => {
      const inv = await invoiceFor(req, req.params.id, store);
      checkVersion(inv, body.version, 'This invoice');
      if (inv.status !== 'draft') throw new HttpError(400, `A ${(STATUS_LABELS as Record<string,string>)[inv.status].toLowerCase()} invoice can't be edited.`);
      const set: Loose = {};
      if (body.invoiceNumber !== undefined) set.invoiceNumber = body.invoiceNumber;
      if (body.invoiceDate !== undefined) set.invoiceDate = body.invoiceDate;
      if (body.total !== undefined) set.totalCents = body.total;
      if (body.notes !== undefined) set.notes = body.notes;
      const changes = diff(inv, set);
      const entries: Loose[] = [];
      if (body.chargeIds) {
        const next = await invoiceCharges(req, body.chargeIds, inv.carrierId, inv._id, store);
        const nextIds = new Set(next.map((c) => String(c._id)));
        const removed = inv.chargeIds.filter((id: unknown) => !nextIds.has(String(id)));
        for (const id of removed) {
          const c = await store.charge(id);
          if (c) { c.invoiceId = null; c.updatedBy = by; await saved(store.saveCharge(c)); entries.push({ entityType: 'charge', entityId: String(c._id), action: 'removed_from_invoice', by, note: `Invoice #${inv.invoiceNumber}` }); }
        }
        for (const c of next) {
          if (String(c.invoiceId || '') !== String(inv._id)) {
            c.invoiceId = inv._id; c.updatedBy = by; await saved(store.saveCharge(c));
            entries.push({ entityType: 'charge', entityId: String(c._id), action: 'added_to_invoice', by, note: `Invoice #${inv.invoiceNumber}` });
          }
        }
        if (removed.length || entries.length) changes.push({ field: 'charges', from: inv.chargeIds.length, to: next.length });
        inv.chargeIds = next.map((c) => c._id);
        inv.locations = [...new Set(next.map((c) => c.location))];
      }
      Object.assign(inv, set);
      inv.updatedBy = by;
      const out = await saved(store.saveInvoice(inv));
      if (changes.length) entries.unshift({ entityType: 'invoice', entityId: String(inv._id), action: 'edited', by, changes });
      if (entries.length) await history(store, entries);
      return out;
    });
    res.json(presentInvoice(done, await carriersMap(await accountingStore())));
  }));

  /** Move an invoice and all its charges together. */
  const invoiceStep = ({ schema, problem, invoiceTo, chargeTo, action, note }: { schema: ZodType<Loose>; problem: (inv: Loose, charges: Loose[], body: Loose) => string | null; invoiceTo: (inv: Loose, body: Loose, by: Loose) => void; chargeTo: (charge: Loose, body: Loose, by: Loose, inv: Loose) => void; action: string; note?: (body: Loose) => string }) => handle(async (req: Request, res: Response) => {
    const body = parse(schema, req.body);
    const by = actor(req);
    const done = await inTransaction(async (store) => {
      const inv = await invoiceFor(req, req.params.id, store);
      checkVersion(inv, body.version, 'This invoice');
      const charges = await store.chargesByIds(inv.chargeIds);
      const why = problem(inv, charges, body);
      if (why) throw new HttpError(400, why);
      const from = inv.status;
      invoiceTo(inv, body, by);
      inv.updatedBy = by;
      const out = await saved(store.saveInvoice(inv));
      const entries = [{ entityType: 'invoice', entityId: String(inv._id), action, by, changes: [{ field: 'status', from, to: inv.status }], note: note ? note(body) : '' }];
      for (const c of charges) {
        const cFrom = c.status;
        chargeTo(c, body, by, inv);
        c.updatedBy = by;
        await saved(store.saveCharge(c));
        entries.push({ entityType: 'charge', entityId: String(c._id), action, by, changes: [{ field: 'status', from: cFrom, to: c.status }], note: `Invoice #${inv.invoiceNumber}` });
      }
      await history(store, entries);
      return out;
    });
    res.json(presentInvoice(done, await carriersMap(await accountingStore())));
  });

  router.post('/carrier-invoices/:id/approve', requireAll(FREIGHT.VIEW, FREIGHT.APPROVE), invoiceStep({
    schema: S.versionOnly,
    problem: (inv: Loose, charges: Loose[]) => invoiceApproveProblem(inv, charges),
    invoiceTo: (inv: Loose, _b: Loose, by: Loose) => { inv.status = 'approved'; inv.approvedAt = new Date(); inv.approvedBy = by; },
    chargeTo: (c: Loose, _b: Loose, by: Loose) => { c.status = 'approved'; c.approvedAt = new Date(); c.approvedBy = by; },
    action: 'approved'
  }));

  router.post('/carrier-invoices/:id/unapprove', requireAll(FREIGHT.VIEW, FREIGHT.APPROVE), invoiceStep({
    schema: S.versionOnly,
    problem: (inv: Loose) => (inv.status === 'approved' ? null : 'Only an approved invoice can go back to approval.'),
    invoiceTo: (inv: Loose) => { inv.status = 'draft'; inv.approvedAt = null; inv.approvedBy = { id: '', name: '' }; },
    chargeTo: (c: Loose) => { c.status = 'draft'; c.approvedAt = null; c.approvedBy = { id: '', name: '' }; },
    action: 'unapproved'
  }));

  // Pay an invoice: the invoice and every charge on it, as one payment.
  // A draft invoice is approved in the same step when the person can approve.
  router.post('/carrier-invoices/:id/pay', requireAll(FREIGHT.VIEW, FREIGHT.PAY), handle(async (req: Request, res: Response) => {
    const body = parse(S.invoicePay, req.body);
    const by = actor(req);
    const canApprove = can(req.user, FREIGHT.APPROVE);
    const out = await inTransaction(async (store) => {
      const prior = await priorPayment(body.requestId, store);
      if (prior) return { prior };
      const inv = await invoiceFor(req, req.params.id, store);
      checkVersion(inv, body.version, 'This invoice');
      const charges = await store.chargesByIds(inv.chargeIds);
      const why = invoicePayProblem(inv, charges, { canApprove });
      if (why) throw new HttpError(400, why);
      const now = new Date();
      const paymentId = newPaymentId(now);
      const oneStep = approvesWhenPaid(inv);
      const entries = markPaid(inv, body, by, now, paymentId, 'invoice');
      inv.updatedBy = by;
      const paidInvoice = await saved(store.saveInvoice(inv));
      for (const c of charges) {
        entries.push(...markPaid(c, body, by, now, paymentId, 'charge', `Invoice #${inv.invoiceNumber}`));
        c.updatedBy = by;
        await saved(store.saveCharge(c));
      }
      await store.createPayment({
        paymentId, requestId: body.requestId, kind: 'invoice', carrierId: inv.carrierId, invoiceId: inv._id,
        chargeIds: charges.map((c) => c._id), locations: inv.locations, totalCents: inv.totalCents,
        paidOn: body.paidOn, method: body.method, reference: body.reference,
        approvedInSameStep: oneStep, recordedAt: now, recordedBy: by
      });
      await history(store, entries);
      return { inv: paidInvoice };
    });
    const store = await accountingStore();
    if (out.prior) {
      const inv = out.prior.invoiceId ? await invoiceFor(req, String(out.prior.invoiceId), store) : null;
      return res.json({ ...(inv && presentInvoice(inv, await carriersMap(store))), payment: out.prior, replayed: true });
    }
    res.json(presentInvoice(out.inv!, await carriersMap(store)));
  }));

  router.post('/carrier-invoices/:id/void', requireAll(FREIGHT.VIEW, FREIGHT.VOID), invoiceStep({
    schema: S.voidBody,
    problem: (inv: Loose) => invoiceVoidProblem(inv),
    invoiceTo: (inv: Loose, b: Loose, by: Loose) => { inv.status = 'void'; inv.voidedAt = new Date(); inv.voidedBy = by; inv.voidReason = b.reason; },
    // The charges go back to waiting for approval, off the invoice.
    chargeTo: (c: Loose) => { c.status = 'draft'; c.invoiceId = null; c.approvedAt = null; c.approvedBy = { id: '', name: '' }; },
    action: 'invoice_voided',
    note: (b: Loose) => b.reason
  }));

  return router;
}
