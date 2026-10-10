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
import mongoose from 'mongoose';
import { FREIGHT, CARRIERS, can } from './permissions.js';
import { Carrier, FreightCharge, CarrierInvoice, AccountingAudit, Payment } from './models.js';
import {
  normalizeCarrierName, editProblem, approveProblem, unapproveProblem, payProblem, voidProblem,
  invoiceChargesProblem, invoiceApproveProblem, invoicePayProblem, invoiceVoidProblem,
  canSeeBranch, branchClause, STATUS_LABELS, approvesWhenPaid, paymentBatchProblem
} from './freightRules.js';
import { newPaymentId } from './ids.js';
import { sumCents } from './money.js';
import * as S from './schemas.js';

const EXPORT_MAX_ROWS = 5000;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

const actor = (req) => ({ id: String(req.user?.id || ''), name: req.user?.displayName || req.user?.username || '' });
const branchesOf = (req) => req.user?.assignedLocations || [];

/** Any one of these permissions. */
const requireAny = (...perms) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (perms.some((p) => can(req.user, p))) return next();
  return res.status(403).json({ error: 'Your role doesn’t have access to this. Ask an admin to turn it on under Users & Roles.' });
};
const requireAll = (...perms) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (perms.every((p) => can(req.user, p))) return next();
  return res.status(403).json({ error: 'Your role doesn’t have access to this. Ask an admin to turn it on under Users & Roles.' });
};

const parse = (schema, data) => {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, S.firstIssue(r.error));
  return r.data;
};

/** Runs `fn(session)` as one transaction: all of it lands, or none of it. */
async function inTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => { out = await fn(session); });
    return out;
  } finally {
    await session.endSession();
  }
}

const history = (session, entries) => AccountingAudit.create(entries, { session, ordered: true });

const diff = (doc, set) => Object.entries(set)
  .filter(([f, v]) => String(doc[f] ?? '') !== String(v ?? ''))
  .map(([f, v]) => ({ field: f, from: doc[f] ?? null, to: v ?? null }));

const checkVersion = (doc, version, what = 'This charge') => {
  if (doc.__v !== version) throw new HttpError(409, `${what} was changed by someone else. Reload to see the latest, then try again.`);
};

/** The charge if it exists and is in one of the person's branches. */
async function chargeFor(req, id, session = null) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Charge not found.');
  const q = FreightCharge.findById(id);
  if (session) q.session(session);
  const doc = await q;
  if (!doc || !canSeeBranch(branchesOf(req), doc.location)) throw new HttpError(404, 'Charge not found.');
  return doc;
}

async function invoiceFor(req, id, session = null) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Invoice not found.');
  const q = CarrierInvoice.findById(id);
  if (session) q.session(session);
  const doc = await q;
  const mine = doc && (doc.locations || []).every((l) => canSeeBranch(branchesOf(req), l));
  if (!mine) throw new HttpError(404, 'Invoice not found.');
  return doc;
}

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err?.code === 11000) return res.status(409).json({ error: 'That already exists — check for a duplicate.' });
    if (err?.name === 'VersionError') return res.status(409).json({ error: 'Someone else changed this at the same moment. Reload and try again.' });
    console.error('[accounting]', req.method, req.originalUrl, err);
    return res.status(500).json({ error: 'Something went wrong on our side. Nothing was changed.' });
  }
};

/** A charge for the screens, with its carrier's name and terms. */
const present = (charge, carriersById) => {
  const c = charge.toObject ? charge.toObject() : charge;
  const carrier = c.carrierId ? carriersById.get(String(c.carrierId)) : null;
  return {
    ...c,
    version: c.__v,
    carrier: carrier ? { _id: carrier._id, name: carrier.name, paymentTerms: carrier.paymentTerms, active: carrier.active } : null,
    openFlags: (c.flags || []).filter((f) => !f.resolvedAt)
  };
};

const carriersMap = async (ids = null) => {
  const q = ids ? { _id: { $in: ids } } : {};
  const list = await Carrier.find(q).lean();
  return new Map(list.map((c) => [String(c._id), c]));
};

/**
 * Record a payment on a charge or invoice: approve it first if it's a draft
 * (one step), then mark it paid. Returns the history lines to write — two
 * for a one-step payment, so the approval is on the record as its own line.
 */
