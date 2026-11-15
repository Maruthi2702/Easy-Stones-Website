/** Accounting on MongoDB: the Mongoose code the router and the sync used to hold, behind the store (types.ts). */
import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';
import { Carrier, FreightCharge, CarrierInvoice, AccountingAudit, Payment } from '../../accounting/models.ts';
import { branchClause } from '../../accounting/freightRules.ts';
import { newId } from '../ids.ts';
import type { Loose } from '../../types/records.ts';
import type { AccountingStore, ChargeQuery } from './types.ts';

const escapeRegex = (s: unknown) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A charge with an open review flag that still matters (not void). */
const NEEDS_REVIEW = Object.freeze({ flags: { $elemMatch: { resolvedAt: null } }, status: { $ne: 'void' } });

/** The MongoDB filter for the charge list. A branch the person can't see is the route's 403 (so the clause is never null here). */
function chargeFilter(q: ChargeQuery, { ignoreStatus = false } = {}): Loose {
  const clauses: Loose[] = [branchClause(q.branches, q.location) ?? { location: { $in: [] } }];
  if (!ignoreStatus) {
    if (['draft', 'approved', 'paid', 'void'].includes(q.status)) clauses.push({ status: q.status });
    if (q.status === 'flagged') clauses.push(NEEDS_REVIEW);
    // The To approve tab: everything waiting on someone — a draft, or any charge flagged for review.
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

const valid = (id: unknown) => mongoose.isValidObjectId(id);

export function mongoStore(session: ClientSession | null): AccountingStore {
  const opt = session ? { session } : {};
  /** Saves the whole record only if it is still at its `__v` (→ null otherwise). */
  const guardedSave = async (Model: mongoose.Model<any>, doc: Loose): Promise<Loose | null> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { _id, __v, createdAt: _c, updatedAt: _u, ...rest } = doc;
    const set: Loose = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v;
    return Model.findOneAndUpdate({ _id, __v }, { $set: set, $inc: { __v: 1 } }, { new: true, session, runValidators: true }).lean() as Promise<Loose | null>;
  };
  const created = async (Model: mongoose.Model<any>, doc: Loose): Promise<Loose> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    // The id is made here (as on Postgres) so a retried request and the parity tests see the same one.
    const [made] = await Model.create([{ _id: newId(), ...doc }], opt);
    return made.toObject() as Loose;
  };

  return {
    session,

    carriers: ids => Carrier.find(ids ? { _id: { $in: ids } } : {}).sort({ active: -1, name: 1 }).session(session).lean() as Promise<Loose[]>,
    carrier: async id => (valid(id) ? (Carrier.findById(id).session(session).lean() as Promise<Loose | null>) : null),
    carriersExcept: exceptId => Carrier.find(exceptId ? { _id: { $ne: exceptId } } : {}, 'name nameKey aliases').session(session).lean() as Promise<Loose[]>,
    createCarrier: doc => created(Carrier, doc),
    saveCarrier: doc => guardedSave(Carrier, doc),
    chargesWaitingForCarrier: () => FreightCharge.find({ status: 'draft', carrierId: null, carrierNameRaw: { $ne: '' } }).session(session).lean() as Promise<Loose[]>,

    charge: async id => (valid(id) ? (FreightCharge.findById(id).session(session).lean() as Promise<Loose | null>) : null),
    chargesByIds: ids => FreightCharge.find({ _id: { $in: ids } }).session(session).lean() as Promise<Loose[]>,
    chargeForDelivery: deliveryId => FreightCharge.findOne({ deliveryId }).session(session).lean() as Promise<Loose | null>,
    async openDeliveryChargeIds() {
      const open = await FreightCharge.find({ source: 'delivery', status: { $ne: 'void' } }, 'deliveryId').session(session).lean();
      return open.map(c => c.deliveryId).filter((id): id is string => Boolean(id));
    },
    async list(q, page, limit) {
      const filter = chargeFilter(q);
      const [total, items, summaryRows, flagged, missingPrice, toApprove] = await Promise.all([
        FreightCharge.countDocuments(filter).session(session),
        FreightCharge.find(filter).sort({ deliveryDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).session(session).lean(),
        FreightCharge.aggregate([
          { $match: chargeFilter(q, { ignoreStatus: true }) },
          { $group: { _id: '$status', count: { $sum: 1 }, cents: { $sum: { $ifNull: ['$amountCents', 0] } } } }
        ]).session(session),
        FreightCharge.countDocuments(chargeFilter({ ...q, status: 'flagged' })).session(session),
        FreightCharge.countDocuments(chargeFilter({ ...q, status: 'missing_price' })).session(session),
        FreightCharge.countDocuments(chargeFilter({ ...q, status: 'to_approve' })).session(session)
      ]);
      const summary = Object.fromEntries(['draft', 'approved', 'paid', 'void'].map(s => {
        const row = summaryRows.find((r: Loose) => r._id === s);
        return [s, { count: row?.count || 0, cents: row?.cents || 0 }];
      }));
      return { total, items: items as Loose[], summary, flagged, missingPrice, toApprove };
    },
    async exportCharges(q, max) {
      const filter = chargeFilter(q);
      const [total, items] = await Promise.all([
        FreightCharge.countDocuments(filter).session(session),
        FreightCharge.find(filter).sort({ deliveryDate: -1, createdAt: -1 }).limit(max).session(session).lean()
      ]);
      return { total, items: items as Loose[] };
    },
    createCharge: doc => created(FreightCharge, doc),
    saveCharge: doc => guardedSave(FreightCharge, doc),

    invoice: async id => (valid(id) ? (CarrierInvoice.findById(id).session(session).lean() as Promise<Loose | null>) : null),
    async listInvoices(q) {
      const mine = q.branches.includes('*') ? {} : { locations: { $not: { $elemMatch: { $nin: q.branches } } } };
      const filter: Record<string, unknown> = { ...mine, ...(q.status !== 'all' && { status: q.status }), ...(q.carrierId && { carrierId: q.carrierId }) };
      const [total, items] = await Promise.all([
        CarrierInvoice.countDocuments(filter).session(session),
        CarrierInvoice.find(filter).sort({ invoiceDate: -1, createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).session(session).lean()
      ]);
      return { total, items: items as Loose[] };
    },
    createInvoice: doc => created(CarrierInvoice, doc),
    saveInvoice: doc => guardedSave(CarrierInvoice, doc),

    paymentByRequestId: requestId => Payment.findOne({ requestId }).session(session).lean() as Promise<Loose | null>,
    paymentByPaymentId: paymentId => Payment.findOne({ paymentId }).session(session).lean() as Promise<Loose | null>,
    createPayment: doc => created(Payment, doc),

    async addAudit(entries) { if (entries.length) await AccountingAudit.create(entries.map(e => ({ _id: newId(), at: new Date(), ...e })), { ...opt, ordered: true }); },
    auditFor: (entityType, entityId, limit) => AccountingAudit.find({ entityType, entityId } as Record<string, unknown>).sort({ at: -1, _id: -1 }).limit(limit).session(session).lean() as Promise<Loose[]>
  };
}
