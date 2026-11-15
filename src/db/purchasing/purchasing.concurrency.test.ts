/**
 * The races Purchasing must never lose, on a REAL Postgres (PGlite runs one connection, so the
 * parity test can't make two writes overlap). Skipped unless PG_RACE_URL points at a scratch
 * database, e.g.
 *
 *   createdb es_race && PG_RACE_URL=postgres:///es_race npx vitest run src/db/purchasing/purchasing.concurrency.test.ts
 *
 * The database is migrated and its Purchasing tables emptied by the test; never point it at
 * anything you keep.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { sql } from 'drizzle-orm';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { purchasingLocks, purchasingDrafts, purchasingDraftHistory, purchasingPoLinks } from '../schema/purchasing.ts';
import { pgStore } from './postgres.ts';

const url = process.env.PG_RACE_URL;
let conn: OpenDb;
const oid = () => String(new mongoose.Types.ObjectId());
const scopeId = oid();
const scopeFields = { name: 'Race', branches: ['Seattle'], cohortId: 'c', observedThrough: '2026-11-10', aliases: [], policies: [], reviewDays: 7, bufferDays: 21, stockMaxHours: 24, salesMaxDays: 14 };
const draft = (note: string) => ({ scopeId, status: 'draft', lines: [], loads: [], note, createdBy: { id: 'a', name: 'A' }, existingPoLines: [], history: [{ action: 'draft', at: new Date(), name: 'A', note }] });
/** Each call is its own transaction, as each request is. */
const inTx = <T>(work: (s: ReturnType<typeof pgStore>) => Promise<T>) => conn.db.transaction(tx => work(pgStore(tx, null)));

describe.skipIf(!url)('on a real Postgres', { timeout: 60000 }, () => {
  beforeAll(async () => {
    conn = await openDb(url!, { max: 12 });
    await migrateDb(conn.db, url!);
    await conn.db.execute(sql`truncate purchasing_scopes cascade`);
    await inTx(s => s.createScope(scopeId, scopeFields));
  }, 120000);
  afterAll(async () => { await conn?.close(); }, 30000);

  it('ten drafts taking the same stock line at once: one wins, the rest fail whole (code 11000), one lock row', async () => {
    const lock = JSON.stringify(['Seattle', 'race stone']);
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, i) =>
      inTx(s => s.createDraft(oid(), draft(`buyer ${i}`), [{ _id: lock, scopeId }]))));
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
    for (const a of attempts) if (a.status === 'rejected') expect((a.reason as { code?: unknown }).code).toBe(11000);
    expect(await conn.db.select().from(purchasingLocks)).toHaveLength(1);
    // A lost draft leaves nothing behind: one draft, one history line.
    expect(await conn.db.select().from(purchasingDrafts)).toHaveLength(1);
    expect(await conn.db.select().from(purchasingDraftHistory)).toHaveLength(1);
  });

  it('drafts on different stock lines don’t block each other', async () => {
    const before = (await conn.db.select().from(purchasingDrafts)).length;
    const made = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      inTx(s => s.createDraft(oid(), draft(`line ${i}`), [{ _id: JSON.stringify(['Seattle', `stone ${i}`]), scopeId }]))));
    expect(made).toHaveLength(8);
    expect((await conn.db.select().from(purchasingDrafts)).length).toBe(before + 8);
  });

  it('ten Approve / Cancel clicks on one draft version: one wins, one history line, version +1', async () => {
    const id = oid();
    await inTx(s => s.createDraft(id, draft('to approve'), [{ _id: JSON.stringify(['Seattle', 'approve stone']), scopeId }]));
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => inTx(async s => {
      const done = await s.changeDraft(id, {
        version: 0, fromStatus: 'draft', status: i % 2 ? 'cancelled' : 'approved', entry: { action: i % 2 ? 'cancel' : 'approve', at: new Date(), name: `p${i}`, note: 'x' }
      });
      return done;
    })));
    expect(results.filter(Boolean)).toHaveLength(1);
    const final = (await inTx(s => s.findDraft(id)))!;
    expect(final.__v).toBe(1);
    expect(final.history).toHaveLength(2);
    expect(final.status).toBe(results.find(Boolean)!.status);
  });

  it('two buyers linking the same PO line: the second is refused with code 11000 and its draft change rolls back', async () => {
    const [a, b] = [oid(), oid()];
    await inTx(s => s.createDraft(a, draft('a'), [{ _id: JSON.stringify(['Seattle', 'po stone a']), scopeId }]));
    await inTx(s => s.createDraft(b, draft('b'), [{ _id: JSON.stringify(['Seattle', 'po stone b']), scopeId }]));
    const key = JSON.stringify(['PO7', '1']);
    const link = (id: string) => inTx(async s => {
      const done = await s.changeDraft(id, { version: 0, fromStatus: 'draft', status: 'ordered', linkedPoLines: [key], entry: { action: 'link', at: new Date(), name: 'x', note: 'x' } });
      await s.insertPoLinks([key], id);
      await s.releaseLocks(id);
      return done;
    });
    const outcomes = await Promise.allSettled([link(a), link(b)]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    const lost = outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult;
    expect((lost.reason as { code?: unknown }).code).toBe(11000);
    expect(await conn.db.select().from(purchasingPoLinks)).toHaveLength(1);
    const loserId = (await conn.db.select().from(purchasingPoLinks))[0].draftId === a ? b : a;
    expect((await inTx(s => s.findDraft(loserId)))!.status).toBe('draft');
  });

  it('ten scope saves at one version: one wins, the others see no row', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => inTx(s => s.updateScope(scopeId, 0, { ...scopeFields, name: `save ${i}` }))));
    expect(results.filter(Boolean)).toHaveLength(1);
    const now = (await inTx(s => s.findScope(scopeId)))!;
    expect(now.__v).toBe(1);
    expect(now.name).toBe(results.find(Boolean)!.name);
  });
});