function markPaid(doc, body, by, now, paymentId, entityType, chargeNote = '') {
  const lines = [];
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
const priorPayment = async (requestId, session) => (requestId
  ? Payment.findOne({ requestId }).session(session).lean()
  : null);

/** The answer to a repeated request: what the first one paid, as it is now. */
async function replayed(req, payment) {
  if (!(payment.locations || []).every((l) => canSeeBranch(branchesOf(req), l))) throw new HttpError(404, 'Payment not found.');
  const [charges, carriers] = await Promise.all([
    FreightCharge.find({ _id: { $in: payment.chargeIds } }).lean(),
    carriersMap()
  ]);
  return { items: charges.map((c) => present(c, carriers)), payment, replayed: true };
}

/** A charge with an open review flag that still matters (not void). */
const NEEDS_REVIEW = Object.freeze({ flags: { $elemMatch: { resolvedAt: null } }, status: { $ne: 'void' } });

/** The Mongo filter for the charge list, from its (parsed) query. */
function chargeFilter(req, q, { ignoreStatus = false } = {}) {
  const branch = branchClause(branchesOf(req), q.location);
  if (!branch) throw new HttpError(403, 'You don’t have access to that branch.');
  const clauses = [branch];
  if (!ignoreStatus) {
    if (['draft', 'approved', 'paid', 'void'].includes(q.status)) clauses.push({ status: q.status });
    if (q.status === 'flagged') clauses.push(NEEDS_REVIEW);
    // The To approve tab: everything waiting on someone — a draft, or any
    // charge flagged for review (an approved or even paid one whose delivery
    // changed afterwards). An approved, flagged charge shows here and under
    // Approved.
    if (q.status === 'to_approve') clauses.push({ $or: [{ status: 'draft' }, NEEDS_REVIEW] });
    if (q.status === 'missing_price') clauses.push({ amountCents: null, status: 'draft' });
  }
  if (q.carrierId) clauses.push({ carrierId: new mongoose.Types.ObjectId(q.carrierId) });
  if (q.from || q.to) clauses.push({ deliveryDate: { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) } });
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    clauses.push({ $or: [{ soNumber: rx }, { customerName: rx }, { bolNumber: rx }, { carrierNameRaw: rx }, { description: rx }, { 'payment.paymentId': rx }, { 'payment.reference': rx }] });
  }
  return { $and: clauses };
}

