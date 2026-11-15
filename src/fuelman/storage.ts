import { fleetTransactionOf, snapshotOf, fuelStore } from '../db/fuelman/index.ts';
import type { Actor, FuelStore, ReportRecord } from '../db/fuelman/index.ts';
import { buildReview, digest, unassignedExpenses } from './review.ts';
import type { Assignment } from './types.ts';
import { HttpError } from './http.ts';
import { driverOptions } from './access.ts';
import { impliedAssignments } from './carryBack.ts';
import { newId } from '../db/ids.ts';
/** A write that lands whole and counts as one revision of the fleet. */
export const fleetTransaction = fleetTransactionOf;
/** One consistent look at the data. */
export const snapshot = snapshotOf;
export async function reportFor(id: string, store: FuelStore): Promise<ReportRecord> {
  const report = await store.getReport(id);
  if (!report) throw new HttpError(404, 'Report not found');
  return report;
}
// The scope key alone: publish/reverse/close/commands need it to open their transaction, and loading
// the whole report (every parsed line) just to read it is the most expensive way to ask.
export async function scopeOf(id: string): Promise<string> {
  const scope = await (await fuelStore()).reportScope(id);
  if (scope === null) throw new HttpError(404, 'Report not found');
  return scope;
}
export async function requireReport(id: string): Promise<void> {
  if (!(await (await fuelStore()).reportExists(id))) throw new HttpError(404, 'Report not found');
}
export async function reviewFor(report: ReportRecord, store: FuelStore) {
  if (report.status !== 'draft' && report.frozenReview) {
    const facts = await store.factsOfReport(report._id);
    return { ...report.frozenReview, unassigned: unassignedExpenses(report.parsed, facts, report.overrides), token: digest([String(report._id), report.__v, 'frozen', report.frozenReview.token]), facts };
  }
  const rows = await store.assignmentsOfScope(report.scopeKey);
  const assignments: Assignment[] = rows.map(a => ({ id: String(a._id), externalId: a.externalId, reportedName: a.reportedName, driverKey: a.driverKey, driverName: a.driverName,
    from: a.from, to: a.to || '', allocations: a.allocations.map(p => ({ location: p.location, basisPoints: p.basisPoints })) }));
  const context = [String(report._id), report.__v, report.contentHash], review = buildReview(report.parsed, assignments, report.dispositions, report.overrides, context);
  // Only when some driver has a later month's match does it cost anything: one read of the driver list and a second pass.
  if (!review.drivers.some(d => d.carriedFrom)) return review;
  const implied = impliedAssignments(review.drivers, await driverOptions(store.session));
  return implied.length ? buildReview(report.parsed, [...assignments, ...implied].sort((x, y) => x.externalId.localeCompare(y.externalId) || x.from.localeCompare(y.from)), report.dispositions, report.overrides, context) : review;
}
export async function checkedDraft(id: string, version: number, token: string, store: FuelStore) {
  const report = await reportFor(id, store);
  if (report.status !== 'draft') throw new HttpError(409, 'Published reports retain their original assignments. Upload a correction to change them.');
  const review = await reviewFor(report, store);
  if (report.__v !== version || review.token !== token) throw new HttpError(409, 'This review changed. Refresh before saving; your form remains open.');
  return { report, review };
}
export async function history(report: ReportRecord, actor: Actor, action: string, note: string, detail: unknown, store: FuelStore) {
  await store.addAudit({ id: newId(), reportId: report._id, scopeKey: report.scopeKey, actor, action, note, detail, at: new Date() });
}
