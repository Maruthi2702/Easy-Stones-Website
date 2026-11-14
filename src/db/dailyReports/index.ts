/**
 * The Daily Report's data layer: the routes, the 11:59 PM job, the submit email and the Payments
 * page's submitted-day lock read and write reports through these, and each picks MongoDB or
 * Postgres by the area's switch (`DB_DAILY_REPORTS`, src/db/appDb.ts). Both answer the same
 * (dailyReports.parity.test.ts).
 *
 * Document-returning calls give a Mongoose document to change and hand back to `saveReport`,
 * `claimSubmission` or `insertReport`; `…Lean` / list calls give plain objects.
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type DailyReport from '../../models/DailyReport.ts';
import type { LogEntry } from '../../utils/dailyReportLog.ts';
import type { Loose } from '../../types/records.ts';

/** A report as a plain object (a list answer, or a read that isn't going to be changed). */
export type LeanReport = Loose & { date: string; location: string };

type Document = InstanceType<typeof DailyReport>;
const onPostgres = () => areaOn('daily_reports') === 'postgres';

/** One branch's day as a document, or null when nothing is saved. */
export async function findReport(date: string, location: string): Promise<Document | null> {
  return onPostgres() ? pg.find(await appDb(), date, location) : mongo.find(date, location);
}

/** Same, as a plain object. `fields` is MongoDB's projection; Postgres always answers every field. */
export async function findReportLean(date: string, location: string, fields?: string): Promise<LeanReport | null> {
  return onPostgres() ? pg.findLean(await appDb(), date, location) : mongo.findLean(date, location, fields);
}

/** Every saved report of the branches on one day. */
export async function reportsOnDay(date: string, locations: readonly string[]): Promise<Document[]> {
  return onPostgres() ? pg.onDay(await appDb(), date, locations) : mongo.onDay(date, locations);
}

/** A month ('YYYY-MM') of the branches' reports: newest day first, or by branch then day. */
export async function reportsInMonth(locations: readonly string[], month: string, order: 'newest' | 'branch'): Promise<LeanReport[]> {
  return onPostgres() ? pg.inMonth(await appDb(), locations, month, order) : mongo.inMonth(locations, month, order);
}

/** Status of a branch's reports on these days. */
export async function reportStatuses(location: string, dates: string[]): Promise<{ date: string; status: string }[]> {
  return onPostgres() ? pg.statuses(await appDb(), location, dates) : mongo.statuses(location, dates);
}

/** The container lines of the branches' newest `limit` reports. */
export async function recentContainerLines(locations: readonly string[], limit: number): Promise<Loose[]> {
  return onPostgres() ? pg.recentContainers(await appDb(), locations, limit) : mongo.recentContainers(locations, limit);
}

export async function submittedReportsOn(pairs: { location: string; date: string }[]): Promise<Loose[]> {
  return onPostgres() ? pg.submittedOn(await appDb(), pairs) : mongo.submittedOn(pairs);
}

/** status, submittedBy, submittedAt, autoSubmitted of one day, or null when nothing is saved. */
export async function reportDayStatus(location: string, date: string): Promise<Loose | null> {
  return onPostgres() ? pg.dayStatus(await appDb(), location, date) : mongo.dayStatus(location, date);
}

/** Is this branch day submitted (the Payments page locks on it)? */
export async function isDaySubmitted(location: string, date: string): Promise<boolean> {
  return onPostgres() ? pg.isSubmitted(await appDb(), location, date) : mongo.isSubmitted(location, date);
}

/**
 * Sign a day off — only if it is still a draft at the moment of the write; resolves the stored
 * document if this call won, null if the day had been submitted already.
 */
export async function claimSubmission(report: Loose, log: LogEntry[]): Promise<Document | null> {
  return onPostgres() ? pg.claim(await appDb(), report, log) : mongo.claim(report, log);
}

/** A draft save: writes the day only if it isn't submitted (null then). */
export async function writeDraft(date: string, location: string, update: Loose): Promise<Document | null> {
  return onPostgres() ? pg.writeDraft(await appDb(), date, location, update) : mongo.writeDraft(date, location, update);
}

/** A loaded report that was changed (Reopen). */
export async function saveReport(report: Document): Promise<void> {
  return onPostgres() ? pg.save(await appDb(), report) : mongo.save(report);
}

/** A new report (the 11:59 PM job filing an unopened day); null when someone created the day meanwhile. */
export async function insertReport(report: Document): Promise<Document | null> {
  return onPostgres() ? pg.insert(await appDb(), report) : mongo.insert(report);
}

/** Add one line to a day's log (nothing happens when no report is saved for it). */
export async function pushReportLog(date: string, location: string, entry: LogEntry): Promise<void> {
  if (onPostgres()) await pg.pushLog(await appDb(), date, location, entry); else await mongo.pushLog(date, location, entry);
}

/** Put a transfer line on a SUBMITTED report that doesn't list the ticket yet; true if it did. */
export async function addTransferIfSubmitted(date: string, location: string, ticketId: string, line: Loose, entry: LogEntry): Promise<boolean> {
  return onPostgres()
    ? pg.addTransferIfSubmitted(await appDb(), date, location, ticketId, line, entry)
    : mongo.addTransferIfSubmitted(date, location, ticketId, line, entry);
}

/** The branch's drafts the 11:59 PM job should look at (the listed days, or an earlier reopened one). */
export async function draftReportCandidates(location: string, dates: string[], today: string): Promise<Document[]> {
  return onPostgres() ? pg.draftCandidates(await appDb(), location, dates, today) : mongo.draftCandidates(location, dates, today);
}

export async function existingReportDates(location: string, dates: string[]): Promise<string[]> {
  return onPostgres() ? pg.existingDates(await appDb(), location, dates) : mongo.existingDates(location, dates);
}
