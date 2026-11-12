/**
 * Keep Postgres's copy of users, roles, locations and the visit / resource type lists
 * equal to MongoDB's (src/db/reference/README.md).
 *
 * Customers in Postgres point at these by id, but they stay on MongoDB until their own
 * area moves, so every change made there must reach Postgres. The whole-database copy
 * can't do it (it empties tables, and customers hang off these); this brings the eight
 * reference tables up to date in place, in one transaction: rows added or changed are
 * upserted, rows gone from MongoDB are deleted. A row something else still points at
 * (a delivery's driver, a calendar entry's rep) can't be deleted; it is kept and
 * reported, the way the copy keeps a dangling link rather than losing the record.
 */
import { sql, getTableName, getTableColumns, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as S from '../schema/index.ts';
import { referenceRows, type ReferenceSource } from '../copy/referenceRows.ts';
import type { Db } from '../copy/plan.ts';
import type { Loose } from '../../types/records.ts';
import type { CopyProblem } from '../copy/values.ts';

export interface ReferenceSyncReport {
  /** Rows written (added or changed-or-same) per table. */
  upserted: Record<string, number>;
  /** Rows removed per table. */
  deleted: Record<string, number>;
  /** Rows gone from MongoDB that Postgres still needs: "table id". */
  kept: string[];
  problems: CopyProblem[];
}

const CHUNK = 500;

/** Parents before children: the insert order; deletes run the other way. */
const TABLES: { table: PgTable; key: keyof ReturnType<typeof referenceRows>['rows'] }[] = [
  { table: S.locations, key: 'locations' },
  { table: S.roles, key: 'roles' },
  { table: S.users, key: 'users' },
  { table: S.visitTypes, key: 'visitTypes' },
  { table: S.resourceFamilies, key: 'resourceFamilies' },
  { table: S.resourceTypes, key: 'resourceTypes' }
];

/** Bring the reference tables in line with `src` (the six MongoDB collections, read whole). */
export async function syncReference(db: Db, src: ReferenceSource): Promise<ReferenceSyncReport> {
  const problems: CopyProblem[] = [];
  const { rows } = referenceRows(src, problems);
  const report: ReferenceSyncReport = { upserted: {}, deleted: {}, kept: [], problems };

  await db.transaction(async tx => {
    // One sync at a time (a second server, or a retry, waits its turn).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('reference_sync'))`);

    // Rows MongoDB no longer has, children first. Each in its own savepoint: a row still
    // referenced fails the delete without ending the sync. Done before the upserts, so a
    // person removed and added again with the same username doesn't collide with their old
    // row, and again after, so a role whose people have just moved off it can go.
    const removeGone = async () => {
      report.kept = [];
      for (const { table, key } of [...TABLES].reverse()) {
        const want = new Set((rows[key] as Loose[]).map(r => r.id as string));
        const have = (await tx.select({ id: (table as unknown as { id: never }).id }).from(table)) as { id: string }[];
        const gone = have.map(r => r.id).filter(id => !want.has(id));
        let removed = 0;
        for (const id of gone) {
          try {
            await tx.transaction(async inner => { await inner.delete(table).where(inArray((table as unknown as { id: never }).id, [id])); });
            removed++;
          } catch {
            report.kept.push(`${getTableName(table)} ${id}`);
          }
        }
        report.deleted[getTableName(table)] = (report.deleted[getTableName(table)] ?? 0) + removed;
      }
    };
    await removeGone();

    for (const { table, key } of TABLES) {
      const list = rows[key] as Loose[];
      const columns = getTableColumns(table) as Record<string, { name: string }>;
      const set = Object.fromEntries(Object.entries(columns).filter(([k]) => k !== 'id').map(([k, c]) => [k, sql.raw(`excluded."${c.name}"`)]));
      for (let i = 0; i < list.length; i += CHUNK) {
        await tx.insert(table).values(list.slice(i, i + CHUNK)).onConflictDoUpdate({ target: (table as unknown as { id: never }).id, set });
      }
      report.upserted[getTableName(table)] = list.length;
    }

    // Who works where, and who gets each branch's report: replaced whole (nothing points at them).
    await tx.delete(S.userLocations);
    await tx.delete(S.locationReportRecipients);
    for (let i = 0; i < rows.userLocations.length; i += CHUNK) await tx.insert(S.userLocations).values(rows.userLocations.slice(i, i + CHUNK));
    for (let i = 0; i < rows.locationReportRecipients.length; i += CHUNK) await tx.insert(S.locationReportRecipients).values(rows.locationReportRecipients.slice(i, i + CHUNK));

    await removeGone();
  });
  return report;
}
