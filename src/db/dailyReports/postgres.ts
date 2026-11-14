/**
 * Daily Reports on Postgres, answering in MongoDB's shape (reportDoc.ts). A save builds the
 * report through the same Mongoose model MongoDB uses (defaults, casting), then makes its rows
 * with the copy's own builder (dailyReportRowsOf), so it writes what a re-copy of MongoDB would.
 *
 * The two writes that must never lose a race are single conditional statements, as on MongoDB:
 *  - claim (Submit and the 11:59 PM job): `UPDATE … WHERE id = ? AND status = 'draft'` — a second
 *    claim waits for the first one's row lock, then finds the day no longer a draft and matches nothing;
 *  - writeDraft (autosave): `INSERT … ON CONFLICT DO NOTHING`, else a row lock and a status check
 *    — a day submitted in between is never turned back into a draft.
 * The log is only ever appended to, under the report's row lock so two appends can't share a position.
 */
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { dailyReports, dailyReportTransfers, dailyReportContainers, dailyReportLog } from '../schema/operations.ts';
import { locations } from '../schema/reference.ts';
import { dailyReportRowsOf } from '../copy/operationsRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import DailyReport from '../../models/DailyReport.ts';
import { reportDoc, type ReportRow } from './reportDoc.ts';
import type { LogEntry } from '../../utils/dailyReportLog.ts';
import type { Loose } from '../../types/records.ts';
import type { LeanReport } from './index.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Document = InstanceType<typeof DailyReport>;
type Found = { r: ReportRow; locationName: string | null };

const selectReports = (db: Db | Tx) => (db as Db).select({ r: dailyReports, locationName: locations.name })
  .from(dailyReports).leftJoin(locations, eq(locations.id, dailyReports.locationId));

async function withLines(db: Db | Tx, rows: Found[]): Promise<Loose[]> {
  if (!rows.length) return [];
  const ids = rows.map(x => x.r.id);
  const [transfers, containers, log] = await Promise.all([
    (db as Db).select().from(dailyReportTransfers).where(inArray(dailyReportTransfers.reportId, ids)),
    (db as Db).select().from(dailyReportContainers).where(inArray(dailyReportContainers.reportId, ids)),
    (db as Db).select().from(dailyReportLog).where(inArray(dailyReportLog.reportId, ids))
  ]);
  return rows.map(x => reportDoc(x.r, x.locationName,
    transfers.filter(t => t.reportId === x.r.id), containers.filter(c => c.reportId === x.r.id), log.filter(l => l.reportId === x.r.id)));
}

const hydrate = (doc: Loose | undefined): Document | null => (doc ? DailyReport.hydrate(doc) as Document : null);
const names = (list: readonly string[]) => [...list];

const byBranchDay = (location: string, date: string) => and(eq(locations.name, location), eq(dailyReports.day, date));

async function readOne(db: Db | Tx, where: ReturnType<typeof and>): Promise<LeanReport | null> {
  return ((await withLines(db, await selectReports(db).where(where)))[0] as LeanReport | undefined) ?? null;
}

export async function find(db: Db, date: string, location: string): Promise<Document | null> {
  return hydrate(await readOne(db, byBranchDay(location, date)) ?? undefined);
}

/** `fields` is MongoDB's projection; Postgres always answers every field. */
export async function findLean(db: Db, date: string, location: string): Promise<LeanReport | null> {
  return readOne(db, byBranchDay(location, date));
}

export async function onDay(db: Db, date: string, list: readonly string[]): Promise<Document[]> {
  if (!list.length) return [];
  const rows = await selectReports(db).where(and(eq(dailyReports.day, date), inArray(locations.name, names(list))));
  return (await withLines(db, rows)).map(d => hydrate(d)!);
}

export async function inMonth(db: Db, list: readonly string[], month: string, order: 'newest' | 'branch'): Promise<LeanReport[]> {
  if (!list.length) return [];
  const rows = await selectReports(db)
    .where(and(inArray(locations.name, names(list)), sql`${dailyReports.day}::text like ${`${month}-%`}`))
    .orderBy(...(order === 'newest' ? [desc(dailyReports.day), asc(locations.name)] : [asc(locations.name), asc(dailyReports.day)]));
  return await withLines(db, rows) as LeanReport[];
}

export async function statuses(db: Db, location: string, dates: string[]) {
  if (!dates.length) return [];
  const rows = await db.select({ date: dailyReports.day, status: dailyReports.status }).from(dailyReports)
    .innerJoin(locations, eq(locations.id, dailyReports.locationId))
    .where(and(eq(locations.name, location), inArray(dailyReports.day, dates)));
  return rows;
}

