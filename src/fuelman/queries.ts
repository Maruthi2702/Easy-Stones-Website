import type { FuelStore, ListRow, ReportRecord } from '../db/fuelman/index.ts';
import type { Comparison, CostFact, ReportDetail, ReportListItem, ReportReview } from './types.ts';
import { emptyAmounts } from './types.ts';
import { reviewFor } from './storage.ts';
import { locationTotals } from './review.ts';
import { HttpError } from './http.ts';
export interface Visibility { global: boolean; locations: string[] }
interface OwnShare { totalCents: number; employeeCount: number; lineCount: number }
function rowItem(row: ListRow, own?: OwnShare): ReportListItem {
  return { id: row._id, version: row.__v, company: row.parsed.company, month: row.parsed.month,
    start: row.parsed.start, end: row.parsed.end, totalCents: own ? own.totalCents : row.parsed.totalCents,
    employeeCount: own ? own.employeeCount : row.employeeCount, lineCount: own ? own.lineCount : row.lineCount,
    filename: row.filename, status: row.status, revision: row.revision,
    importedAt: row.importedAt.toISOString(), importedBy: row.importedBy.name };
}
const shareOf = (facts: CostFact[]): OwnShare => ({ totalCents: facts.reduce((s, f) => s + f.amountCents, 0),
  employeeCount: new Set(facts.map(f => f.driverKey)).size, lineCount: new Set(facts.map(f => f.sourceLine)).size });
