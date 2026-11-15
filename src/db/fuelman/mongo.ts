/** Fuel Man on MongoDB: the Mongoose code the routes used to hold, behind the store (types.ts). */
import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';
import { FuelReport, FuelAssignment, FuelSource, FuelExpense, FuelState, FuelPeriod, FuelAudit } from '../../fuelman/models.ts';
import { newId } from '../ids.ts';
import type {
  AssignmentRecord, AuditRecord, FactRecord, FuelStore, ListRow, PeriodRecord, ReportRecord
} from './types.ts';

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const oids = (ids: string[]) => ids.map(oid);
const withId = <T extends { _id: unknown }>(d: T) => ({ ...d, _id: String(d._id) });
/** An assignment as the store answers it: no `__v` (Postgres keeps none, and the audit saves these rows). */
const assignmentOf = (d: { _id: unknown }) => { const { __v: _v, ...rest } = withId(d) as { __v?: number }; return rest as unknown as AssignmentRecord; };
const factOf = (d: { _id: unknown; reportId: unknown }) => ({ ...d, _id: String(d._id), reportId: String(d.reportId) }) as unknown as FactRecord;
const periodOf = (d: { publishedReportId?: unknown }) => ({ ...d, publishedReportId: d.publishedReportId ? String(d.publishedReportId) : null }) as unknown as PeriodRecord;
const byLocations = (locations?: string[]) => (locations ? { location: { $in: locations } } : {});