export async function recentContainers(db: Db, list: readonly string[], limit: number): Promise<Loose[]> {
  if (!list.length) return [];
  const rows = await selectReports(db).where(inArray(locations.name, names(list)))
    .orderBy(desc(dailyReports.day), asc(locations.name)).limit(limit);
  const lines = rows.length ? await db.select().from(dailyReportContainers)
    .where(inArray(dailyReportContainers.reportId, rows.map(x => x.r.id))).orderBy(asc(dailyReportContainers.position)) : [];
  return rows.map(x => ({
    containers: lines.filter(c => c.reportId === x.r.id).map(c => ({ poNumber: c.poNumber, slabs: c.slabs }))
  }));
}

export async function submittedOn(db: Db, pairs: { location: string; date: string }[]): Promise<Loose[]> {
  if (!pairs.length) return [];
  const rows = await selectReports(db).where(and(eq(dailyReports.status, 'submitted'),
    or(...pairs.map(p => byBranchDay(p.location, p.date)))));
  return rows.map(x => ({
    date: x.r.day, location: x.locationName ?? '', submittedAt: x.r.submittedAt, submittedBy: x.r.submittedBy, autoSubmitted: x.r.autoSubmitted
  }));
}

export async function dayStatus(db: Db, location: string, date: string): Promise<Loose | null> {
  const [x] = await selectReports(db).where(byBranchDay(location, date));
  return x ? { status: x.r.status, submittedBy: x.r.submittedBy, submittedAt: x.r.submittedAt, autoSubmitted: x.r.autoSubmitted } : null;
}

export async function isSubmitted(db: Db, location: string, date: string): Promise<boolean> {
  const [x] = await db.select({ id: dailyReports.id }).from(dailyReports)
    .innerJoin(locations, eq(locations.id, dailyReports.locationId))
    .where(and(byBranchDay(location, date), eq(dailyReports.status, 'submitted')));
  return Boolean(x);
}

// ── writes ──────────────────────────────────────────────────────────────────────────────

async function rowsOf(tx: Tx, plain: Loose) {
  const built = dailyReportRowsOf(plain, await referenceIndexOf(tx as unknown as Db), []);
  if (!built) throw new Error('That Daily Report can’t be stored: it has no id, branch or day.');
  return built;
}

/** The report's transfer and container lines, replaced by these. */
async function replaceLines(tx: Tx, id: string, built: Awaited<ReturnType<typeof rowsOf>>) {
  await tx.delete(dailyReportTransfers).where(eq(dailyReportTransfers.reportId, id));
  await tx.delete(dailyReportContainers).where(eq(dailyReportContainers.reportId, id));
  if (built.transfers.length) await tx.insert(dailyReportTransfers).values(built.transfers);
  if (built.containers.length) await tx.insert(dailyReportContainers).values(built.containers);
}

/** Add log lines at the end. The report's row must already be locked by this transaction. */
async function appendLog(tx: Tx, id: string, entries: LogEntry[]) {
  if (!entries.length) return;
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(dailyReportLog).where(eq(dailyReportLog.reportId, id));
  await tx.insert(dailyReportLog).values(entries.map((e, i) => ({
    reportId: id, position: n + i, at: new Date(e.at), by: e.by ?? '', action: e.action, note: e.note ?? '',
    earlier: typeof (e as Loose).earlier === 'boolean' ? (e as Loose).earlier : null
  })));
}

const lock = (tx: Tx, where: ReturnType<typeof and>) => tx.select({ id: dailyReports.id, locationId: dailyReports.locationId, day: dailyReports.day })
  .from(dailyReports).innerJoin(locations, eq(locations.id, dailyReports.locationId)).where(where).for('update', { of: dailyReports });

const touch = (tx: Tx, id: string) => tx.update(dailyReports).set({ updatedAt: new Date() }).where(eq(dailyReports.id, id));

export async function claim(db: Db, report: Loose, log: LogEntry[]): Promise<Document | null> {
  const id = String(report._id).toLowerCase();
  return db.transaction(async tx => {
    const built = await rowsOf(tx, report.toObject());
    const { id: _id, createdAt: _created, ...columns } = built.report;
    const won = await tx.update(dailyReports).set({ ...columns, updatedAt: new Date() })
      .where(and(eq(dailyReports.id, id), eq(dailyReports.status, 'draft'))).returning({ id: dailyReports.id });
    if (!won.length) return null;
    await replaceLines(tx, id, built);
    await appendLog(tx, id, log);
    return hydrate(await readOne(tx, eq(dailyReports.id, id)) ?? undefined);
  });
}

