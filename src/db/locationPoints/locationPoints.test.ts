import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { savePoints, lastSeen, trail, deleteOlderThan, deleteForUser, recordConsent, consentsFor } from './index.ts';

const A = 'a'.repeat(24), B = 'b'.repeat(24);
const pt = (clientId: string, iso: string, lat = 47.6, lng = -122.3) => ({ clientId, recordedAt: new Date(iso), lat, lng, accuracyM: 10, speedMps: null });

describe('location points', () => {
  let client: PGlite; let db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('saves a batch once: the same phone ids again add nothing', async () => {
    const batch = [pt('1', '2026-11-18T16:00:00Z'), pt('2', '2026-11-18T16:05:00Z', 47.61)];
    expect(await savePoints(A, 'Seattle', batch, db)).toBe(2);
    expect(await savePoints(A, 'Seattle', batch, db)).toBe(0);
    expect(await savePoints(A, 'Seattle', [pt('2', '2026-11-18T16:05:00Z'), pt('3', '2026-11-18T16:10:00Z', 47.62)], db)).toBe(1);
    // another person may use the same phone ids
    expect(await savePoints(B, 'Atlanta', [pt('1', '2026-11-18T17:00:00Z', 33.7, -84.4)], db)).toBe(1);
    expect(await savePoints(A, 'Seattle', [], db)).toBe(0);
  });

  it('reads each person\'s newest point since a time, for who is asked about', async () => {
    const all = await lastSeen(null, new Date('2026-11-18T00:00:00Z'), db);
    expect(all.map(r => r.userId).sort()).toEqual([A, B]);
    expect(all.find(r => r.userId === A)).toMatchObject({ lat: 47.62, branch: 'Seattle' });
    expect((await lastSeen([B], new Date('2026-11-18T00:00:00Z'), db)).map(r => r.userId)).toEqual([B]);
    expect(await lastSeen([], new Date(0), db)).toEqual([]);
    // yesterday's spot is not today's position
    expect(await lastSeen([A], new Date('2026-11-18T16:30:00Z'), db)).toEqual([]);
  });

  it('reads one person\'s day, oldest first, inside the bounds', async () => {
    const t = await trail(A, new Date('2026-11-18T08:00:00Z'), new Date('2026-11-19T08:00:00Z'), db);
    expect(t.map(r => r.lat)).toEqual([47.6, 47.61, 47.62]);
    expect(await trail(A, new Date('2026-11-18T16:06:00Z'), new Date('2026-11-19T08:00:00Z'), db)).toHaveLength(1);
  });

  it('deletes by age and by person', async () => {
    await savePoints(A, 'Seattle', [pt('old', '2026-06-01T16:00:00Z')], db);
    expect(await deleteOlderThan(new Date('2026-08-20T00:00:00Z'), db)).toBe(1);
    expect(await deleteForUser(B, db)).toBe(1);
    expect((await lastSeen(null, new Date(0), db)).map(r => r.userId)).toEqual([A]);
  });

  it('records consent once per version and keeps the first time', async () => {
    const first = await recordConsent(A, 1, 'iPhone', db);
    const again = await recordConsent(A, 1, 'another phone', db);
    expect(again).toEqual(first);
    await recordConsent(A, 2, 'iPhone', db);
    const v1 = await consentsFor([A, B], 1, db);
    expect([...v1.keys()]).toEqual([A]);
    expect([...(await consentsFor([A], 2, db)).keys()]).toEqual([A]);
    expect((await consentsFor([], 1, db)).size).toBe(0);
    // deleting a person's points never touches the record that they agreed
    await deleteForUser(A, db);
    expect((await consentsFor([A], 1, db)).has(A)).toBe(true);
  });
});
