/**
 * Supplier POs and the supplier portal on MongoDB: the Mongoose code the routes used to hold, moved here
 * as it was. A record that is edited is loaded whole, changed with `set` / `push` and saved, so Mongoose's
 * own defaults, timestamps, password hash and version check all apply exactly as before.
 */
import mongoose from 'mongoose';
import { Supplier, SupplierLogin, SupplierPO, SupplierBlock } from '../../models/Suppliers.ts';
import type { HistoryLine, PoQuery, SuppliersStore } from './types.ts';
import type { Loose } from '../../types/records.ts';

const valid = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);
const validIds = (ids: unknown[]) => [...new Set(ids)].filter(valid);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isVersionError = (e: unknown) => (e as { name?: string })?.name === 'VersionError';
const plain = (doc: { toObject: () => unknown } | null): Loose | null => (doc ? doc.toObject() as Loose : null);

export function mongoStore(): SuppliersStore {
  const poFilter = (q: PoQuery): Record<string, unknown> => {
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.notCancelled) filter.status = { $ne: 'cancelled' };
    if (q.supplierId) filter.supplierId = q.supplierId;
    if (q.openOrSince) filter.$or = [{ status: 'open' }, { updatedAt: { $gte: q.openOrSince } }];
    return filter;
  };

  /** Load a record, change it, save it; `null` when it isn't there (or, with a version, has moved on). */
  async function change(model: mongoose.Model<Loose>, id: string, version: number | null, set: Loose, add: HistoryLine[]): Promise<Loose | null> {
    if (!valid(id)) return null;
    const doc = await model.findById(id);
    if (!doc || (version != null && doc.__v !== version)) return null;
    doc.set(set);
    for (const line of add) (doc as unknown as { history: unknown[] }).history.push(line);
    try { await doc.save(); } catch (error) { if (isVersionError(error)) return null; throw error; }
    return plain(doc);
  }

  return {
    // ── Suppliers ──
    listSuppliers: async () => await Supplier.find({}).sort({ active: -1, name: 1 }).lean() as Loose[],
    supplierById: async id => valid(id) ? plain(await Supplier.findById(id)) : null,
    suppliersByIds: async ids => await Supplier.find({ _id: { $in: validIds(ids) } }).lean() as Loose[],
    supplierNamed: async (name, exceptId) => await Supplier.findOne({ _id: { $ne: exceptId }, name: new RegExp(`^${escapeRegex(name)}$`, 'i') }).lean() as Loose | null,
    supplierBySpsKey: async (key, exceptId) => await Supplier.findOne({ _id: { $ne: exceptId }, spsKey: key }).lean() as Loose | null,
    createSupplier: async doc => (await Supplier.create(doc)).toObject() as Loose,
    updateSupplier: (id, set, add) => change(Supplier as unknown as mongoose.Model<Loose>, id, null, set, add),

    // ── Portal logins ──
    allLogins: async () => await SupplierLogin.find({}).lean() as Loose[],
    loginsOf: async (supplierId, options = {}) => await SupplierLogin.find({
      supplierId, ...(options.reachable || options.activeOnly ? { active: true } : {}), ...(options.reachable ? { password: { $gt: '' } } : {})
    }).lean() as Loose[],
    loginById: async id => valid(id) ? plain(await SupplierLogin.findById(id)) : null,
    loginByEmail: async (email, options = {}) => plain(await SupplierLogin.findOne({ email, ...(options.activeOnly ? { active: true } : {}) })),
    loginByLinkHash: async hash => plain(await SupplierLogin.findOne({ linkTokenHash: hash })),
    loginCount: supplierId => SupplierLogin.countDocuments({ supplierId }),
    emailTaken: async (email, exceptId) => Boolean(await SupplierLogin.exists({ email, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })),
    createLogin: async doc => (await SupplierLogin.create(doc)).toObject() as Loose,
    updateLogin: (id, set) => change(SupplierLogin as unknown as mongoose.Model<Loose>, id, null, set, []),
    endSessionsOf: async supplierId => { await SupplierLogin.updateMany({ supplierId }, { $inc: { sessionVersion: 1 } }); },

    // ── POs ──
    poById: async (id, options = {}) => valid(id) ? plain(await SupplierPO.findById(id, options.history === false ? '-history' : undefined)) : null,
    posByIds: async ids => await SupplierPO.find({ _id: { $in: validIds(ids) } }, '-history').lean() as Loose[],
    poByNumber: async poNumber => await SupplierPO.findOne({ poNumber }).lean() as Loose | null,
    poNumberTaken: async (poNumber, exceptId) => Boolean(await SupplierPO.exists({ poNumber, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })),
    listPos: async q => await SupplierPO.find(poFilter(q), '-history').sort({ updatedAt: -1 }).limit(q.limit ?? 3000).lean() as Loose[],
    createPo: async doc => (await SupplierPO.create(doc)).toObject() as Loose,
    updatePo: (id, version, set, add) => change(SupplierPO as unknown as mongoose.Model<Loose>, id, version, set, add),
    addPoHistory: async (id, line) => { await SupplierPO.updateOne({ _id: id }, { $push: { history: line } }); },

    // ── Blocks ──
    blockById: async id => valid(id) ? plain(await SupplierBlock.findById(id)) : null,
    blocksOfPo: async (poId, options = {}) => await SupplierBlock.find({ poId, ...(options.supplierId ? { supplierId: options.supplierId } : {}) }, options.history ? undefined : '-history')
      .sort(options.order === 'created' ? { createdAt: 1 } : { firstSentAt: 1, createdAt: 1 }).lean() as Loose[],
    blocksOfPos: async (poIds, options = {}) => await SupplierBlock.find({ poId: { $in: poIds }, ...(options.supplierId ? { supplierId: options.supplierId } : {}) }, '-history').lean() as Loose[],
    blocksWithBundleStatus: async (status, limit) => await SupplierBlock.find({ 'bundles.status': status } as never, '-history').sort({ sentAt: 1 }).limit(limit).lean() as Loose[],
    blocksFirstSentSince: async since => await SupplierBlock.find({ firstSentAt: { $gte: since } }, 'supplierId poId firstSentAt bundles').lean() as Loose[],
    blocksWithApproved: async poIds => await SupplierBlock.find({ poId: { $in: poIds }, 'bundles.status': 'approved' }, 'poId material thickness finish blockNumber size bundles').lean() as Loose[],
    createBlock: async doc => (await SupplierBlock.create(doc)).toObject() as Loose,
    updateBlock: (id, version, set, add) => change(SupplierBlock as unknown as mongoose.Model<Loose>, id, version, set, add),
    deleteUnsentBlock: async id => { await SupplierBlock.deleteOne({ _id: id, firstSentAt: null }); },
    renameUnsentBlocks: async (poId, lineId, to) => { await SupplierBlock.updateMany({ poId, lineId, sentAt: null }, { $set: to }); }
  };
}
