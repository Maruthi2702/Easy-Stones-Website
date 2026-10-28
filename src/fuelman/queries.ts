import type { ClientSession } from 'mongoose';
import { FuelExpense, FuelPeriod, FuelReport } from './models.ts';
import type { ReportRecord } from './models.ts';
import type { CostFact, ReportDetail, ReportListItem, ReportReview } from './types.ts';
import { emptyAmounts } from './types.ts';
import { reviewFor } from './storage.ts';
import { locationTotals } from './review.ts';
import { HttpError } from './http.ts';
export interface Visibility { global: boolean; locations: string[] }
export function listItem(report: ReportRecord, facts?: CostFact[]): ReportListItem {
  return { id: String(report._id), version: report.__v, company: report.parsed.company, month: report.parsed.month,
    start: report.parsed.start, end: report.parsed.end, totalCents: facts ? facts.reduce((s, f) => s + f.amountCents, 0) : report.parsed.totalCents,
    employeeCount: facts ? new Set(facts.map(f => f.driverKey)).size : report.parsed.employees.length,
    lineCount: facts ? new Set(facts.map(f => f.sourceLine)).size : report.parsed.lines.length,
    filename: report.filename, status: report.status, revision: report.revision,
    importedAt: report.importedAt.toISOString(), importedBy: report.importedBy.name };
}
export async function visibleFacts(report: ReportRecord, visibility: Visibility, session: ClientSession): Promise<CostFact[] | undefined> {
  if (visibility.global) return undefined;
  const period = await FuelPeriod.findById(report.periodKey).session(session).lean();
  if (report.status !== 'posted' || String(period?.publishedReportId) !== String(report._id)) throw new HttpError(404, 'Report not found');
  const facts = await FuelExpense.find({ reportId: report._id, location: { $in: visibility.locations } }).session(session).lean();
  if (!facts.length) throw new HttpError(404, 'Report not found');
  return facts;
}
function scopedReview(full: ReportReview, facts: CostFact[]): ReportReview {
  const amounts = emptyAmounts(); facts.forEach(f => { amounts[f.category] += f.amountCents; });
  const drivers = full.drivers.filter(d => facts.some(f => f.externalId === d.externalId)).map(d => {
    const own = facts.filter(f => f.externalId === d.externalId), sum = own.reduce((s, f) => s + f.amountCents, 0), a = emptyAmounts();
    own.forEach(f => { a[f.category] += f.amountCents; });
    return { ...d, totalCents: sum, reportedTotalCents: sum, amounts: a, lineCount: new Set(own.map(f => f.sourceLine)).size,
      assignments: [], suggestions: [], locations: [...new Set(own.map(f => f.location))], issues: [], newIdentity: false };
  });
  const total = facts.reduce((s, f) => s + f.amountCents, 0);
  return { token: '', ready: true, issues: [], missing: [], drivers, locations: locationTotals(facts), unassigned: { amounts: emptyAmounts(), totalCents: 0, driverCount: 0, lineCount: 0 }, facts, totalCents: total, amounts, unresolvedCount: 0, allocatedCents: total, unallocatedCents: 0 };
}
export async function detailFor(report: ReportRecord, visibility: Visibility, session: ClientSession): Promise<ReportDetail> {
  const own = await visibleFacts(report, visibility, session), full = await reviewFor(report, session);
  const review = own ? scopedReview(full, own) : full;
  const { facts: _facts, ...publicReview } = review;
  const period = visibility.global ? await FuelPeriod.findById(report.periodKey).session(session).lean() : null;
  const previous = period?.publishedReportId ? await FuelReport.findById(period.publishedReportId, 'parsed.totalCents revision').session(session).lean() : null;
  return { ...listItem(report, own), account: visibility.global ? report.parsed.account : '', fleet: visibility.global ? report.parsed.fleet : '',
    pageCount: report.parsed.pageCount, review: publicReview, warnings: visibility.global ? report.parsed.warnings : ['Showing allocated expenses for your permitted locations.'],
    canViewSource: visibility.global, publishedAt: report.publishedAt?.toISOString(), note: visibility.global ? report.note : '',
    periodClosed: !!period?.closed, currentPublishedReportId: period?.publishedReportId ? String(period.publishedReportId) : null,
    currentPublishedTotalCents: previous?.parsed.totalCents ?? null, currentPublishedRevision: previous?.revision ?? null,
    priorDateLineCount: visibility.global ? report.parsed.lines.filter(l => l.date < report.parsed.start).length : 0,
  };
}
export async function listReports(visibility: Visibility, session: ClientSession, page: number, limit: number) {
  let ids: string[] | undefined;
  if (!visibility.global) {
    const known = await FuelExpense.distinct('reportId', { location: { $in: visibility.locations } }).session(session);
    ids = (await FuelPeriod.distinct('publishedReportId', { publishedReportId: { $in: known } }).session(session)).filter(Boolean).map(String);
  }
  const filter = ids ? { _id: { $in: ids } } : {};
  const total = await FuelReport.countDocuments(filter).session(session);
  const reports = await FuelReport.find(filter).session(session).sort({ 'parsed.month': -1, revision: -1, importedAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
  const items: ReportListItem[] = [];
  for (const report of reports) items.push(listItem(report, await visibleFacts(report, visibility, session)));
  return { items, total, page, limit };
}
// A branch reader only sees vehicle, site, date and identity, so only those can be searched;
// the company-wide view also searches the printed line and its amount.
function matchesSearch(line: { externalId: string; vehicle: string; site: string; date: string; description: string; amountCents: number }, search: string, full: boolean) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const text = [line.externalId, line.vehicle, line.site, line.date, ...(full ? [line.description, (line.amountCents / 100).toFixed(2)] : [])];
  return text.some(value => value.toLowerCase().includes(needle));
}
export async function linesFor(report: ReportRecord, visibility: Visibility, session: ClientSession, options: { externalId: string; unknownOnly: boolean; page: number; limit: number; search?: string; category?: string; priorOnly?: boolean }) {
  const own = await visibleFacts(report, visibility, session), lineIds = own ? new Set(own.map(f => f.sourceLine)) : null;
  const overrides = new Map(report.overrides.map(o => [o.index, o.category]));
  const rows = report.parsed.lines.filter(l => (!lineIds || lineIds.has(l.index)) && (!options.externalId || l.externalId === options.externalId))
    .map(l => ({ ...l, category: overrides.get(l.index) || l.category }))
    .filter(l => !options.unknownOnly || l.category === 'other')
    .filter(l => !options.category || l.category === options.category)
    .filter(l => !options.priorOnly || l.date < report.parsed.start)
    .filter(l => matchesSearch(l, options.search || '', !own));
  const visible = rows.slice((options.page - 1) * options.limit, options.page * options.limit).map(line => own ? { ...line,
    amountCents: own.filter(f => f.sourceLine === line.index).reduce((n, f) => n + f.amountCents, 0),
    description: `${line.category} · allocated share`, quantity: '', netPrice: '', taxRate: '', exceptionCodes: [],
  } : line);
  return { items: visible, total: rows.length, page: options.page, limit: options.limit };
}
export async function monthlyFacts(month: string, visibility: Visibility, session: ClientSession) {
  const ids = await FuelPeriod.distinct('publishedReportId', { month, publishedReportId: { $ne: null } }).session(session);
  return FuelExpense.find({ month, reportId: { $in: ids }, ...(visibility.global ? {} : { location: { $in: visibility.locations } }) }).session(session).lean();
}
export async function pnlFor(month: string, visibility: Visibility, session: ClientSession) {
  const previousMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const facts = await monthlyFacts(month, visibility, session), prior = await monthlyFacts(previousMonth, visibility, session);
  const total = facts.reduce((s, f) => s + f.amountCents, 0), previous = prior.reduce((s, f) => s + f.amountCents, 0);
  const drivers = new Map<string, { driverKey: string; driverName: string; totalCents: number; locations: string[] }>();
  for (const f of facts) {
    const d = drivers.get(f.driverKey) || { driverKey: f.driverKey, driverName: f.driverName, totalCents: 0, locations: [] };
    d.totalCents += f.amountCents; if (!d.locations.includes(f.location)) d.locations.push(f.location); drivers.set(f.driverKey, d);
  }
  return { month, source: 'fuel_man' as const, accountingBasis: 'statement-month' as const, totalCents: total,
    locations: locationTotals(facts), drivers: [...drivers.values()].sort((a, b) => b.totalCents - a.totalCents),
    reportCount: new Set(facts.map(f => String(f.reportId))).size, previousMonth, previousTotalCents: previous,
    changePercent: previous ? Math.round((total - previous) / Math.abs(previous) * 10000) / 100 : null };
}
