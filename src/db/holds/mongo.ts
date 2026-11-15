/** Cart & Holds on MongoDB: the code the routes used to hold, behind the store (types.ts). */
import type { ClientSession } from 'mongoose';
import { Cart, Hold, SlabReservation, HoldHistory, nextNumber } from '../../holds/models.ts';
import { newId } from '../ids.ts';
import type { Loose } from '../../types/records.ts';
import { HOLD_TABS, type HoldQuery, type HoldsStore } from './types.ts';

const DAY_MS = 86400000;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The status tab as a MongoDB filter. Expiring = still active, ends within 3 days. */
function statusClause(status: string, now: Date): Loose {
  switch (status) {
    case 'active': return { status: 'active', expiresAt: { $gt: now } };
    case 'expiring': return { status: 'active', expiresAt: { $gt: now, $lte: new Date(now.getTime() + 3 * DAY_MS) } };
    case 'expired': return { status: 'active', expiresAt: { $lte: now } };
    case 'released': return { status: 'released' };
    case 'converted': return { status: 'converted' };
    default: return {};
  }
}

function scopeFilter(scope: HoldQuery['scope']): Loose {
  if (scope.createdById !== undefined) return { 'createdBy.id': scope.createdById };
  if (scope.branch !== undefined) return { branch: scope.branch };
  if (scope.branches !== undefined) return { branch: { $in: scope.branches } };
  return {};
}

const sessionOpt = (session: ClientSession | null) => (session ? { session } : {});

