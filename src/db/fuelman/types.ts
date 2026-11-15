/**
 * What Fuel Man's code asks of its database (src/fuelman/*). Both implementations (mongo.ts, postgres.ts)
 * answer in the same shape: ids are strings, `to` is '' while an assignment is open, `__v` counts a report's
 * changes. Reads and writes happen inside the store of one unit of work (see index.ts).
 */
import type { ClientSession } from 'mongoose';
import type { Allocation, CategoryOverride, CostFact, Disposition, ParsedReport, ReportReview } from '../../fuelman/types.ts';

export interface Actor { id: string; name: string }

export interface ReportRecord {
  _id: string; __v: number; scopeKey: string; fileHash: string; contentHash: string; periodKey: string;
  filename: string; parsed: ParsedReport; revision: number; status: 'draft' | 'posted' | 'superseded' | 'reversed';
  dispositions: Disposition[]; overrides: CategoryOverride[]; importedAt: Date; importedBy: Actor;
  frozenReview?: ReportReview; publishedAt?: Date; note?: string;
}
export type NewReport = Omit<ReportRecord, '_id' | '__v'>;
/** What a save may change on a report; `bump` adds 1 to `__v`, `version` makes the save refuse a stale one. */
export interface ReportChange {
  status?: ReportRecord['status']; frozenReview?: ReportReview; publishedAt?: Date; note?: string;
  dispositions?: Disposition[]; overrides?: CategoryOverride[]; bump?: boolean; version?: number;
}
/** What a list row needs from a report, so the list never loads the parsed lines. */
export interface ListRow {
  _id: string; __v: number; filename: string; status: ReportRecord['status']; revision: number; importedAt: Date; importedBy: { name: string };
  parsed: { company: string; month: string; start: string; end: string; totalCents: number }; employeeCount: number; lineCount: number;
}
export interface AssignmentRecord {
  _id: string; scopeKey: string; externalId: string; reportedName?: string; driverKey: string; driverName: string;
  from: string; to: string; allocations: Allocation[]; updatedBy: Actor; updatedAt: Date;
}
export type NewAssignment = Omit<AssignmentRecord, '_id'>;
export interface FactRecord extends CostFact { _id: string; reportId: string; month: string; scopeKey: string }
export interface PeriodRecord { _id: string; scopeKey: string; month: string; publishedReportId: string | null; closed: boolean; closedBy?: Actor; closedAt?: Date }
export interface PeriodChange { publishedReportId?: string | null; closed?: boolean; closedBy?: Actor; closedAt?: Date }
export interface AuditRecord { _id: string; reportId: string; scopeKey: string; action: string; at: Date; actor: Actor; note: string; detail: unknown }
export interface OwnShareRow { reportId: string; totalCents: number; driverCount: number; lineCount: number }

export interface FuelStore {
  /** MongoDB's session while inside a transaction (the code that reads users and branches joins it); null on Postgres. */
  session: ClientSession | null;

  // Reports
  getReport(id: string): Promise<ReportRecord | null>;
  reportScope(id: string): Promise<string | null>;
  reportExists(id: string): Promise<boolean>;
  reportTotals(id: string): Promise<{ totalCents: number; revision: number } | null>;
  findDuplicate(q: { fileHash: string; scopeKey: string; contentHash: string }): Promise<{ id: string; month: string } | null>;
  latestRevision(periodKey: string): Promise<number>;
  createReport(id: string, doc: NewReport, pdf: Buffer): Promise<ReportRecord>;
  /** False when `version` was given and the report is no longer at it. */
  updateReport(id: string, change: ReportChange): Promise<boolean>;
  listReports(q: { ids?: string[]; page: number; limit: number }): Promise<{ total: number; rows: ListRow[] }>;
  sourcePdf(reportId: string): Promise<Buffer | null>;
  revisionTotal(): Promise<number>;

  // Card → driver assignments
  assignmentsOfScope(scopeKey: string): Promise<AssignmentRecord[]>;
  assignmentsOf(scopeKey: string, externalIds: string[]): Promise<AssignmentRecord[]>;
  assignmentById(id: string, scopeKey: string, externalId: string): Promise<AssignmentRecord | null>;
  /** The latest assignment of a card that starts on or before `day`. */
  assignmentUpTo(scopeKey: string, externalId: string, day: string): Promise<AssignmentRecord | null>;
  /** The earliest assignment of a card that starts after `from`. */
  assignmentAfter(scopeKey: string, externalId: string, from: string): Promise<AssignmentRecord | null>;
  /** Assignments that start on or before `day` and are still open on it. */
  assignmentsOpenAt(scopeKey: string, externalId: string, day: string): Promise<AssignmentRecord[]>;
  setAssignmentEnd(ids: string[], to: string, actor: Actor): Promise<void>;
  /** Replace the assignment that starts on `a.from` (or add it). */
  saveAssignment(id: string, a: NewAssignment): Promise<void>;
  addAssignmentsIfAbsent(list: { id: string; a: NewAssignment }[]): Promise<void>;

  // Published costs
  factsOfReport(reportId: string, locations?: string[]): Promise<FactRecord[]>;
  addFacts(list: { id: string; fact: CostFact & { reportId: string; month: string; scopeKey: string } }[]): Promise<void>;
  reportsWithFacts(locations: string[]): Promise<string[]>;
  ownShares(reportIds: string[], locations: string[]): Promise<OwnShareRow[]>;
  locationCents(month: string, reportIds: string[], locations?: string[]): Promise<{ location: string; cents: number }[]>;
  monthFacts(month: string, reportIds: string[], locations?: string[]): Promise<FactRecord[]>;

  // Months
  period(id: string): Promise<PeriodRecord | null>;
  ensurePeriod(id: string, scopeKey: string, month: string): Promise<void>;
  updatePeriod(id: string, change: PeriodChange): Promise<void>;
  publishedReportIds(month: string): Promise<string[]>;
  publishedAmong(reportIds: string[]): Promise<string[]>;

  // History
  addAudit(entry: Omit<AuditRecord, '_id'> & { id: string }): Promise<void>;
  auditPage(reportId: string, page: number, limit: number): Promise<{ total: number; items: AuditRecord[] }>;
}