export function mongoStore(session: ClientSession | null): FuelStore {
  return {
    session,

    async getReport(id) {
      const d = await FuelReport.findById(id).session(session).lean();
      return d ? (withId(d) as unknown as ReportRecord) : null;
    },
    async reportScope(id) {
      return (await FuelReport.findById(id, 'scopeKey').session(session).lean())?.scopeKey ?? null;
    },
    async reportExists(id) { return !!(await FuelReport.exists({ _id: id })); },
    async reportTotals(id) {
      const d = await FuelReport.findById(id, 'parsed.totalCents revision').session(session).lean();
      return d ? { totalCents: d.parsed.totalCents, revision: d.revision } : null;
    },
    async findDuplicate({ fileHash, scopeKey, contentHash }) {
      const d = await FuelReport.findOne({ $or: [{ fileHash }, { scopeKey, contentHash }] }, 'parsed.month').session(session).lean();
      return d ? { id: String(d._id), month: d.parsed.month } : null;
    },
    async latestRevision(periodKey) {
      return (await FuelReport.findOne({ periodKey }, 'revision').session(session).sort({ revision: -1 }).lean())?.revision ?? 0;
    },
    async createReport(id, doc, pdf) {
      const [report] = await FuelReport.create([{ _id: id, ...doc }], { session });
      await FuelSource.create([{ _id: newId(), reportId: report!._id, pdf }], { session });
      return withId(report!.toObject()) as unknown as ReportRecord;
    },
    async updateReport(id, change) {
      const { bump, version, ...set } = change;
      const update: Record<string, unknown> = {};
      if (Object.keys(set).length) update.$set = set;
      if (bump) update.$inc = { __v: 1 };
      const filter = version === undefined ? { _id: id } : { _id: id, __v: version };
      const result = await FuelReport.updateOne(filter, update, { session });
      return result.matchedCount > 0;
    },
    async listReports({ ids, page, limit }) {
      const filter = ids ? { _id: { $in: oids(ids) } } : {};
      const total = await FuelReport.countDocuments(filter).session(session);
      const rows = await FuelReport.aggregate<ListRow & { _id: mongoose.Types.ObjectId }>([
        { $match: filter }, { $sort: { 'parsed.month': -1, revision: -1, importedAt: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit },
        { $project: { __v: 1, filename: 1, status: 1, revision: 1, importedAt: 1, importedBy: 1,
          'parsed.company': 1, 'parsed.month': 1, 'parsed.start': 1, 'parsed.end': 1, 'parsed.totalCents': 1,
          employeeCount: { $size: { $ifNull: ['$parsed.employees', []] } }, lineCount: { $size: { $ifNull: ['$parsed.lines', []] } } } },
      ]).session(session);
      return { total, rows: rows.map(withId) as unknown as ListRow[] };
    },
    async sourcePdf(reportId) {
      const source = await FuelSource.findOne({ reportId }).select('+pdf');
      return source ? source.pdf : null;
    },
    async revisionTotal() {
      return (await FuelState.find({}, 'revision').lean()).reduce((n, s) => n + s.revision, 0);
    },

    async assignmentsOfScope(scopeKey) {
      return (await FuelAssignment.find({ scopeKey }).session(session).sort({ externalId: 1, from: 1 }).lean()).map(assignmentOf);
    },
    async assignmentsOf(scopeKey, externalIds) {
      return (await FuelAssignment.find({ scopeKey, externalId: { $in: externalIds } }).session(session).sort({ from: 1 }).lean()).map(assignmentOf);
    },
    async assignmentById(id, scopeKey, externalId) {
      const d = await FuelAssignment.findOne({ _id: id, scopeKey, externalId }).session(session).lean();
      return d ? assignmentOf(d) : null;
    },
    async assignmentUpTo(scopeKey, externalId, day) {
      const d = await FuelAssignment.findOne({ scopeKey, externalId, from: { $lte: day } }).session(session).sort({ from: -1 }).lean();
      return d ? assignmentOf(d) : null;
    },
    async assignmentAfter(scopeKey, externalId, from) {
      const d = await FuelAssignment.findOne({ scopeKey, externalId, from: { $gt: from } }).session(session).sort({ from: 1 }).lean();
      return d ? assignmentOf(d) : null;
    },
    async assignmentsOpenAt(scopeKey, externalId, day) {
      return (await FuelAssignment.find({ scopeKey, externalId, from: { $lte: day }, $or: [{ to: '' }, { to: { $gt: day } }] }).session(session).lean())
        .map(assignmentOf);
    },
    async setAssignmentEnd(ids, to, actor) {
      if (!ids.length) return;
      await FuelAssignment.updateMany({ _id: { $in: oids(ids) } }, { $set: { to, updatedBy: actor, updatedAt: new Date() } }, { session });
    },
    async saveAssignment(id, a) {
      await FuelAssignment.findOneAndUpdate({ scopeKey: a.scopeKey, externalId: a.externalId, from: a.from }, { $set: a, $setOnInsert: { _id: id } }, { session, upsert: true });
    },
    async addAssignmentsIfAbsent(list) {
      if (!list.length) return;
      await FuelAssignment.bulkWrite(list.map(({ id, a }) => ({ updateOne: {
        filter: { scopeKey: a.scopeKey, externalId: a.externalId, from: a.from },
        update: { $setOnInsert: { _id: id, ...a } }, upsert: true } })), { session });
    },

    async factsOfReport(reportId, locations) {
      return (await FuelExpense.find({ reportId, ...byLocations(locations) }).session(session).sort({ sourceLine: 1, location: 1, _id: 1 }).lean()).map(factOf);
    },
    async addFacts(list) {
      for (let n = 0; n < list.length; n += 1000)
        await FuelExpense.insertMany(list.slice(n, n + 1000).map(({ id, fact }) => ({ ...fact, _id: id })), { session });
    },
    async reportsWithFacts(locations) {
      return (await FuelExpense.distinct('reportId', { location: { $in: locations } }).session(session)).map(String);
    },
    async ownShares(reportIds, locations) {
      const grouped = await FuelExpense.aggregate<{ _id: mongoose.Types.ObjectId; totalCents: number; drivers: string[]; lines: number[] }>([
        { $match: { reportId: { $in: oids(reportIds) }, location: { $in: locations } } },
        { $group: { _id: '$reportId', totalCents: { $sum: '$amountCents' }, drivers: { $addToSet: '$driverKey' }, lines: { $addToSet: '$sourceLine' } } },
      ]).session(session);
      return grouped.map(g => ({ reportId: String(g._id), totalCents: g.totalCents, driverCount: g.drivers.length, lineCount: g.lines.length }));
    },
    async locationCents(month, reportIds, locations) {
      if (!reportIds.length) return [];
      const rows = await FuelExpense.aggregate<{ _id: string; cents: number }>([
        { $match: { month, reportId: { $in: oids(reportIds) }, ...byLocations(locations) } },
        { $group: { _id: '$location', cents: { $sum: '$amountCents' } } },
      ]).session(session);
      return rows.map(r => ({ location: r._id, cents: r.cents }));
    },
    async monthFacts(month, reportIds, locations) {
      return (await FuelExpense.find({ month, reportId: { $in: reportIds }, ...byLocations(locations) }).session(session).sort({ reportId: 1, sourceLine: 1, location: 1, _id: 1 }).lean()).map(factOf);
    },

    async period(id) {
      const d = await FuelPeriod.findById(id).session(session).lean();
      return d ? periodOf(d) : null;
    },
    async ensurePeriod(id, scopeKey, month) {
      await FuelPeriod.updateOne({ _id: id }, { $setOnInsert: { scopeKey, month, closed: false } }, { upsert: true, session });
    },
    async updatePeriod(id, change) {
      await FuelPeriod.updateOne({ _id: id }, { $set: change }, { session });
    },
    async publishedReportIds(month) {
      return (await FuelPeriod.distinct('publishedReportId', { month, publishedReportId: { $ne: null } }).session(session)).map(String);
    },
    async publishedAmong(reportIds) {
      return (await FuelPeriod.distinct('publishedReportId', { publishedReportId: { $in: oids(reportIds) } }).session(session)).filter(Boolean).map(String);
    },

    async addAudit({ id, ...entry }) {
      await FuelAudit.create([{ _id: id, ...entry }], { session });
    },
    async auditPage(reportId, page, limit) {
      const total = await FuelAudit.countDocuments({ reportId }).session(session);
      const items = await FuelAudit.find({ reportId }).session(session).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean();
      return { total, items: items.map(d => ({ ...d, _id: String(d._id), reportId: String(d.reportId) })) as unknown as AuditRecord[] };
    },
  };
}
