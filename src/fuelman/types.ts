export const CATEGORIES = ['fuel', 'def', 'supplies', 'tax', 'adjustment', 'other'] as const;
export type Category = typeof CATEGORIES[number];
export type Amounts = Record<Category, number>;
export const emptyAmounts = (): Amounts => ({ fuel: 0, def: 0, supplies: 0, tax: 0, adjustment: 0, other: 0 });
export interface PdfPart { text: string; x: number; y: number; width: number; height: number }
export interface PdfRow { text: string; y: number; parts: PdfPart[] }
export interface PdfPage { number: number; width: number; height: number; rows: PdfRow[] }
export interface ExpenseLine {
  index: number; externalId: string; reportedName: string; date: string; time: string;
  site: string; vehicle: string; description: string; category: Category;
  fuelCode: string; quantity: string; netPrice: string; taxRate: string;
  amountCents: number; exceptionCodes: string[]; page: number; y: number;
}
export interface EmployeeSummary {
  externalId: string; name: string; totalCents: number; reportedTotalCents: number;
  lineCount: number; amounts: Amounts; pages: number[];
}
export interface ParsedReport {
  account: string; fleet: string; company: string; start: string; end: string;
  month: string; pageCount: number; parserVersion: string; totalCents: number;
  amounts: Amounts; employees: EmployeeSummary[]; lines: ExpenseLine[]; warnings: string[];
}
export interface Allocation { location: string; basisPoints: number }
export interface Assignment {
  id: string; externalId: string; reportedName?: string; driverKey: string; driverName: string;
  from: string; to: string; allocations: Allocation[];
  /** Not stored yet: a later month's match carried back while reviewing (see carryBack.ts); saved when the month is approved. */
  implied?: boolean;
}
export const REASONS = ['no_activity', 'leave', 'retired', 'transferred', 'identifier_changed', 'incomplete', 'investigating'] as const;
export type MissingReason = typeof REASONS[number];
export interface Disposition { externalId: string; reason: MissingReason; note: string; replacementId?: string; endedAssignments?: { id: string; previousTo: string; endedAt: string }[] }
export interface CategoryOverride { index: number; category: Category; note: string }
export interface ReviewDriver extends EmployeeSummary {
  driverKey: string; driverName: string; locations: string[]; issues: string[];
  newIdentity: boolean; assignments: Assignment[];
  // Set when this identity has no assignment covering this report but one that starts later (e.g. matched in September, now
  // reviewing August) with a single 100% location: the match to offer, never applied without a person confirming it.
  carriedFrom?: { driverKey: string; driverName: string; location: string; since: string }; suggestedFrom: string; suggestions: { driverKey: string; driverName: string; externalId: string }[];
}
export interface CostFact {
  externalId: string; driverKey: string; driverName: string; location: string;
  category: Category; amountCents: number; sourceLine: number; date: string;
}
export interface MissingIdentity { externalId: string; driverName: string; reason: MissingReason | ''; note: string; resolved: boolean }
export interface LocationTotal { location: string; amounts: Amounts; totalCents: number; driverCount: number; lineCount: number }
export interface UnassignedExpenses { amounts: Amounts; totalCents: number; driverCount: number; lineCount: number }
export interface ReportReview {
  token: string; ready: boolean; issues: string[]; drivers: ReviewDriver[];
  missing: MissingIdentity[]; locations: LocationTotal[]; unassigned: UnassignedExpenses; facts: CostFact[];
  totalCents: number; amounts: Amounts; unresolvedCount: number; allocatedCents: number; unallocatedCents: number;
}
export interface ReportListItem {
  id: string; version: number; company: string; month: string; start: string; end: string;
  totalCents: number; employeeCount: number; lineCount: number; filename: string;
  status: 'draft' | 'posted' | 'superseded' | 'reversed'; revision: number; importedAt: string; importedBy: string;
}
// What last month's approved report looked like, for the "compared with" lines. Null when
// there is nothing approved for the month before (or for a branch reader).
export interface Comparison { previousMonth: string; previousTotalCents: number; locations: { location: string; previousCents: number }[]; carriedOverCount: number }
export interface ReportDetail extends ReportListItem {
  compare: Comparison | null;
  account: string; fleet: string; pageCount: number; review: Omit<ReportReview, 'facts'>;
  warnings: string[]; canViewSource: boolean; priorDateLineCount: number; periodClosed: boolean; currentPublishedReportId: string | null; currentPublishedTotalCents: number | null; currentPublishedRevision: number | null; publishedAt?: string; note?: string;
}
export interface DriverOption { key: string; name: string; active: boolean; locations: string[]; homeLocation?: string; kind: 'user' | 'profile' }
export interface FuelMetadata { locations: string[]; drivers: DriverOption[]; global: boolean; permissions: string[] }
