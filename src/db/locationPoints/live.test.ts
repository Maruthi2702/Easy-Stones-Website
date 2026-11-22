import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { savePoints } from './index.ts';
import { latestFor, saveHealth, healthFor, logView, logViews, viewLogFor, deleteViewLogOlderThan } from './live.ts';

const A = 'a'.repeat(24), B = 'b'.repeat(24);
const pt = (clientId: string, iso: string, lat = 47.6, lng = -122.3) => ({ clientId, recordedAt: new Date(iso), lat, lng, accuracyM: 10, speedMps: null });
const beat = (iso: string, over = {}) => ({ permission: 'always' as const, lowPower: false, batteryPct: 80, charging: false, appVersion: '1', queued: 0, reportedAt: new Date(iso), ...over });

describe('location v2 data layer', () => {
  let client: PGlite; let db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('keeps each person\'s newest point in location_latest, moving only forward in time', async () => {
    await savePoints(A, 'Seattle', [pt('1', '2026-11-18T16:00:00Z', 47.6), pt('2', '2026-11-18T16:05:00Z', 47.61)], db);
    expect((await latestFor([A], db))[0]).toMatchObject({ userId: A, lat: 47.61, branch: 'Seattle' });
    // a backlog from earlier in the day arrives late: the row does not go back
    await savePoints(A, 'Seattle', [pt('0', '2026-11-18T15:00:00Z', 47.5)], db);
    expect((await latestFor([A], db))[0]).toMatchObject({ lat: 47.61, recordedAt: new Date('2026-11-18T16:05:00Z') });
    // a newer point moves it, and a repeat of the same batch changes nothing
    await savePoints(A, 'Seattle', [pt('3', '2026-11-18T16:10:00Z', 47.62)], db);
    await savePoints(A, 'Seattle', [pt('3', '2026-11-18T16:10:00Z', 47.62)], db);
    expect((await latestFor([A], db))[0]).toMatchObject({ lat: 47.62 });
    await savePoints(B, 'Atlanta', [pt('1', '2026-11-18T17:00:00Z', 33.7, -84.4)], db);
    expect((await latestFor(null, db)).map(r => r.userId).sort()).toEqual([A, B]);
    expect(await latestFor([], db)).toEqual([]);
  });

  it('saves a heartbeat, and an older one arriving late changes nothing', async () => {
    await saveHealth(A, beat('2026-11-18T17:00:00Z', { batteryPct: 50 }), db);
    await saveHealth(A, beat('2026-11-18T16:00:00Z', { batteryPct: 90 }), db);
    expect((await healthFor([A, B], db)).get(A)).toMatchObject({ batteryPct: 50, permission: 'always' });
    await saveHealth(A, beat('2026-11-18T17:30:00Z', { batteryPct: 4, lowPower: true }), db);
    expect((await healthFor([A], db)).get(A)).toMatchObject({ batteryPct: 4, lowPower: true });
    expect((await healthFor([B], db)).size).toBe(0);
  });

  it('writes a map look once per viewer and person per window, but every trail', async () => {
    const t0 = new Date('2026-11-18T18:00:00Z');
    const v = { viewerId: 'm1', viewerName: 'Mo', subjectId: A, subjectName: 'Rita' };
    expect(await logView({ ...v, kind: 'live' }, t0, 60_000, db)).toBe(true);
    expect(await logView({ ...v, kind: 'live' }, new Date(t0.getTime() + 30_000), 60_000, db)).toBe(false);   // inside the window
    expect(await logView({ ...v, kind: 'live' }, new Date(t0.getTime() + 120_000), 60_000, db)).toBe(true);   // after it
    expect(await logView({ ...v, kind: 'trail', day: '2026-11-18' }, new Date(t0.getTime() + 121_000), 60_000, db)).toBe(true);
    expect(await logView({ ...v, kind: 'trail', day: '2026-11-18' }, new Date(t0.getTime() + 122_000), 60_000, db)).toBe(true); // a trail is always a line
    // several at once skips the ones just logged
    await logViews([{ ...v, kind: 'live' }, { ...v, subjectId: B, subjectName: 'Dan', kind: 'live' }], new Date(t0.getTime() + 150_000), 60_000, db);
    const all = await viewLogFor({ viewerId: 'm1' }, db);
    expect(all.filter(r => r.kind === 'live' && r.subjectId === B)).toHaveLength(1);
    expect(all.filter(r => r.kind === 'live' && r.subjectId === A)).toHaveLength(2);   // 'live' at t0+120s counts as recent for t0+150s
    expect(all.filter(r => r.kind === 'trail')).toHaveLength(2);
    expect(all[0]!.viewedAt >= all[all.length - 1]!.viewedAt).toBe(true);              // newest first
  });

  it('filters the log and deletes by age', async () => {
    expect((await viewLogFor({ subjectId: B }, db)).every(r => r.subjectId === B)).toBe(true);
    expect(await viewLogFor({ viewerId: 'nobody' }, db)).toEqual([]);
    expect((await viewLogFor({ from: new Date('2030-01-01T00:00:00Z') }, db))).toEqual([]);
    const before = (await viewLogFor({}, db)).length;
    const gone = await deleteViewLogOlderThan(new Date('2026-11-18T18:01:00Z'), db);
    expect(gone).toBeGreaterThan(0);
    expect((await viewLogFor({}, db)).length).toBe(before - gone);
  });
});
