/**
 * "Locate now" requests (Postgres only; src/db/schema/locationPoints.ts, rules in
 * src/utils/locationRequests.ts). The route has already checked who may ask and
 * about whom; this stores and reads. An answer is written once, only by the
 * person asked, only while the request is still open.
 */
import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import { locationRequests as requests } from '../schema/locationPoints.ts';
import { REQUEST_TTL_MS } from '../../utils/locationRequests.ts';

export type RequestRecord = {
  id: string; targetUserId: string; requestedBy: string; requestedByName: string; reason: string;
  requestedAt: Date; answeredAt: Date | null; lat: number | null; lng: number | null; accuracyM: number | null; consentVersion: number;
};

const cols = {
  id: requests.id, targetUserId: requests.targetUserId, requestedBy: requests.requestedBy, requestedByName: requests.requestedByName,
  reason: requests.reason, requestedAt: requests.requestedAt, answeredAt: requests.answeredAt,
  lat: requests.lat, lng: requests.lng, accuracyM: requests.accuracyM, consentVersion: requests.consentVersion
};

export async function createRequest(
  a: { targetUserId: string; requestedBy: string; requestedByName: string; reason: string; consentVersion: number; now?: Date }, db?: Db
): Promise<RequestRecord> {
  const d = db ?? await appDb();
  const [row] = await d.insert(requests).values({
    id: newId(), targetUserId: a.targetUserId, requestedBy: a.requestedBy, requestedByName: a.requestedByName,
    reason: a.reason, consentVersion: a.consentVersion, ...(a.now ? { requestedAt: a.now } : {})
  }).returning(cols);
  return row as RequestRecord;
}

export async function requestById(id: string, db?: Db): Promise<RequestRecord | null> {
  const d = db ?? await appDb();
  const [row] = await d.select(cols).from(requests).where(eq(requests.id, id));
  return (row as RequestRecord | undefined) ?? null;
}

/** Requests still open (unanswered, not expired) for one person, newest first. */
export async function openFor(targetUserId: string, now: Date, db?: Db): Promise<RequestRecord[]> {
  const d = db ?? await appDb();
  const since = new Date(now.getTime() - REQUEST_TTL_MS);
  return d.select(cols).from(requests)
    .where(and(eq(requests.targetUserId, targetUserId), isNull(requests.answeredAt), gte(requests.requestedAt, since)))
    .orderBy(desc(requests.requestedAt)) as Promise<RequestRecord[]>;
}

/** Writes the person's answer to a request that is theirs, unanswered and not expired. Returns the row, or null when it can't be answered. */
export async function answerRequest(
  id: string, targetUserId: string, at: { lat: number; lng: number; accuracyM: number | null }, now: Date, db?: Db
): Promise<RequestRecord | null> {
  const d = db ?? await appDb();
  const since = new Date(now.getTime() - REQUEST_TTL_MS);
  const [row] = await d.update(requests).set({ answeredAt: now, lat: at.lat, lng: at.lng, accuracyM: at.accuracyM })
    .where(and(eq(requests.id, id), eq(requests.targetUserId, targetUserId), isNull(requests.answeredAt), gte(requests.requestedAt, since)))
    .returning(cols);
  return (row as RequestRecord | undefined) ?? null;
}

/** One person's requests, newest first (the log the admin sees). */
export async function log(targetUserId: string, limit = 20, db?: Db): Promise<RequestRecord[]> {
  const d = db ?? await appDb();
  return d.select(cols).from(requests).where(eq(requests.targetUserId, targetUserId))
    .orderBy(desc(requests.requestedAt)).limit(limit) as Promise<RequestRecord[]>;
}

/** The 90-day rule, like the points'. */
export async function deleteRequestsOlderThan(cutoff: Date, db?: Db): Promise<number> {
  const d = db ?? await appDb();
  const gone = await d.delete(requests).where(lt(requests.requestedAt, cutoff)).returning({ id: requests.id });
  return gone.length;
}
