/**
 * The live view's reads and a phone's health (location v2, 2026-11-22; tables in
 * src/db/schema/locationPoints.ts). `latestFor` replaces the old DISTINCT ON over the points:
 * a poll reads one small row per person. Rules for what the health says: src/utils/locationHealth.ts.
 */
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import { locationLatest as latest, locationDeviceHealth as health, locationViewLog as viewLog } from '../schema/locationPoints.ts';

export type LatestRow = { userId: string; branch: string; recordedAt: Date; lat: number; lng: number; accuracyM: number | null; updatedAt: Date };

const cols = { userId: latest.userId, branch: latest.branch, recordedAt: latest.recordedAt, lat: latest.lat, lng: latest.lng, accuracyM: latest.accuracyM, updatedAt: latest.updatedAt };

/** These people's newest point (all of them when `userIds` is null). */
export async function latestFor(userIds: string[] | null, db?: Db): Promise<LatestRow[]> {
  if (userIds && !userIds.length) return [];
  const d = db ?? await appDb();
  return d.select(cols).from(latest).where(userIds ? inArray(latest.userId, userIds) : undefined) as Promise<LatestRow[]>;
}

export type HealthInput = {
  permission: 'always' | 'when-in-use' | 'denied' | 'unknown'; lowPower: boolean; batteryPct: number | null; charging: boolean;
  appVersion: string; queued: number; reportedAt: Date;
};
export type HealthRow = HealthInput & { userId: string; receivedAt: Date };

/** The newest heartbeat wins; an older one (a delayed retry) changes nothing. */
export async function saveHealth(userId: string, h: HealthInput, db?: Db): Promise<void> {
  const d = db ?? await appDb();
  await d.insert(health).values({ userId, ...h })
    .onConflictDoUpdate({ target: health.userId, set: { ...h, receivedAt: new Date() }, setWhere: lt(health.reportedAt, h.reportedAt) });
}

export async function healthFor(userIds: string[], db?: Db): Promise<Map<string, HealthRow>> {
  if (!userIds.length) return new Map();
  const d = db ?? await appDb();
  const rows = await d.select().from(health).where(inArray(health.userId, userIds));
  return new Map((rows as HealthRow[]).map(r => [r.userId, r]));
}

export type ViewInput = { viewerId: string; viewerName: string; subjectId: string; subjectName: string; kind: 'live' | 'trail' | 'locate'; day?: string };

/**
 * Appends who looked at whom. A 'live' look is written once per viewer and person per `liveEveryMs`
 * (the map refreshes every 15 s; one line per look, not one per poll). A trail or Locate now is always a line.
 */
export async function logView(v: ViewInput, now: Date = new Date(), liveEveryMs = 30 * 60 * 1000, db?: Db): Promise<boolean> {
  const d = db ?? await appDb();
  if (v.kind === 'live') {
    const [recent] = await d.select({ id: viewLog.id }).from(viewLog)
      .where(and(eq(viewLog.viewerId, v.viewerId), eq(viewLog.subjectId, v.subjectId), eq(viewLog.kind, 'live'), gte(viewLog.viewedAt, new Date(now.getTime() - liveEveryMs))))
      .limit(1);
    if (recent) return false;
  }
  await d.insert(viewLog).values({ id: newId(), ...v, day: v.day ?? '', viewedAt: now });
  return true;
}

/** Several people looked at at once (the team list): one 'live' line each, skipping those logged recently. */
export async function logViews(list: ViewInput[], now: Date = new Date(), liveEveryMs = 30 * 60 * 1000, db?: Db): Promise<void> {
  if (!list.length) return;
  const d = db ?? await appDb();
  const viewer = list[0]!.viewerId;
  const recent = await d.select({ subjectId: viewLog.subjectId }).from(viewLog)
    .where(and(eq(viewLog.viewerId, viewer), eq(viewLog.kind, 'live'), gte(viewLog.viewedAt, new Date(now.getTime() - liveEveryMs)), inArray(viewLog.subjectId, list.map(v => v.subjectId))));
  const skip = new Set(recent.map((r: { subjectId: string }) => r.subjectId));
  const fresh = list.filter(v => !skip.has(v.subjectId));
  if (fresh.length) await d.insert(viewLog).values(fresh.map(v => ({ id: newId(), ...v, day: v.day ?? '', viewedAt: now })));
}

export type ViewQuery = { subjectId?: string; viewerId?: string; from?: Date; to?: Date; limit?: number };
export async function viewLogFor(q: ViewQuery, db?: Db) {
  const d = db ?? await appDb();
  const conds = [q.subjectId ? eq(viewLog.subjectId, q.subjectId) : undefined, q.viewerId ? eq(viewLog.viewerId, q.viewerId) : undefined,
    q.from ? gte(viewLog.viewedAt, q.from) : undefined, q.to ? lt(viewLog.viewedAt, q.to) : undefined].filter(Boolean) as ReturnType<typeof eq>[];
  return d.select().from(viewLog).where(conds.length ? and(...conds) : undefined).orderBy(desc(viewLog.viewedAt)).limit(Math.min(q.limit ?? 200, 1000));
}

/** The 1-year rule for the access log (points and asks follow the 90-day one). */
export async function deleteViewLogOlderThan(cutoff: Date, db?: Db): Promise<number> {
  const d = db ?? await appDb();
  const gone = await d.delete(viewLog).where(lt(viewLog.viewedAt, cutoff)).returning({ id: viewLog.id });
  return gone.length;
}