export async function writeDraft(db: Db, date: string, location: string, update: Loose): Promise<Document | null> {
  return db.transaction(async tx => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [existing] = await lock(tx, byBranchDay(location, date));
      if (existing) {
        const found = await readOne(tx, eq(dailyReports.id, existing.id));
        if (!found || found.status === 'submitted') return null;
        const doc = DailyReport.hydrate(found) as Document;
        doc.set(update);
        const built = await rowsOf(tx, doc.toObject());
        const { id: _id, createdAt: _created, ...columns } = built.report;
        await tx.update(dailyReports).set({ ...columns, updatedAt: new Date() }).where(eq(dailyReports.id, existing.id));
        await replaceLines(tx, existing.id, built);
        return hydrate(await readOne(tx, eq(dailyReports.id, existing.id)) ?? undefined);
      }
      const doc = new DailyReport({ date, location, ...update });
      const now = new Date();
      doc.set({ createdAt: now, updatedAt: now });
      const built = await rowsOf(tx, doc.toObject());
      const made = await tx.insert(dailyReports).values(built.report).onConflictDoNothing().returning({ id: dailyReports.id });
      if (made.length) {
        await replaceLines(tx, built.report.id, built);
        return hydrate(await readOne(tx, eq(dailyReports.id, built.report.id)) ?? undefined);
      }
      // Someone created this day since we looked: go round again and treat it as the existing one.
    }
    throw new Error('Could not save this Daily Report: the day kept changing under the save.');
  });
}

/** A change to a report already loaded (Reopen). The log only grows: what the document adds is appended. */
export async function save(db: Db, doc: Document): Promise<void> {
  if (!doc.isModified()) return;
  const id = String(doc._id).toLowerCase();
  await doc.validate();
  // Like Mongoose, the document the caller holds carries the new updatedAt afterwards.
  doc.set('updatedAt', new Date());
  await db.transaction(async tx => {
    await lock(tx, eq(dailyReports.id, id));
    const built = await rowsOf(tx, doc.toObject());
    const { id: _id, createdAt: _created, ...columns } = built.report;
    await tx.update(dailyReports).set(columns).where(eq(dailyReports.id, id));
    if (doc.isModified('transfers') || doc.isModified('containers')) await replaceLines(tx, id, built);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(dailyReportLog).where(eq(dailyReportLog.reportId, id));
    await appendLog(tx, id, (doc.toObject().log as LogEntry[]).slice(n));
  });
}

/** A report that doesn't exist yet, stored: null when someone created the day meanwhile. */
export async function insert(db: Db, doc: Document): Promise<Document | null> {
  await doc.validate();
  const now = new Date();
  doc.set({ createdAt: now, updatedAt: now });
  return db.transaction(async tx => {
    const built = await rowsOf(tx, doc.toObject());
    const made = await tx.insert(dailyReports).values(built.report).onConflictDoNothing().returning({ id: dailyReports.id });
    if (!made.length) return null;
    await replaceLines(tx, built.report.id, built);
    if (built.log.length) await tx.insert(dailyReportLog).values(built.log);
    return hydrate(await readOne(tx, eq(dailyReports.id, built.report.id)) ?? undefined);
  });
}

export async function pushLog(db: Db, date: string, location: string, entry: LogEntry): Promise<void> {
  await db.transaction(async tx => {
    const [report] = await lock(tx, byBranchDay(location, date));
    if (!report) return; // a day never saved has no record to log on
    await appendLog(tx, report.id, [entry]);
    await touch(tx, report.id);
  });
}

export async function addTransferIfSubmitted(db: Db, date: string, location: string, ticketId: string, line: Loose, entry: LogEntry): Promise<boolean> {
  return db.transaction(async tx => {
    const [report] = await lock(tx, and(byBranchDay(location, date), eq(dailyReports.status, 'submitted')));
    if (!report) return false;
    const [already] = await tx.select({ p: dailyReportTransfers.position }).from(dailyReportTransfers)
      .where(and(eq(dailyReportTransfers.reportId, report.id), sql`${ticketId} = any(${dailyReportTransfers.ticketIds})`));
    if (already) return false;
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(dailyReportTransfers).where(eq(dailyReportTransfers.reportId, report.id));
    const stored = new DailyReport({ transfers: [line] }).toObject().transfers[0];
    const built = await rowsOf(tx, { _id: report.id, date, location, transfers: [stored] });
    await tx.insert(dailyReportTransfers).values({ ...built.transfers[0], position: n });
    await appendLog(tx, report.id, [entry]);
    await touch(tx, report.id);
    return true;
  });
}

export async function draftCandidates(db: Db, location: string, dates: string[], today: string): Promise<Document[]> {
  const rows = await selectReports(db).where(and(eq(locations.name, location), eq(dailyReports.status, 'draft'),
    or(inArray(dailyReports.day, dates),
      and(sql`${dailyReports.reopenedAt} is not null`, sql`${dailyReports.day} < ${today}`))));
  return (await withLines(db, rows)).map(d => hydrate(d)!);
}

export async function existingDates(db: Db, location: string, dates: string[]): Promise<string[]> {
  return (await statuses(db, location, dates)).map(r => r.date);
}
