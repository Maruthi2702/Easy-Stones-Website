/** Purchasing on MongoDB — the routes' own Mongoose calls, moved here unchanged. */
import type { ClientSession } from 'mongoose';
import { PurchasingScope, PurchasingInbound, PurchasingDraft, PurchasingLock, PurchasingPoLink } from '../../purchasing/models.ts';
import type { Loose } from '../../types/records.ts';
import type { PurchasingStore } from './types.ts';

export function mongoStore(session: ClientSession | null): PurchasingStore {
  return {
    session,
    listScopes: () => PurchasingScope.find({}).session(session).sort({ name: 1 }).lean() as unknown as Promise<Loose[]>,
    findScope: async id => (await PurchasingScope.findById(id).session(session).lean()) as Loose | null,
    async createScope(id, fields) {
      const [scope] = await PurchasingScope.create([{ _id: id, ...fields }], { session });
      return scope as unknown as Loose;
    },
    async updateScope(id, version, fields) {
      return (await PurchasingScope.findOneAndUpdate({ _id: id, __v: version },
        { $set: fields, $inc: { __v: 1 } }, { session, returnDocument: 'after' })) as unknown as Loose | null;
    },
    async draftUsesOtherBranch(scopeId, branches) {
      return !!(await PurchasingDraft.exists({ scopeId, lines: { $elemMatch: { branch: { $nin: branches } } } }).session(session));
    },
    async stampLegacyInboundBranches(scopeId, branches) {
      await PurchasingInbound.updateMany({ scopeId, branches: { $exists: false } }, { $set: { branches } }, { session: session ?? undefined });
    },

    async createInbound(id, doc) {
      const [result] = await PurchasingInbound.create([{ _id: id, ...doc }], { session });
      return result as unknown as Loose;
    },
    latestInbound: async scopeId => (await PurchasingInbound.findOne({ scopeId }).session(session)
      .sort({ createdAt: -1, _id: -1 }).lean()) as Loose | null,

    findDraft: async id => (await PurchasingDraft.findById(id).session(session).lean()) as Loose | null,
    activeDrafts: scopeId => PurchasingDraft.find({ scopeId, status: { $in: ['draft', 'approved'] } })
      .session(session).sort({ _id: -1 }).lean() as unknown as Promise<Loose[]>,
    pastDrafts: (scopeId, { before, limit }) => PurchasingDraft.find({ scopeId, ...(before ? { _id: { $lt: before } } : {}), status: { $nin: ['draft', 'approved'] } })
      .session(session).sort({ _id: -1 }).limit(limit).lean() as unknown as Promise<Loose[]>,
    async createDraft(id, doc, locks) {
      const [made] = await PurchasingDraft.create([{ _id: id, ...doc }], { session });
      await PurchasingLock.insertMany(locks.map(l => ({ ...l, draftId: id })), { session });
      return made as unknown as Loose;
    },
    async changeDraft(id, { version, fromStatus, status, linkedPoLines, entry }) {
      return (await PurchasingDraft.findOneAndUpdate({ _id: id, __v: version, status: fromStatus },
        { $set: { status, ...(linkedPoLines ? { linkedPoLines } : {}) }, $inc: { __v: 1 }, $push: { history: entry } },
        { session, returnDocument: 'after' })) as unknown as Loose | null;
    },
    async insertPoLinks(keys, draftId) {
      await PurchasingPoLink.insertMany(keys.map(key => ({ _id: key, draftId })), { session });
    },
    async releaseLocks(draftId) { await PurchasingLock.deleteMany({ draftId }, { session: session ?? undefined }); },
    async listLocks() {
      return (await PurchasingLock.find({}).session(session).lean()).map(lock => ({ _id: String(lock._id), draftId: lock.draftId }));
    }
  };
}