export default function createAccountingRouter({ authenticate, sync = null } = {}) {
  const router = express.Router();
  router.use(authenticate);

  // ── Freight charges ────────────────────────────────────────────────────

  router.get('/freight-charges', requireAll(FREIGHT.VIEW), handle(async (req, res) => {
    const q = parse(S.listQuery, req.query);
    const filter = chargeFilter(req, q);
    const [total, docs, summaryRows, flagged, missing, toApprove] = await Promise.all([
      FreightCharge.countDocuments(filter),
      FreightCharge.find(filter).sort({ deliveryDate: -1, createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      FreightCharge.aggregate([
        { $match: chargeFilter(req, { ...q, status: 'all' }, { ignoreStatus: true }) },
        { $group: { _id: '$status', count: { $sum: 1 }, cents: { $sum: { $ifNull: ['$amountCents', 0] } } } }
      ]),
      FreightCharge.countDocuments(chargeFilter(req, { ...q, status: 'flagged' })),
      FreightCharge.countDocuments(chargeFilter(req, { ...q, status: 'missing_price' })),
      FreightCharge.countDocuments(chargeFilter(req, { ...q, status: 'to_approve' }))
    ]);
    const carriers = await carriersMap();
    const summary = Object.fromEntries(['draft', 'approved', 'paid', 'void'].map((s) => {
      const row = summaryRows.find((r) => r._id === s);
      return [s, { count: row?.count || 0, cents: row?.cents || 0 }];
    }));
    res.json({ items: docs.map((d) => present(d, carriers)), total, page: q.page, limit: q.limit, summary: { ...summary, flagged, missingPrice: missing, toApprove } });
  }));

  // Every row matching the filters, for PDF / Excel. (SPS has no import, so no
  // SPS file — owner, 2026-10-09; the Excel sheet is what gets keyed into it.)
  router.get('/freight-charges/export', requireAll(FREIGHT.VIEW, FREIGHT.EXPORT), handle(async (req, res) => {
    const q = parse(S.listQuery, { ...req.query, page: 1, limit: 100 });
    const filter = chargeFilter(req, q);
    const [total, docs] = await Promise.all([
      FreightCharge.countDocuments(filter),
      FreightCharge.find(filter).sort({ deliveryDate: -1, createdAt: -1 }).limit(EXPORT_MAX_ROWS).lean()
    ]);
    const carriers = await carriersMap();
    res.json({ items: docs.map((d) => present(d, carriers)), total, truncated: total > docs.length });
  }));

  router.get('/freight-charges/:id', requireAll(FREIGHT.VIEW), handle(async (req, res) => {
    const doc = await chargeFor(req, req.params.id);
    const carriers = await carriersMap(doc.carrierId ? [doc.carrierId] : []);
    const invoice = doc.invoiceId ? await CarrierInvoice.findById(doc.invoiceId, 'invoiceNumber status').lean() : null;
    const out = { ...present(doc, carriers), invoice };
    if (can(req.user, FREIGHT.HISTORY)) {
      out.history = await AccountingAudit.find({ entityType: 'charge', entityId: String(doc._id) }).sort({ at: -1, _id: -1 }).limit(200).lean();
    }
    res.json(out);
  }));

  router.get('/freight-charges/:id/history', requireAll(FREIGHT.VIEW, FREIGHT.HISTORY), handle(async (req, res) => {
    const doc = await chargeFor(req, req.params.id);
    res.json(await AccountingAudit.find({ entityType: 'charge', entityId: String(doc._id) }).sort({ at: -1, _id: -1 }).limit(500).lean());
  }));

  router.post('/freight-charges', requireAll(FREIGHT.VIEW, FREIGHT.ADD), handle(async (req, res) => {
    const body = parse(S.manualCharge, req.body);
    if (!canSeeBranch(branchesOf(req), body.location)) throw new HttpError(403, 'You don’t have access to that branch.');
    const carrier = await Carrier.findById(body.carrierId).lean();
    if (!carrier) throw new HttpError(400, 'That carrier doesn’t exist.');
    if (!carrier.active) throw new HttpError(400, `${carrier.name} is deactivated.`);
    const by = actor(req);
    const created = await inTransaction(async (session) => {
      const [doc] = await FreightCharge.create([{
        source: 'manual', location: body.location, deliveryDate: body.deliveryDate, carrierId: carrier._id,
        amountCents: body.amount, description: body.description, soNumber: body.soNumber,
        customerName: body.customerName, bolNumber: body.bolNumber, notes: body.notes,
        status: 'draft', createdBy: by, updatedBy: by
      }], { session });
      await history(session, [{ entityType: 'charge', entityId: String(doc._id), action: 'created', by, note: `Added by hand: ${body.description}` }]);
      return doc;
    });
    res.status(201).json(present(created, await carriersMap([carrier._id])));
  }));

  router.patch('/freight-charges/:id', requireAll(FREIGHT.VIEW, FREIGHT.EDIT), handle(async (req, res) => {
    const body = parse(S.chargeEdit, req.body);
    const by = actor(req);
    const saved = await inTransaction(async (session) => {
      const doc = await chargeFor(req, req.params.id, session);
      checkVersion(doc, body.version);
      const problem = editProblem(doc);
      if (problem) throw new HttpError(400, problem);
      const set = {};
      if (body.amount !== undefined) set.amountCents = body.amount;
      if (body.carrierId !== undefined) {
        if (body.carrierId) {
          const carrier = await Carrier.findById(body.carrierId).session(session).lean();
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
      await doc.save({ session });
      await history(session, [{ entityType: 'charge', entityId: String(doc._id), action: 'edited', by, changes }]);
      return doc;
    });
    res.json(present(saved, await carriersMap(saved.carrierId ? [saved.carrierId] : [])));
  }));

  /**
   * Approve / unapprove / pay several charges at once — all of them or none:
   * one charge that can't move stops the whole batch, with the reason.
   */
  const bulk = ({ schema, problemFor, apply, action, note }) => handle(async (req, res) => {
    const body = parse(schema, req.body);
    const by = actor(req);
    const done = await inTransaction(async (session) => {
      const docs = [];
      for (const item of body.items) {
        const doc = await chargeFor(req, item.id, session);
        checkVersion(doc, item.version, `SO# ${doc.soNumber || '—'}`);
        docs.push(doc);
      }
      const carriers = await carriersMap(docs.map((d) => d.carrierId).filter(Boolean));
      const problems = docs
        .map((d) => ({ id: String(d._id), soNumber: d.soNumber, problem: problemFor(d, carriers.get(String(d.carrierId))) }))
        .filter((p) => p.problem);
      if (problems.length) {
        const first = problems[0];
        throw new HttpError(400, `${first.soNumber ? `SO# ${first.soNumber}: ` : ''}${first.problem}`, { problems });
      }
      const entries = [];
      for (const doc of docs) {
        const before = { status: doc.status };
        apply(doc, body, by);
        doc.updatedBy = by;
        await doc.save({ session });
        entries.push({ entityType: 'charge', entityId: String(doc._id), action, by, changes: [{ field: 'status', from: before.status, to: doc.status }], note: note ? note(body) : '' });
      }
      await history(session, entries);
      return docs;
    });
    const carriers = await carriersMap();
    res.json({ items: done.map((d) => present(d, carriers)) });
  });

  router.post('/freight-charges/approve', requireAll(FREIGHT.VIEW, FREIGHT.APPROVE), bulk({
    schema: S.bulkItems,
    problemFor: (d, carrier) => approveProblem(d, carrier),
    apply: (d, _b, by) => { d.status = 'approved'; d.approvedAt = new Date(); d.approvedBy = by; },
    action: 'approved'
  }));

  router.post('/freight-charges/unapprove', requireAll(FREIGHT.VIEW, FREIGHT.APPROVE), bulk({
    schema: S.bulkItems,
    problemFor: (d) => unapproveProblem(d),
    apply: (d) => { d.status = 'draft'; d.approvedAt = null; d.approvedBy = { id: '', name: '' }; },
    action: 'unapproved'
  }));

  /**
   * Mark charges paid — one payment, to one carrier, all of them or none.
   * A draft is approved in the same step when the person can also approve
   * (payProblem); the history then shows both lines. The payment goes in the
   * register with its own PAY- id, copied onto each charge and history line.
   */
  router.post('/freight-charges/pay', requireAll(FREIGHT.VIEW, FREIGHT.PAY), handle(async (req, res) => {
    const body = parse(S.bulkPay, req.body);
    const by = actor(req);
    const canApprove = can(req.user, FREIGHT.APPROVE);
    const out = await inTransaction(async (session) => {
      const prior = await priorPayment(body.requestId, session);
      if (prior) return { prior };
      const docs = [];
      for (const item of body.items) {
        const doc = await chargeFor(req, item.id, session);
        checkVersion(doc, item.version, `SO# ${doc.soNumber || '—'}`);
        docs.push(doc);
      }
      const batch = paymentBatchProblem(docs);
      if (batch) throw new HttpError(400, batch);
      const carriers = await carriersMap(docs.map((d) => d.carrierId).filter(Boolean));
      const problems = docs
        .map((d) => ({ id: String(d._id), soNumber: d.soNumber, problem: payProblem(d, { carrier: carriers.get(String(d.carrierId)), canApprove }) }))
        .filter((p) => p.problem);
      if (problems.length) {
        const first = problems[0];
        throw new HttpError(400, `${first.soNumber ? `SO# ${first.soNumber}: ` : ''}${first.problem}`, { problems });
      }
      const now = new Date();
      const paymentId = newPaymentId(now);
      const entries = [];
      const oneStep = docs.some(approvesWhenPaid);
      for (const doc of docs) {
        entries.push(...markPaid(doc, body, by, now, paymentId, 'charge'));
        doc.updatedBy = by;
        await doc.save({ session });
      }
      const [payment] = await Payment.create([{
        paymentId, requestId: body.requestId, kind: 'charges', carrierId: docs[0].carrierId,
        chargeIds: docs.map((d) => d._id), locations: [...new Set(docs.map((d) => d.location))],
        totalCents: sumCents(docs.map((d) => d.amountCents)), paidOn: body.paidOn, method: body.method,
        reference: body.reference, approvedInSameStep: oneStep, recordedAt: now, recordedBy: by
      }], { session });
      await history(session, entries);
      return { docs, payment };
    });
    if (out.prior) return res.json(await replayed(req, out.prior));
    const carriers = await carriersMap();
    res.json({ items: out.docs.map((d) => present(d, carriers)), payment: out.payment.toObject() });
  }));

  router.post('/freight-charges/:id/void', requireAll(FREIGHT.VIEW, FREIGHT.VOID), handle(async (req, res) => {
    const body = parse(S.voidBody, req.body);
    const by = actor(req);
    const saved = await inTransaction(async (session) => {
      const doc = await chargeFor(req, req.params.id, session);
      checkVersion(doc, body.version);
      const problem = voidProblem(doc);
      if (problem) throw new HttpError(400, problem);
      const from = doc.status;
      doc.status = 'void';
      doc.voidedAt = new Date();
      doc.voidedBy = by;
      doc.voidReason = body.reason;
      doc.updatedBy = by;
      await doc.save({ session });
      await history(session, [{ entityType: 'charge', entityId: String(doc._id), action: 'voided', by, changes: [{ field: 'status', from, to: 'void' }], note: body.reason }]);
      return doc;
    });
    res.json(present(saved, await carriersMap()));
  }));

  // "I've looked at it": clears the review flags (the history keeps them).
  router.post('/freight-charges/:id/resolve-flags', requireAll(FREIGHT.VIEW, FREIGHT.EDIT), handle(async (req, res) => {
    const body = parse(S.versionOnly, req.body);
    const by = actor(req);
    const saved = await inTransaction(async (session) => {
      const doc = await chargeFor(req, req.params.id, session);
      checkVersion(doc, body.version);
      const open = doc.flags.filter((f) => !f.resolvedAt);
      if (!open.length) return doc;
      for (const f of open) { f.resolvedAt = new Date(); f.resolvedBy = by; }
      doc.updatedBy = by;
      await doc.save({ session });
      await history(session, [{ entityType: 'charge', entityId: String(doc._id), action: 'reviewed', by, note: open.map((f) => f.detail).join('; ') }]);
      return doc;
    });
    res.json(present(saved, await carriersMap()));
  }));

  // ── Payments ───────────────────────────────────────────────────────────

  // Look a payment up by its PAY- id: what went out, to whom, and every
  // charge it paid. Only when all of it is in the person's branches.
  router.get('/payments/:paymentId', requireAll(FREIGHT.VIEW), handle(async (req, res) => {
    const id = S.paymentIdParam.safeParse(req.params.paymentId);
    if (!id.success) throw new HttpError(404, 'Payment not found.');
    const payment = await Payment.findOne({ paymentId: id.data }).lean();
    if (!payment || !(payment.locations || []).every((l) => canSeeBranch(branchesOf(req), l))) throw new HttpError(404, 'Payment not found.');
    const [charges, carriers, invoice] = await Promise.all([
      FreightCharge.find({ _id: { $in: payment.chargeIds } }).sort({ deliveryDate: 1 }).lean(),
      carriersMap(),
      payment.invoiceId ? CarrierInvoice.findById(payment.invoiceId, 'invoiceNumber status totalCents').lean() : null
    ]);
    const carrier = payment.carrierId ? carriers.get(String(payment.carrierId)) : null;
    res.json({
      ...payment,
      carrier: carrier ? { _id: carrier._id, name: carrier.name } : null,
      invoice,
      charges: charges.map((c) => present(c, carriers))
    });
  }));

  // ── Carriers ───────────────────────────────────────────────────────────

  router.get('/carriers', requireAny(CARRIERS.VIEW, FREIGHT.VIEW), handle(async (req, res) => {
    const list = await Carrier.find().sort({ active: -1, name: 1 }).lean();
    res.json(list.map((c) => ({ ...c, version: c.__v })));
  }));

  const carrierAliasesClash = async (names, exceptId = null, session = null) => {
    const keys = names.map(normalizeCarrierName).filter(Boolean);
    const q = Carrier.find(exceptId ? { _id: { $ne: exceptId } } : {}, 'name nameKey aliases');
    if (session) q.session(session);
    const others = await q.lean();
    for (const o of others) {
      const theirs = [o.nameKey, ...(o.aliases || []).map(normalizeCarrierName)];
      const hit = keys.find((k) => theirs.includes(k));
      if (hit) return o.name;
    }
    return null;
  };

  router.post('/carriers', requireAll(CARRIERS.ADD), handle(async (req, res) => {
    const body = parse(S.carrierCreate, req.body);
    const by = actor(req);
    const nameKey = normalizeCarrierName(body.name);
    if (!nameKey) throw new HttpError(400, 'Enter the carrier name.');
    const clash = await carrierAliasesClash([body.name, ...body.aliases]);
    if (clash) throw new HttpError(409, `That name is already used by ${clash}.`);
    const created = await inTransaction(async (session) => {
      const [doc] = await Carrier.create([{ ...body, nameKey, createdBy: by, updatedBy: by }], { session });
      await history(session, [{ entityType: 'carrier', entityId: String(doc._id), action: 'created', by, note: `${doc.name} (${doc.paymentTerms === 'per_invoice' ? 'paid per invoice' : 'paid per delivery'})` }]);
      return doc;
    });
    if (sync) await sync.matchUnassigned(by).catch(() => {});
    res.status(201).json({ ...created.toObject(), version: created.__v });
  }));

  router.patch('/carriers/:id', requireAll(CARRIERS.EDIT), handle(async (req, res) => {
    const body = parse(S.carrierEdit, req.body);
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Carrier not found.');
    const by = actor(req);
    const saved = await inTransaction(async (session) => {
      const doc = await Carrier.findById(req.params.id).session(session);
      if (!doc) throw new HttpError(404, 'Carrier not found.');
      checkVersion(doc, body.version, 'This carrier');
      const set = {};
      if (body.name !== undefined) { set.name = body.name; set.nameKey = normalizeCarrierName(body.name); }
      if (body.aliases !== undefined) set.aliases = body.aliases;
      if (body.paymentTerms !== undefined) set.paymentTerms = body.paymentTerms;
      if (body.notes !== undefined) set.notes = body.notes;
      const clash = await carrierAliasesClash([set.name ?? doc.name, ...(set.aliases ?? doc.aliases)], doc._id, session);
      if (clash) throw new HttpError(409, `That name is already used by ${clash}.`);
      const changes = diff(doc, { ...set, aliases: set.aliases ? set.aliases.join(', ') : doc.aliases.join(', ') })
        .filter((c) => c.field !== 'nameKey');
      Object.assign(doc, set);
      doc.updatedBy = by;
      await doc.save({ session });
      if (changes.length) await history(session, [{ entityType: 'carrier', entityId: String(doc._id), action: 'edited', by, changes }]);
      return doc;
    });
    if (sync) await sync.matchUnassigned(by).catch(() => {});
    res.json({ ...saved.toObject(), version: saved.__v });
  }));

  const setCarrierActive = (active) => handle(async (req, res) => {
    const body = parse(S.versionOnly, req.body);
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Carrier not found.');
    const by = actor(req);
    const saved = await inTransaction(async (session) => {
      const doc = await Carrier.findById(req.params.id).session(session);
      if (!doc) throw new HttpError(404, 'Carrier not found.');
      checkVersion(doc, body.version, 'This carrier');
      if (doc.active === active) return doc;
      doc.active = active;
      doc.updatedBy = by;
      await doc.save({ session });
      await history(session, [{ entityType: 'carrier', entityId: String(doc._id), action: active ? 'reactivated' : 'deactivated', by }]);
      return doc;
    });
    res.json({ ...saved.toObject(), version: saved.__v });
  });
  router.post('/carriers/:id/deactivate', requireAll(CARRIERS.DEACTIVATE), setCarrierActive(false));
  router.post('/carriers/:id/reactivate', requireAll(CARRIERS.DEACTIVATE), setCarrierActive(true));

  // ── Carrier invoices ───────────────────────────────────────────────────

  const presentInvoice = (inv, carriers, charges = null) => {
    const o = inv.toObject ? inv.toObject() : inv;
    const carrier = carriers.get(String(o.carrierId));
    return {
      ...o, version: o.__v,
      carrier: carrier ? { _id: carrier._id, name: carrier.name, paymentTerms: carrier.paymentTerms } : null,
      ...(charges && { charges: charges.map((c) => present(c, carriers)) })
    };
  };

  /** Load and check charges for an invoice; returns the docs. */
  async function invoiceCharges(req, ids, carrierId, invoiceId, session) {
    const docs = [];
    for (const id of [...new Set(ids)]) docs.push(await chargeFor(req, id, session));
    const problem = invoiceChargesProblem(docs, carrierId, { invoiceId });
    if (problem) throw new HttpError(400, problem);
    return docs;
  }

  router.get('/carrier-invoices', requireAll(FREIGHT.VIEW), handle(async (req, res) => {
    const q = parse(S.invoiceListQuery, req.query);
    const mine = branchesOf(req).includes('*') ? {} : { locations: { $not: { $elemMatch: { $nin: branchesOf(req) } } } };
    const filter = { ...mine, ...(q.status !== 'all' && { status: q.status }), ...(q.carrierId && { carrierId: q.carrierId }) };
    const [total, docs] = await Promise.all([
      CarrierInvoice.countDocuments(filter),
      CarrierInvoice.find(filter).sort({ invoiceDate: -1, createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean()
    ]);
    const carriers = await carriersMap();
    res.json({ items: docs.map((d) => presentInvoice(d, carriers)), total, page: q.page, limit: q.limit });
  }));

  router.get('/carrier-invoices/:id', requireAll(FREIGHT.VIEW), handle(async (req, res) => {
    const inv = await invoiceFor(req, req.params.id);
    const charges = await FreightCharge.find({ _id: { $in: inv.chargeIds } }).lean();
    const carriers = await carriersMap();
    const out = presentInvoice(inv, carriers, charges);
    if (can(req.user, FREIGHT.HISTORY)) {
      out.history = await AccountingAudit.find({ entityType: 'invoice', entityId: String(inv._id) }).sort({ at: -1, _id: -1 }).limit(200).lean();
    }
    res.json(out);
  }));

  router.post('/carrier-invoices', requireAll(FREIGHT.VIEW, FREIGHT.ADD), handle(async (req, res) => {
    const body = parse(S.invoiceCreate, req.body);
    const carrier = await Carrier.findById(body.carrierId).lean();
    if (!carrier) throw new HttpError(400, 'That carrier doesn’t exist.');
    const by = actor(req);
    const created = await inTransaction(async (session) => {
      const charges = await invoiceCharges(req, body.chargeIds, carrier._id, null, session);
      const [inv] = await CarrierInvoice.create([{
        carrierId: carrier._id, invoiceNumber: body.invoiceNumber, invoiceDate: body.invoiceDate,
        totalCents: body.total, chargeIds: charges.map((c) => c._id), locations: [...new Set(charges.map((c) => c.location))],
        notes: body.notes, status: 'draft', createdBy: by, updatedBy: by
      }], { session });
      for (const c of charges) { c.invoiceId = inv._id; c.updatedBy = by; await c.save({ session }); }
      await history(session, [
        { entityType: 'invoice', entityId: String(inv._id), action: 'created', by, note: `${carrier.name} invoice #${inv.invoiceNumber}, ${charges.length} charge(s)` },
        ...charges.map((c) => ({ entityType: 'charge', entityId: String(c._id), action: 'added_to_invoice', by, note: `Invoice #${inv.invoiceNumber}` }))
      ]);
      return inv;
    });
    res.status(201).json(presentInvoice(created, await carriersMap()));
  }));

  router.patch('/carrier-invoices/:id', requireAll(FREIGHT.VIEW, FREIGHT.EDIT), handle(async (req, res) => {
    const body = parse(S.invoiceEdit, req.body);
    const by = actor(req);
    const saved = await inTransaction(async (session) => {
      const inv = await invoiceFor(req, req.params.id, session);
      checkVersion(inv, body.version, 'This invoice');
      if (inv.status !== 'draft') throw new HttpError(400, `A ${STATUS_LABELS[inv.status].toLowerCase()} invoice can't be edited.`);
      const set = {};
      if (body.invoiceNumber !== undefined) set.invoiceNumber = body.invoiceNumber;
      if (body.invoiceDate !== undefined) set.invoiceDate = body.invoiceDate;
      if (body.total !== undefined) set.totalCents = body.total;
      if (body.notes !== undefined) set.notes = body.notes;
      const changes = diff(inv, set);
      const entries = [];
      if (body.chargeIds) {
        const next = await invoiceCharges(req, body.chargeIds, inv.carrierId, inv._id, session);
        const nextIds = new Set(next.map((c) => String(c._id)));
        const removed = inv.chargeIds.filter((id) => !nextIds.has(String(id)));
        for (const id of removed) {
          const c = await FreightCharge.findById(id).session(session);
          if (c) { c.invoiceId = null; c.updatedBy = by; await c.save({ session }); entries.push({ entityType: 'charge', entityId: String(c._id), action: 'removed_from_invoice', by, note: `Invoice #${inv.invoiceNumber}` }); }
        }
        for (const c of next) {
          if (String(c.invoiceId || '') !== String(inv._id)) {
            c.invoiceId = inv._id; c.updatedBy = by; await c.save({ session });
            entries.push({ entityType: 'charge', entityId: String(c._id), action: 'added_to_invoice', by, note: `Invoice #${inv.invoiceNumber}` });
          }
        }
        if (removed.length || entries.length) changes.push({ field: 'charges', from: inv.chargeIds.length, to: next.length });
        inv.chargeIds = next.map((c) => c._id);
        inv.locations = [...new Set(next.map((c) => c.location))];
      }
      Object.assign(inv, set);
      inv.updatedBy = by;
      await inv.save({ session });
      if (changes.length) entries.unshift({ entityType: 'invoice', entityId: String(inv._id), action: 'edited', by, changes });
      if (entries.length) await history(session, entries);
      return inv;
    });
    res.json(presentInvoice(saved, await carriersMap()));
  }));

  /** Move an invoice and all its charges together. */
  const invoiceStep = ({ schema, problem, invoiceTo, chargeTo, action, note }) => handle(async (req, res) => {
    const body = parse(schema, req.body);
    const by = actor(req);
    const saved = await inTransaction(async (session) => {
      const inv = await invoiceFor(req, req.params.id, session);
      checkVersion(inv, body.version, 'This invoice');
      const charges = await FreightCharge.find({ _id: { $in: inv.chargeIds } }).session(session);
      const why = problem(inv, charges, body);
      if (why) throw new HttpError(400, why);
      const from = inv.status;
      invoiceTo(inv, body, by);
      inv.updatedBy = by;
      await inv.save({ session });
      const entries = [{ entityType: 'invoice', entityId: String(inv._id), action, by, changes: [{ field: 'status', from, to: inv.status }], note: note ? note(body) : '' }];
      for (const c of charges) {
        const cFrom = c.status;
        chargeTo(c, body, by, inv);
        c.updatedBy = by;
        await c.save({ session });
        entries.push({ entityType: 'charge', entityId: String(c._id), action, by, changes: [{ field: 'status', from: cFrom, to: c.status }], note: `Invoice #${inv.invoiceNumber}` });
      }
      await history(session, entries);
      return inv;
    });
    res.json(presentInvoice(saved, await carriersMap()));
  });

  router.post('/carrier-invoices/:id/approve', requireAll(FREIGHT.VIEW, FREIGHT.APPROVE), invoiceStep({
    schema: S.versionOnly,
    problem: (inv, charges) => invoiceApproveProblem(inv, charges),
    invoiceTo: (inv, _b, by) => { inv.status = 'approved'; inv.approvedAt = new Date(); inv.approvedBy = by; },
    chargeTo: (c, _b, by) => { c.status = 'approved'; c.approvedAt = new Date(); c.approvedBy = by; },
    action: 'approved'
  }));

  router.post('/carrier-invoices/:id/unapprove', requireAll(FREIGHT.VIEW, FREIGHT.APPROVE), invoiceStep({
    schema: S.versionOnly,
    problem: (inv) => (inv.status === 'approved' ? null : 'Only an approved invoice can go back to approval.'),
    invoiceTo: (inv) => { inv.status = 'draft'; inv.approvedAt = null; inv.approvedBy = { id: '', name: '' }; },
    chargeTo: (c) => { c.status = 'draft'; c.approvedAt = null; c.approvedBy = { id: '', name: '' }; },
    action: 'unapproved'
  }));

  // Pay an invoice: the invoice and every charge on it, as one payment.
  // A draft invoice is approved in the same step when the person can approve.
  router.post('/carrier-invoices/:id/pay', requireAll(FREIGHT.VIEW, FREIGHT.PAY), handle(async (req, res) => {
    const body = parse(S.invoicePay, req.body);
    const by = actor(req);
    const canApprove = can(req.user, FREIGHT.APPROVE);
    const out = await inTransaction(async (session) => {
      const prior = await priorPayment(body.requestId, session);
      if (prior) return { prior };
      const inv = await invoiceFor(req, req.params.id, session);
      checkVersion(inv, body.version, 'This invoice');
      const charges = await FreightCharge.find({ _id: { $in: inv.chargeIds } }).session(session);
      const why = invoicePayProblem(inv, charges, { canApprove });
      if (why) throw new HttpError(400, why);
      const now = new Date();
      const paymentId = newPaymentId(now);
      const oneStep = approvesWhenPaid(inv);
      const entries = markPaid(inv, body, by, now, paymentId, 'invoice');
      inv.updatedBy = by;
      await inv.save({ session });
      for (const c of charges) {
        entries.push(...markPaid(c, body, by, now, paymentId, 'charge', `Invoice #${inv.invoiceNumber}`));
        c.updatedBy = by;
        await c.save({ session });
      }
      await Payment.create([{
        paymentId, requestId: body.requestId, kind: 'invoice', carrierId: inv.carrierId, invoiceId: inv._id,
        chargeIds: charges.map((c) => c._id), locations: inv.locations, totalCents: inv.totalCents,
        paidOn: body.paidOn, method: body.method, reference: body.reference,
        approvedInSameStep: oneStep, recordedAt: now, recordedBy: by
      }], { session });
      await history(session, entries);
      return { inv };
    });
    if (out.prior) {
      const inv = out.prior.invoiceId ? await invoiceFor(req, String(out.prior.invoiceId)) : null;
      return res.json({ ...(inv && presentInvoice(inv, await carriersMap())), payment: out.prior, replayed: true });
    }
    res.json(presentInvoice(out.inv, await carriersMap()));
  }));

  router.post('/carrier-invoices/:id/void', requireAll(FREIGHT.VIEW, FREIGHT.VOID), invoiceStep({
    schema: S.voidBody,
    problem: (inv) => invoiceVoidProblem(inv),
    invoiceTo: (inv, b, by) => { inv.status = 'void'; inv.voidedAt = new Date(); inv.voidedBy = by; inv.voidReason = b.reason; },
    // The charges go back to waiting for approval, off the invoice.
    chargeTo: (c) => { c.status = 'draft'; c.invoiceId = null; c.approvedAt = null; c.approvedBy = { id: '', name: '' }; },
    action: 'invoice_voided',
    note: (b) => b.reason
  }));

  return router;
}
