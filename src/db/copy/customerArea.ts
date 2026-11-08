/**
 * Copy the customer area from MongoDB into Postgres (src/db/README.md).
 *
 * MongoDB stays the live database until cutover; this refreshes Postgres from
 * it, whole, in one transaction: the copied tables are emptied and refilled,
 * so running it again gives the same result. It refuses once the database is
 * locked (`mongo_copy_state.locked_at`, set at cutover), because from then on
 * Postgres holds the live data and a copy would overwrite it.
 */
import { sql, getTableName, getTableColumns, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTable } from 'drizzle-orm/pg-core';
import type { Loose } from '../../types/records.ts';
import * as schema from '../schema/index.ts';
import { referenceRows, type ReferenceSource } from './referenceRows.ts';
import { customerRows } from './customerRows.ts';
import { linkedRows, type LinkedSource } from './linkedRows.ts';
import type { CopyProblem } from './values.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface CustomerAreaSource extends ReferenceSource, LinkedSource {
  customers: Loose[];
}

/** Every table this copy fills, parents before children (the insert order). */
export function customerAreaPlan(src: CustomerAreaSource, problems: CopyProblem[]) {
  const ref = referenceRows(src, problems);
  const cust = customerRows(src.customers, ref.index, problems);
  const linked = linkedRows(src, ref.index, cust.index, problems);
  const r = ref.rows, c = cust.rows;
  const steps: [PgTable, Loose[]][] = [
    [schema.locations, r.locations],
    [schema.roles, r.roles],
    [schema.users, r.users],
    [schema.userLocations, r.userLocations],
    [schema.locationReportRecipients, r.locationReportRecipients],
    [schema.visitTypes, r.visitTypes],
    [schema.resourceFamilies, r.resourceFamilies],
    [schema.resourceTypes, r.resourceTypes],
    [schema.customers, c.customers],
    [schema.customerLogins, c.customerLogins],
    [schema.customerContacts, c.customerContacts],
    [schema.customerLinks, c.customerLinks],
    [schema.visits, c.visits],
    [schema.visitAttachments, c.visitAttachments],
    [schema.visitReactions, c.visitReactions],
    [schema.visitFollowUpEvents, c.visitFollowUpEvents],
    [schema.resources, c.resources],
    [schema.resourceAttachments, c.resourceAttachments],
    [schema.schedules, linked.schedules],
    [schema.activityLogs, linked.activityLogs],
    [schema.customerDeleteBackups, linked.customerDeleteBackups],
    [schema.customerMergeBackups, linked.customerMergeBackups]
  ];
  return steps;
}

export interface CopyReport {
  copiedAt: string;
  source: Record<string, number>;
  tables: Record<string, number>;
  /** Problems grouped: "table.field · reason · outcome" → count. */
  summary: Record<string, number>;
  problems: CopyProblem[];
}

export function summarize(problems: CopyProblem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of problems) {
    const key = `${p.table}.${p.field} · ${p.reason} · ${p.outcome}`;
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export class CopyLockedError extends Error {
  constructor(lockedAt: Date, lockedBy: string) {
    super(`This database was locked for copies on ${lockedAt.toISOString()} by ${lockedBy || 'someone'}: it holds live data now.`);
    this.name = 'CopyLockedError';
  }
}

const CHUNK = 500;

/** Map everything first (no writes), then replace the tables in one transaction. */
export async function copyCustomerArea(db: Db, src: CustomerAreaSource, options: { write: boolean }): Promise<CopyReport> {
  const problems: CopyProblem[] = [];
  const steps = customerAreaPlan(src, problems);
  const report: CopyReport = {
    copiedAt: new Date().toISOString(),
    source: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, (v as unknown[]).length])),
    tables: Object.fromEntries(steps.map(([t, rows]) => [getTableName(t), rows.length])),
    summary: summarize(problems),
    problems
  };
  if (!options.write) return report;

  await db.transaction(async tx => {
    const [state] = await tx.select().from(schema.mongoCopyState).where(eq(schema.mongoCopyState.id, 1)).for('update');
    if (state?.lockedAt) throw new CopyLockedError(state.lockedAt, state.lockedBy);
    // One TRUNCATE naming every table, no CASCADE: if a table from another area
    // ever points at these, this fails instead of quietly emptying it too.
    const names = steps.map(([t]) => sql.identifier(getTableName(t)));
    await tx.execute(sql`truncate table ${sql.join(names, sql`, `)}`);
    for (const [table, rows] of steps) {
      for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(table).values(rows.slice(i, i + CHUNK));
    }
    const brief = { ...report, problems: undefined, problemCount: problems.length };
    await tx.insert(schema.mongoCopyState).values({ id: 1, lastCopyAt: new Date(report.copiedAt), lastCopyReport: brief })
      .onConflictDoUpdate({ target: schema.mongoCopyState.id, set: { lastCopyAt: new Date(report.copiedAt), lastCopyReport: brief } });
  });
  return report;
}

/** Normalize a value read back from either side so equal data compares equal. */
function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  if (typeof v === 'string') {
    // Postgres prints a local time without trailing zero milliseconds, and numerics at their scale.
    const t = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(v);
    if (t) return `${t[1]}.${(t[2] || '').padEnd(3, '0')}`;
  }
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]));
  return v;
}

/**
 * Check Postgres holds exactly what MongoDB maps to: same rows per table and
 * every column equal. Returns the differences (empty = verified).
 */
export async function verifyCustomerArea(db: Db, src: CustomerAreaSource, limitPerTable = 20): Promise<string[]> {
  const diffs: string[] = [];
  for (const [table, expected] of customerAreaPlan(src, [])) {
    const name = getTableName(table);
    // numeric columns come back at their scale ('10.00'): compare those as numbers, nothing else.
    const numeric = new Set(Object.entries(getTableColumns(table)).filter(([, col]) => col.columnType === 'PgNumeric').map(([key]) => key));
    const value = (col: string, v: unknown) => numeric.has(col) && v != null ? Number(v) : norm(v);
    const actual = (await db.select().from(table)) as Loose[];
    if (actual.length !== expected.length) diffs.push(`${name}: ${actual.length} rows in Postgres, ${expected.length} expected`);
    const keyOf = (row: Loose) => JSON.stringify(row.id ?? [row.customerId, row.visitId, row.resourceId, row.userId, row.locationId, row.kind, row.otherCustomerId, row.position]);
    const byKey = new Map(actual.map(row => [keyOf(row), row]));
    let shown = 0;
    for (const want of expected) {
      const got = byKey.get(keyOf(want));
      const problem = !got ? 'missing' : Object.entries(want)
        .filter(([col, v]) => JSON.stringify(value(col, v)) !== JSON.stringify(value(col, got[col])))
        .map(([col]) => col).join(', ');
      if (problem && shown++ < limitPerTable) diffs.push(`${name} ${keyOf(want)}: ${problem === 'missing' ? 'missing' : `differs in ${problem}`}`);
    }
    if (shown > limitPerTable) diffs.push(`${name}: ${shown - limitPerTable} more differences`);
  }
  return diffs;
}

/** At cutover: stop copies for good on this database. */
export async function lockCopies(db: Db, by: string): Promise<void> {
  await db.insert(schema.mongoCopyState).values({ id: 1, lockedAt: new Date(), lockedBy: by })
    .onConflictDoUpdate({ target: schema.mongoCopyState.id, set: { lockedAt: new Date(), lockedBy: by } });
}
