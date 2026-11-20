import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { answerRequest, createRequest, deleteRequestsOlderThan, log, openFor, requestById } from './requests.ts';

const A = 'a'.repeat(24), B = 'b'.repeat(24), ADMIN = 'c'.repeat(24);
const at = { lat: 47.6, lng: -122.3, accuracyM: 20 };

describe('location requests', () => {
  let client: PGlite; let db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('opens a request and finds it open for that person only', async () => {
    const now = new Date('2026-11-20T03:00:00Z');
    const r = await createRequest({ targetUserId: A, requestedBy: ADMIN, requestedByName: 'Krish', reason: 'Truck not back', consentVersion: 2, now }, db);
    expect(r.answeredAt).toBeNull();
    expect((await openFor(A, new Date(now.getTime() + 60_000), db)).map(x => x.id)).toEqual([r.id]);
    expect(await openFor(B, now, db)).toEqual([]);
  });

  it('stops being open after 15 minutes', async () => {
    const now = new Date('2026-11-20T04:00:00Z');
    await createRequest({ targetUserId: B, requestedBy: ADMIN, requestedByName: 'Krish', reason: 'Late for drop', consentVersion: 2, now }, db);
    expect(await openFor(B, new Date(now.getTime() + 14 * 60_000), db)).toHaveLength(1);
    expect(await openFor(B, new Date(now.getTime() + 16 * 60_000), db)).toHaveLength(0);
  });

  it('is answered once, only by the person asked, only while open', async () => {
    const now = new Date('2026-11-20T05:00:00Z');
    const r = await createRequest({ targetUserId: A, requestedBy: ADMIN, requestedByName: 'Krish', reason: 'Check on delivery', consentVersion: 2, now }, db);
    const later = new Date(now.getTime() + 60_000);
    expect(await answerRequest(r.id, B, at, later, db)).toBeNull();                          // someone else's phone
    expect(await answerRequest(r.id, A, at, new Date(now.getTime() + 20 * 60_000), db)).toBeNull(); // too late
    const done = await answerRequest(r.id, A, at, later, db);
    expect(done).toMatchObject({ lat: 47.6, lng: -122.3, accuracyM: 20 });
    expect(done!.answeredAt).toEqual(later);
    expect(await answerRequest(r.id, A, { ...at, lat: 1 }, later, db)).toBeNull();           // never overwritten
    expect((await requestById(r.id, db))!.lat).toBe(47.6);
    expect(await openFor(A, later, db)).toEqual([]);
  });

  it('keeps a log, newest first, and drops old ones', async () => {
    const rows = await log(A, 20, db);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]!.requestedAt.getTime()).toBeGreaterThanOrEqual(rows[1]!.requestedAt.getTime());
    expect(await deleteRequestsOlderThan(new Date('2026-11-20T04:30:00Z'), db)).toBe(2);
    expect(await log(A, 20, db)).toHaveLength(1);
  });
});