export function mongoStore(session: ClientSession | null): HoldsStore {
  const s = sessionOpt(session);
  return {
    session,

    nextHoldNumber: () => nextNumber('hold', session as ClientSession),
    findHold: id => Hold.findById(id).session(session).lean() as Promise<Loose | null>,
    findHoldByRequestId: requestId => Hold.findOne({ requestId }).session(session).lean() as Promise<Loose | null>,
    async createHold(doc) {
      const [hold] = await Hold.create([doc], s);
      return hold.toObject() as Loose;
    },
    async saveHold(hold) {
      const { _id, __v, createdAt: _c, updatedAt: _u, ...rest } = hold;
      const set: Loose = { ...rest, slabKeys: (hold.lines || []).map((l: Loose) => l.slabKey) };
      for (const k of Object.keys(set)) if (set[k] === undefined) delete set[k];
      return Hold.findOneAndUpdate({ _id, __v }, { $set: set, $inc: { __v: 1 } }, { new: true, session, runValidators: true }).lean() as Promise<Loose | null>;
    },
    async listHolds(q) {
      const narrow: Loose[] = [scopeFilter(q.scope)];
      if (q.search) {
        const term = q.search.trim();
        const rx = new RegExp(escapeRegex(term), 'i');
        const or: Loose[] = [{ 'customer.name': rx }, { job: rx }, { slabKeys: term.toUpperCase() }];
        if (/^\d+$/.test(term)) or.push({ number: Number(term) });
        narrow.push({ $or: or });
      }
      if (q.from || q.to) {
        narrow.push({ createdAt: { ...(q.from && { $gte: new Date(`${q.from}T00:00:00Z`) }), ...(q.to && { $lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + DAY_MS) }) } });
      }
      const filter = { $and: [...narrow, statusClause(q.status, q.now)] };
      const [total, items, ...counts] = await Promise.all([
        Hold.countDocuments(filter),
        Hold.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        ...HOLD_TABS.map(tab => Hold.countDocuments({ $and: [...narrow, statusClause(tab, q.now)] }))
      ]);
      return { total, items: items as Loose[], counts: Object.fromEntries(HOLD_TABS.map((tab, i) => [tab, counts[i]])) as Record<(typeof HOLD_TABS)[number], number> };
    },
    async holdsToNote(now, limit) {
      const due = await Hold.find({ status: 'active', expiresAt: { $lte: now }, releaseAt: { $gt: now }, expiredNotedAt: null }, '_id').limit(limit).lean();
      return due.map(d => String(d._id));
    },
    async holdsToRelease(now, limit) {
      const due = await Hold.find({ status: 'active', releaseAt: { $lte: now } }, '_id').limit(limit).lean();
      return due.map(d => String(d._id));
    },

    async addHistory(entries) {
      if (!entries.length) return;
      const at = new Date();
      await HoldHistory.create(entries.map(e => ({ _id: newId(), at, ...e })), { ...s, ordered: true });
    },
    history: (holdId, limit) => HoldHistory.find({ holdId }).sort({ at: -1 }).limit(limit).lean() as Promise<Loose[]>,

    reservationsFor: keys => SlabReservation.find({ slabKey: { $in: keys } }).session(session).lean() as Promise<Loose[]>,
    async lockSlabs(hold, lines, by) {
      if (!lines.length) return [];
      try {
        await SlabReservation.insertMany(lines.map(l => ({
          _id: newId(), slabKey: l.slabKey, holdId: hold._id, holdNumber: hold.number, customerName: hold.customer?.name || '',
          branch: hold.branch, by, expiresOn: hold.expiresOn
        })), { ...s, ordered: true });
        return [];
      } catch (err) {
        if ((err as Error & Loose)?.code !== 11000) throw err;
        // Read outside the aborted transaction: what is committed now.
        return await SlabReservation.find({ slabKey: { $in: lines.map(l => l.slabKey) } }).lean() as Loose[];
      }
    },
    async unlockSlabs(holdId, slabKeys) { await SlabReservation.deleteMany({ holdId, slabKey: { $in: slabKeys } }, s); },
    async unlockHold(holdId) { await SlabReservation.deleteMany({ holdId }, s); },
    async updateLocks(holdId, set) { await SlabReservation.updateMany({ holdId }, { $set: set }, s); },
    locksAtBranches: branches => SlabReservation.find({ branch: { $in: branches } }, 'slabKey branch holdId updatedAt').session(session).sort({ _id: 1 }).lean() as Promise<Loose[]>,

    getCart: userId => Cart.findOne({ userId }).lean() as Promise<Loose | null>,
    async ensureCart(userId, userName) {
      const cart = await Cart.findOneAndUpdate(
        { userId },
        { $setOnInsert: { _id: newId(), userId, lines: [] }, $set: { userName } },
        { upsert: true, returnDocument: 'after', projection: 'lines.slabKey' }
      ).lean();
      return { slabKeys: (cart?.lines || []).map((l: Loose) => l.slabKey) };
    },
    async addCartLines(userId, lines) {
      const r = await Cart.updateOne({ userId, 'lines.slabKey': { $nin: lines.map(l => l.slabKey) } }, { $push: { lines: { $each: lines } } });
      return r.modifiedCount > 0;
    },
    async setCartCustomer(userId, userName, customer) {
      await Cart.updateOne({ userId }, { $setOnInsert: { _id: newId(), userId, lines: [] }, $set: { userName, customer } }, { upsert: true });
    },
    async setCartNote(userId, slabKey, note) {
      const r = await Cart.updateOne({ userId, 'lines.slabKey': slabKey }, { $set: { 'lines.$.note': note } });
      return r.matchedCount > 0;
    },
    async removeCartSlabs(userId, slabKeys) {
      await Cart.updateOne({ userId }, { $pull: { lines: { slabKey: { $in: slabKeys } } } }, s);
    },
    async clearCart(userId) {
      const cart = await Cart.findOne({ userId }, 'lines.slabKey').lean();
      await Cart.updateOne({ userId }, { $set: { lines: [], customer: null } });
      return (cart?.lines || []).map((l: Loose) => l.slabKey);
    },
    async othersWith(userId, slabKeys) {
      if (!slabKeys.length) return [];
      const carts = await Cart.find({ userId: { $ne: userId }, 'lines.slabKey': { $in: slabKeys } }, 'userName lines.slabKey').lean();
      return carts.map(c => ({ userName: c.userName || '', slabKeys: (c.lines || []).map((l: Loose) => l.slabKey) }));
    },
    async releaseFromCart(userId, slabKeys) {
      await Cart.updateOne({ userId }, { $pull: { lines: { slabKey: { $in: slabKeys } } } });
      const cart = await Cart.findOne({ userId }, 'lines').lean();
      if (cart && !cart.lines.length) await Cart.updateOne({ userId }, { $set: { customer: null } });
    }
  };
}
