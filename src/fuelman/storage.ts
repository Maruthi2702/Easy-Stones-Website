import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';
import { FuelState, FuelReport, FuelAssignment, FuelExpense, FuelAudit } from './models.ts';
import type { Actor, ReportRecord } from './models.ts';
import { buildReview, digest, unassignedExpenses } from './review.ts';
import type { Assignment } from './types.ts';
import { HttpError } from './http.ts';
export async function fleetTransaction<T>(scopeKey: string, work: (session: ClientSession) => Promise<T>): Promise<T> {
  await FuelState.createCollection();
  try { await FuelState.updateOne({ _id: scopeKey }, { $setOnInsert: { revision: 0 } }, { upsert: true }); }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error; }
  const session = await mongoose.startSession(); let result!: T;
  try {
    await session.withTransaction(async () => {
      await FuelState.updateOne({ _id: scopeKey }, { $inc: { revision: 1 } }, { session });
      result = await work(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally { await session.endSession(); }
}
export async function snapshot<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession(); let result!: T;
  try { await session.withTransaction(async () => { result = await work(session); }, { readConcern: { level: 'snapshot' } }); return result; }
  finally { await session.endSession(); }
}
export async function reportFor(id: string, session: ClientSession | null = null): Promise<ReportRecord> {
  const report = await FuelReport.findById(id).session(session).lean();
  if (!report) throw new HttpError(404, 'Report not found');
  return report;
}
export async function reviewFor(report: ReportRecord, session: ClientSession) {
  if (report.status !== 'draft' && report.frozenReview) {
    const facts = await FuelExpense.find({ reportId: report._id }).session(session).lean();
    return { ...report.frozenReview, unassigned: unassignedExpenses(report.parsed, facts, report.overrides), token: digest([String(report._id), report.__v, 'frozen', report.frozenReview.token]), facts };
  }
  const rows = await FuelAssignment.find({ scopeKey: report.scopeKey }).session(session).sort({ externalId: 1, from: 1 }).lean();
  const assignments: Assignment[] = rows.map(a => ({ id: String(a._id), externalId: a.externalId, reportedName: a.reportedName, driverKey: a.driverKey, driverName: a.driverName,
    from: a.from, to: a.to || '', allocations: a.allocations.map(p => ({ location: p.location, basisPoints: p.basisPoints })) }));
  return buildReview(report.parsed, assignments, report.dispositions, report.overrides, [String(report._id), report.__v, report.contentHash]);
}
export async function checkedDraft(id: string, version: number, token: string, session: ClientSession) {
  const report = await reportFor(id, session);
  if (report.status !== 'draft') throw new HttpError(409, 'Published reports retain their original assignments. Upload a correction to change them.');
  if (report.__v !== version || (await reviewFor(report, session)).token !== token) throw new HttpError(409, 'This review changed. Refresh before saving; your form remains open.');
  return report;
}
export async function history(report: ReportRecord, actor: Actor, action: string, note: string, detail: unknown, session: ClientSession) {
  await FuelAudit.create([{ reportId: report._id, scopeKey: report.scopeKey, actor, action, note, detail, at: new Date() }], { session });
}