export function listItem(report: ReportRecord, facts?: CostFact[]): ReportListItem {
  return rowItem({ ...report, employeeCount: report.parsed.employees.length, lineCount: report.parsed.lines.length }, facts && shareOf(facts));
}
export async function visibleFacts(report: ReportRecord, visibility: Visibility, store: FuelStore): Promise<CostFact[] | undefined> {
  if (visibility.global) return undefined;
  const period = await store.period(report.periodKey);
  if (report.status !== 'posted' || period?.publishedReportId !== report._id) throw new HttpError(404, 'Report not found');
  const facts = await store.factsOfReport(report._id, visibility.locations);
  if (!facts.length) throw new HttpError(404, 'Report not found');
  return facts;
}
function scopedReview(full: ReportReview, facts: CostFact[]): ReportReview {
  const amounts = emptyAmounts(); facts.forEach(f => { amounts[f.category] += f.amountCents; });
  const factsOf = new Map<string, CostFact[]>();
  for (const f of facts) { const list = factsOf.get(f.externalId); if (list) list.push(f); else factsOf.set(f.externalId, [f]); }
  const drivers = full.drivers.filter(d => factsOf.has(d.externalId)).map(d => {
    const own = factsOf.get(d.externalId)!, sum = own.reduce((s, f) => s + f.amountCents, 0), a = emptyAmounts();
    own.forEach(f => { a[f.category] += f.amountCents; });
    return { ...d, totalCents: sum, reportedTotalCents: sum, amounts: a, lineCount: new Set(own.map(f => f.sourceLine)).size,
      assignments: [], suggestions: [], carriedFrom: undefined, locations: [...new Set(own.map(f => f.location))], issues: [], newIdentity: false };
  });
  const total = facts.reduce((s, f) => s + f.amountCents, 0);
  return { token: '', ready: true, issues: [], missing: [], drivers, locations: locationTotals(facts), unassigned: { amounts: emptyAmounts(), totalCents: 0, driverCount: 0, lineCount: 0 }, facts, totalCents: total, amounts, unresolvedCount: 0, allocatedCents: total, unallocatedCents: 0 };
}
export const monthBefore = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
// The month's published figures straight from the database: only totals are needed, so no fact is shipped.
async function monthTotals(month: string, visibility: Visibility, store: FuelStore) {
  const ids = await store.publishedReportIds(month);
  if (!ids.length) return { totalCents: 0, locations: [] as { location: string; cents: number }[] };
  const rows = await store.locationCents(month, ids, visibility.global ? undefined : visibility.locations);
  const locations = rows.sort((a, b) => a.location.localeCompare(b.location));
  return { totalCents: locations.reduce((n, l) => n + l.cents, 0), locations };
}
async function comparisonFor(report: ReportRecord, review: ReportReview, store: FuelStore): Promise<Comparison | null> {
  const previousMonth = monthBefore(report.parsed.month), previous = await monthTotals(previousMonth, { global: true, locations: [] }, store);
  const carriedOverCount = review.drivers.filter(d => d.driverKey && d.assignments.some(a => a.from < report.parsed.start)).length;
  if (!previous.locations.length) return carriedOverCount ? { previousMonth, previousTotalCents: 0, locations: [], carriedOverCount } : null;
  return { previousMonth, previousTotalCents: previous.totalCents, carriedOverCount,
    locations: previous.locations.map(l => ({ location: l.location, previousCents: l.cents })) };
}
export async function detailFor(report: ReportRecord, visibility: Visibility, store: FuelStore): Promise<ReportDetail> {
  const own = await visibleFacts(report, visibility, store), full = await reviewFor(report, store);
  const review = own ? scopedReview(full, own) : full;
  const { facts: _facts, ...publicReview } = review;
  const period = visibility.global ? await store.period(report.periodKey) : null;
  const previous = period?.publishedReportId ? await store.reportTotals(period.publishedReportId) : null;
  const compare = visibility.global ? await comparisonFor(report, full, store) : null;
  return { ...listItem(report, own), compare, account: visibility.global ? report.parsed.account : '', fleet: visibility.global ? report.parsed.fleet : '',
    pageCount: report.parsed.pageCount, review: publicReview, warnings: visibility.global ? report.parsed.warnings : ['Showing allocated expenses for your permitted locations.'],
    canViewSource: visibility.global, publishedAt: report.publishedAt?.toISOString(), note: visibility.global ? report.note : '',
    periodClosed: !!period?.closed, currentPublishedReportId: period?.publishedReportId ?? null,
    currentPublishedTotalCents: previous?.totalCents ?? null, currentPublishedRevision: previous?.revision ?? null,
    priorDateLineCount: visibility.global ? report.parsed.lines.filter(l => l.date < report.parsed.start).length : 0,
  };
}
export async function listReports(visibility: Visibility, store: FuelStore, page: number, limit: number) {
  let ids: string[] | undefined;
  if (!visibility.global) ids = await store.publishedAmong(await store.reportsWithFacts(visibility.locations));
  const { total, rows } = await store.listReports({ ids, page, limit });
  // A branch reader sees only its own share of each report: one grouped read for the whole page, not two reads per report.
  let shares: Map<string, OwnShare> | undefined;
  if (!visibility.global && rows.length)
    shares = new Map((await store.ownShares(rows.map(r => r._id), visibility.locations)).map(g => [g.reportId, { totalCents: g.totalCents, employeeCount: g.driverCount, lineCount: g.lineCount }]));
  const items = rows.flatMap(row => { const own = shares?.get(row._id); return shares && !own ? [] : [rowItem(row, own)]; });
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
export async function linesFor(report: ReportRecord, visibility: Visibility, store: FuelStore, options: { externalId: string; unknownOnly: boolean; page: number; limit: number; search?: string; category?: string; priorOnly?: boolean }) {
  const own = await visibleFacts(report, visibility, store);
  // A branch reader's lines and their allocated amounts, summed once per line instead of re-scanning every fact per row.
  const ownCents = own ? new Map<number, number>() : null;
  own?.forEach(f => ownCents!.set(f.sourceLine, (ownCents!.get(f.sourceLine) ?? 0) + f.amountCents));
  const overrides = new Map(report.overrides.map(o => [o.index, o.category]));
  const rows = [];
  for (const l of report.parsed.lines) {
    if (ownCents && !ownCents.has(l.index)) continue;
    if (options.externalId && l.externalId !== options.externalId) continue;
    const category = overrides.get(l.index) || l.category;
    if (options.unknownOnly && category !== 'other') continue;
    if (options.category && category !== options.category) continue;
    if (options.priorOnly && l.date >= report.parsed.start) continue;
    if (!matchesSearch(l, options.search || '', !own)) continue;
    rows.push({ ...l, category });
  }
  const visible = rows.slice((options.page - 1) * options.limit, options.page * options.limit).map(line => ownCents ? { ...line,
    amountCents: ownCents.get(line.index) ?? 0,
    description: `${line.category} · allocated share`, quantity: '', netPrice: '', taxRate: '', exceptionCodes: [],
  } : line);
  return { items: visible, total: rows.length, page: options.page, limit: options.limit };
}
export async function monthlyFacts(month: string, visibility: Visibility, store: FuelStore) {
  return store.monthFacts(month, await store.publishedReportIds(month), visibility.global ? undefined : visibility.locations);
}
export async function pnlFor(month: string, visibility: Visibility, store: FuelStore) {
  const previousMonth = monthBefore(month);
  const facts = await monthlyFacts(month, visibility, store), previous = (await monthTotals(previousMonth, visibility, store)).totalCents;
  const total = facts.reduce((s, f) => s + f.amountCents, 0);
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
