/**
 * Location points (Postgres only; see src/db/schema/locationPoints.ts and
 * src/utils/locationTracking.ts for the rules). The route has already cleaned
 * the batch; this only stores and reads.
 */
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import { locationPoints as points, locationConsents as consents, locationLatest as latest } from '../schema/locationPoints.ts';
import type { CleanPoint } from '../../utils/locationTracking.ts';

/**
 * Saves a cleaned batch; a point already saved (same person, same phone id) is skipped. Returns how many were new.
 * The person's row in `location_latest` moves in the same transaction, and only forward in time, so a backlog
 * arriving late never puts someone back where they were an hour ago.
 */
export async function savePoints(userId: string, branch: string, batch: CleanPoint[], db?: Db): Promise<number> {
  if (!batch.length) return 0;
  const d = db ?? await appDb();
  return d.transaction(async tx => {
    const saved = await tx.insert(points).values(batch.map(p => ({
      id: newId(), userId, branch, clientId: p.clientId, recordedAt: p.recordedAt,
      lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, speedMps: p.speedMps
    }))).onConflictDoNothing({ target: [points.userId, points.clientId] }).returning({ id: points.id });
    const newest = batch.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
    await tx.insert(latest).values({ userId, branch, recordedAt: newest.recordedAt, lat: newest.lat, lng: newest.lng, accuracyM: newest.accuracyM })
      .onConflictDoUpdate({
        target: latest.userId,
        set: { branch, recordedAt: newest.recordedAt, lat: newest.lat, lng: newest.lng, accuracyM: newest.accuracyM, updatedAt: sql`now()` },
        setWhere: sql`${latest.recordedAt} < excluded.recorded_at`
      });
    return saved.length;
  });
}

export type LastSeen = { userId: string; recordedAt: Date; lat: number; lng: number; accuracyM: number | null; branch: string };

/** Each person's newest point at or after `since` (today's, so yesterday's last spot isn't shown as where they are). `userIds` null = everyone. */
export async function lastSeen(userIds: string[] | null, since: Date, db?: Db): Promise<LastSeen[]> {
  if (userIds && !userIds.length) return [];
  const d = db ?? await appDb();
  const where = userIds ? and(gte(points.recordedAt, since), inArray(points.userId, userIds)) : gte(points.recordedAt, since);
  const rows = await d.selectDistinctOn([points.userId], {
    userId: points.userId, recordedAt: points.recordedAt, lat: points.lat, lng: points.lng, accuracyM: points.accuracyM, branch: points.branch
  }).from(points).where(where).orderBy(points.userId, desc(points.recordedAt));
  return rows as LastSeen[];
}

/** One person's trail between two instants, oldest first. */
export async function trail(userId: string, from: Date, to: Date, db?: Db) {
  const d = db ?? await appDb();
  return d.select({ id: points.id, recordedAt: points.recordedAt, lat: points.lat, lng: points.lng, accuracyM: points.accuracyM, speedMps: points.speedMps })
    .from(points).where(and(eq(points.userId, userId), gte(points.recordedAt, from), lt(points.recordedAt, to)))
    .orderBy(asc(points.recordedAt)).limit(5000);
}

/** Deletes points older than the cutoff (the 90-day rule); returns how many went. */
export async function deleteOlderThan(cutoff: Date, db?: Db): Promise<number> {
  const d = db ?? await appDb();
  const gone = await d.delete(points).where(lt(points.recordedAt, cutoff)).returning({ id: points.id });
  return gone.length;
}

/** Removes everything held for one person (e.g. when tracking is switched off for them at their request). */
export async function deleteForUser(userId: string, db?: Db): Promise<number> {
  const d = db ?? await appDb();
  const gone = await d.delete(points).where(eq(points.userId, userId)).returning({ id: points.id });
  return gone.length;
}

/** Records that a person agreed to a wording version; a second tap changes nothing. Returns when they first agreed. */
export async function recordConsent(userId: string, version: number, device: string, db?: Db): Promise<Date> {
  const d = db ?? await appDb();
  await d.insert(consents).values({ id: newId(), userId, version, device: device.slice(0, 200) })
    .onConflictDoNothing({ target: [consents.userId, consents.version] });
  const [row] = await d.select({ at: consents.consentedAt }).from(consents).where(and(eq(consents.userId, userId), eq(consents.version, version)));
  return row!.at;
}

/** When each of these people agreed to this version (people who haven't are missing). */
export async function consentsFor(userIds: string[], version: number, db?: Db): Promise<Map<string, Date>> {
  if (!userIds.length) return new Map();
  const d = db ?? await appDb();
  const rows = await d.select({ userId: consents.userId, at: consents.consentedAt }).from(consents)
    .where(and(inArray(consents.userId, userIds), eq(consents.version, version)));
  return new Map(rows.map(r => [r.userId, r.at]));
}
