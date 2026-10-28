import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';
import { FuelState, FuelReport, FuelAssignment, FuelExpense, FuelAudit } from './models.ts';
import type { Actor, ReportRecord } from './models.ts';
import { buildReview, digest, unassignedExpenses } from './review.ts';
import type { Assignment } from './types.ts';
import { HttpError } from './http.ts';
import { driverOptions } from './access.ts';
import { impliedAssignments } from './carryBack.ts';
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
// The scope key alone: publish/reverse/close/commands need it to open their transaction, and loading
// the whole report (every parsed line) just to read it is the most expensive way to ask.
export async function scopeOf(id: string): Promise<string> {
  const report = await FuelReport.findById(id, 'scopeKey').lean();
  if (!report) throw new HttpError(404, 'Report not found');
  return report.scopeKey;
}
export async function requireReport(id: string): Promise<void> {
  if (!(await FuelReport.exists({ _id: id }))) throw new HttpError(404, 'Report not found');
}
export async function reviewFor(report: ReportRecord, session: ClientSession) {
  if (report.status !== 'draft' && report.frozenReview) {
    const facts = await FuelExpense.find({ reportId: report._id }).session(session).lean();
    return { ...report.frozenReview, unassigned: unassignedExpenses(report.parsed, facts, report.overrides), token: digest([String(report._id), report.__v, 'frozen', report.frozenReview.token]), facts };
  }
  const rows = await FuelAssignment.find({ scopeKey: report.scopeKey }).session(session).sort({ externalId: 1, from: 1 }).lean();
  const assignments: Assignment[] = rows.map(a => ({ id: String(a._id), externalId: a.externalId, reportedName: a.reportedName, driverKey: a.driverKey, driverName: a.driverName,
    from: a.from, to: a.to || '', allocations: a.allocations.map(p => ({ location: p.location, basisPoints: p.basisPoints })) }));
  const context = [String(report._id), report.__v, report.contentHash], review = buildReview(report.parsed, assignments, report.dispositions, report.overrides, context);
  // Only when some driver has a later month's match does it cost anything: one read of the driver list and a second pass.
  if (!review.drivers.some(d => d.carriedFrom)) return review;
  const implied = impliedAssignments(review.drivers, await driverOptions(session));
  return implied.length ? buildReview(report.parsed, [...assignments, ...implied].sort((x, y) => x.externalId.localeCompare(y.externalId) || x.from.localeCompare(y.from)), report.dispositions, report.overrides, context) : review;
}
export async function checkedDraft(id: string, version: number, token: string, session: ClientSession) {
  const report = await reportFor(id, session);
  if (report.status !== 'draft') throw new HttpError(409, 'Published reports retain their original assignments. Upload a correction to change them.');
  const review = await reviewFor(report, session);
  if (report.__v !== version || review.token !== token) throw new HttpError(409, 'This review changed. Refresh before saving; your form remains open.');
  return { report, review };
}
export async function history(report: ReportRecord, actor: Actor, action: string, note: string, detail: unknown, session: ClientSession) {
  await FuelAudit.create([{ reportId: report._id, scopeKey: report.scopeKey, actor, action, note, detail, at: new Date() }], { session });
}
