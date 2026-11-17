/** Real connection overlap; PG_RACE_URL must point at a disposable scratch database. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { locations, roles, users } from '../schema/reference.ts';
import { permits } from '../schema/permits.ts';
import { newId } from '../ids.ts';
import { incLoginAttempts, userDoc } from './users.postgres.ts';
import { savePermits } from '../permits/writesPostgres.ts';

const hashing = vi.hoisted(() => ({ entered: null as (() => void) | null, wait: null as Promise<void> | null }));
vi.mock('bcryptjs', () => ({ default: {
  genSalt: async () => 'salt',
  hash: async (pw: string) => { hashing.entered?.(); await hashing.wait; return `hash:${pw}`; }
} }));

const url = process.env.PG_RACE_URL;
const user = newId(), location = newId(), role = newId();
const roleName = `review_${role}`, source = `review_${user}`;
let conn: OpenDb;

describe.skipIf(!url)('migration saves on real Postgres', () => {
  beforeAll(async () => {
    conn = await openDb(url!, { max: 5 });
    await migrateDb(conn.db, url!);
    await conn.db.insert(locations).values({ id: location, name: `Review ${location}` });
    await conn.db.insert(roles).values({ id: role, name: roleName, displayName: 'Review' });
    await conn.db.insert(users).values({ id: user, username: `review_${user}`, passwordHash: 'hash:old-password', role: roleName });
  }, 60_000);
  afterAll(async () => {
    if (!conn) return;
    await conn.db.delete(permits).where(eq(permits.source, source));
    await conn.db.delete(users).where(eq(users.id, user));
    await conn.db.delete(roles).where(eq(roles.id, role));
    await conn.db.delete(locations).where(eq(locations.id, location));
    await conn.close();
  });

  it('an attempt counted during a password save waits and survives the save', async () => {
    let entered!: () => void, release!: () => void;
    const inHash = new Promise<void>(resolve => { entered = resolve; });
    hashing.entered = entered;
    hashing.wait = new Promise<void>(resolve => { release = resolve; });
    const doc = (await userDoc(conn.db, { _id: user }))!;
    doc.password = 'new-password';
    const saving = doc.save();
    let increment: Promise<void> | undefined;
    let finishedBeforeSave = false;
    try {
      await inHash;
      increment = incLoginAttempts(conn.db, user).then(() => { finishedBeforeSave = true; });
      await Promise.race([increment, new Promise(resolve => setTimeout(resolve, 100))]);
      expect(finishedBeforeSave).toBe(false);
    } finally {
      release();
      await Promise.all([saving, increment]);
      hashing.wait = null;
      hashing.entered = null;
    }
    const [saved] = await conn.db.select().from(users).where(eq(users.id, user));
    expect(saved).toMatchObject({ passwordHash: 'hash:new-password', loginAttempts: 1 });
  });

  it('overlapping batches for one permit merge independent fields and keep one stable id', async () => {
    const at = new Date();
    const inputs = [
      { permitNumber: 'ONE', categoryIfNew: 'residential', address: '1 Main' },
      { permitNumber: 'ONE', categoryIfNew: 'residential', projectName: 'Project' },
      { permitNumber: 'ONE', categoryIfNew: 'residential', contacts: [{ company: 'Builder' }] }
    ];
    const results = await Promise.all(inputs.map(p => savePermits(conn.db, source, [p], [newId()], at, false)));
    expect(results.reduce((n, r) => n + r.added, 0)).toBe(1);
    const rows = await conn.db.select().from(permits).where(eq(permits.source, source));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ address: '1 Main', projectName: 'Project', category: 'residential' });
  });
});
