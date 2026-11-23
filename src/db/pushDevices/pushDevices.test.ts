import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { saveDevice, removeToken, removeTokens, devicesFor, setEnvironment } from './index.ts';

const A = 'a'.repeat(24), B = 'b'.repeat(24);

describe('push devices', () => {
  let client: PGlite; let db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('keeps one row per token and hands it to whoever registered last', async () => {
    await saveDevice(A, 't1', 'ios', db);
    await saveDevice(A, 't1', 'ios', db);
    expect(await devicesFor([A], db)).toHaveLength(1);
    await setEnvironment('t1', 'sandbox', db);
    expect((await devicesFor([A], db))[0].environment).toBe('sandbox');
    await saveDevice(B, 't1', 'ios', db);
    expect(await devicesFor([A], db)).toHaveLength(0);
    const mine = await devicesFor([B], db);
    expect(mine).toHaveLength(1);
    expect(mine[0].environment).toBe(''); // a new owner's phone: learn again
  });
  it('remembers whether a phone is iOS or Android, and a token moved to another person takes the new platform', async () => {
    await saveDevice(A, 'fcm:token-1', 'android', db);
    expect((await devicesFor([A], db)).find(d => d.token === 'fcm:token-1')?.platform).toBe('android');
    await saveDevice(B, 'fcm:token-1', 'ios', db);
    expect((await devicesFor([B], db)).find(d => d.token === 'fcm:token-1')?.platform).toBe('ios');
    await removeTokens(['fcm:token-1'], db);
  });
  it('removes a token only for its owner, or by list', async () => {
    await removeToken('t1', A, db);
    expect(await devicesFor([B], db)).toHaveLength(1);
    await removeToken('t1', B, db);
    expect(await devicesFor([B], db)).toHaveLength(0);
    await saveDevice(A, 't2', 'ios', db); await saveDevice(A, 't3', 'ios', db);
    await removeTokens(['t2', 't3'], db);
    expect(await devicesFor([A], db)).toHaveLength(0);
  });
});
