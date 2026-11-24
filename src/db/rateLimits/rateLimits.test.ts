import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { hit, giveBack, reset, prune } from './index.ts';
import { rateLimitHits } from '../schema/rateLimits.ts';

describe('shared request counters', () => {
  let client: PGlite; let db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('counts up inside a window and keeps the window’s end', async () => {
    const a = await hit('t:one', 60_000, db);
    const b = await hit('t:one', 60_000, db);
    const c = await hit('t:one', 60_000, db);
    expect([a.hits, b.hits, c.hits]).toEqual([1, 2, 3]);
    expect(c.resetsAt.getTime()).toBe(a.resetsAt.getTime());
  });
  it('keeps each key apart', async () => {
    await hit('t:x', 60_000, db);
    expect((await hit('t:y', 60_000, db)).hits).toBe(1);
  });
  it('starts again once the window has ended', async () => {
    await hit('t:old', 60_000, db);
    await hit('t:old', 60_000, db);
    await db.update(rateLimitHits).set({ resetsAt: new Date(Date.now() - 1000) });
    const again = await hit('t:old', 60_000, db);
    expect(again.hits).toBe(1);
    expect(again.resetsAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('gives one back (never below zero), resets a key, and prunes long-ended rows', async () => {
    await hit('t:back', 60_000, db);
    await giveBack('t:back', db);
    await giveBack('t:back', db);
    expect((await hit('t:back', 60_000, db)).hits).toBe(1);
    await reset('t:back', db);
    expect((await hit('t:back', 60_000, db)).hits).toBe(1);
    await hit('t:stale', 60_000, db);
    await db.update(rateLimitHits).set({ resetsAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    await prune(db);
    expect(await db.select().from(rateLimitHits)).toHaveLength(0);
  });
  it('is one atomic count when requests arrive together', async () => {
    const all = await Promise.all(Array.from({ length: 10 }, () => hit('t:race', 60_000, db)));
    expect(all.map(r => r.hits).sort((p, q) => p - q)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('the express-rate-limit store', () => {
  it('counts through the shared table, under its own prefix', async () => {
    const counters = await import('./index.ts');
    const spy = vi.spyOn(counters, 'hit').mockResolvedValue({ hits: 7, resetsAt: new Date(123) });
    const { PostgresRateLimitStore } = await import('../../services/rateLimitStore.ts');
    const store = new PostgresRateLimitStore('scan');
    store.init({ windowMs: 600_000 } as never);
    expect(await store.increment('person')).toEqual({ totalHits: 7, resetTime: new Date(123) });
    expect(spy).toHaveBeenCalledWith('scan:person', 600_000);
    spy.mockRestore();
  });
});
