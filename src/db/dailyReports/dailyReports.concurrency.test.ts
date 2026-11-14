/**
 * The races the August 2026 incident and the double Seattle email were about, on a REAL Postgres
 * (PGlite runs one connection, so the parity test can't make two writes overlap). Skipped unless
 * PG_RACE_URL points at a scratch database, e.g.
 *
 *   createdb es_race && PG_RACE_URL=postgres:///es_race npx vitest run src/db/dailyReports/dailyReports.concurrency.test.ts
 *
 * The database is migrated and emptied by the test; never point it at anything you keep.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { sql } from 'drizzle-orm';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { locations } from '../schema/reference.ts';
import { dailyReports } from '../schema/operations.ts';
import DailyReport from '../../models/DailyReport.ts';
import * as pg from './postgres.ts';
import { logEntry } from '../../utils/dailyReportLog.ts';

const url = process.env.PG_RACE_URL;
let conn: OpenDb;
const seattle = String(new mongoose.Types.ObjectId());

describe.skipIf(!url)('on a real Postgres', () => {
  beforeAll(async () => {
    conn = await openDb(url!, { max: 10 });
    await migrateDb(conn.db, url!);
    await conn.db.execute(sql`truncate daily_reports, locations cascade`);
    await conn.db.insert(locations).values({ id: seattle, name: 'Seattle', timeZone: 'America/Los_Angeles' } as never);
  });
  afterAll(async () => { await conn?.close(); });

  const draftOn = async (day: string) => (await pg.writeDraft(conn.db, day, 'Seattle', { date: day, location: 'Seattle', notes: 'typed' }))!;

  it('ten Submits at once: one wins, one submit line, nothing else changes the day', async () => {
    const saved = await draftOn('2026-11-09');
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) => {
      const doc = DailyReport.hydrate(saved.toObject());
      doc.set({ status: 'submitted', submittedBy: `person ${i}`, submittedAt: new Date(), autoSubmitted: false });
      return pg.claim(conn.db, doc, [logEntry('submitted', `person ${i}`, '')]);
    }));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const day = (await pg.find(conn.db, '2026-11-09', 'Seattle'))!;
    expect(day.status).toBe('submitted');
    expect(day.log.filter(l => l.action === 'submitted')).toHaveLength(1);
    expect(day.submittedBy).toBe(attempts.find(Boolean)!.submittedBy);
  });

  it('autosaves racing a Submit never turn a submitted day back into a draft', async () => {
    const saved = await draftOn('2026-11-10');
    const doc = DailyReport.hydrate(saved.toObject());
    doc.set({ status: 'submitted', submittedBy: 'Dee', submittedAt: new Date() });
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 15; i++) work.push(pg.writeDraft(conn.db, '2026-11-10', 'Seattle', { date: '2026-11-10', location: 'Seattle', status: 'draft', notes: `save ${i}` }));
    work.splice(7, 0, pg.claim(conn.db, doc, [logEntry('submitted', 'Dee', '')]));
    await Promise.all(work);
    expect((await pg.find(conn.db, '2026-11-10', 'Seattle'))!.status).toBe('submitted');
    // And once it is submitted, every later save is refused.
    expect(await Promise.all(Array.from({ length: 5 }, () => pg.writeDraft(conn.db, '2026-11-10', 'Seattle', { date: '2026-11-10', location: 'Seattle', notes: 'late' }))))
      .toEqual([null, null, null, null, null]);
  });

  it('the first save of a new day from several tabs makes one report', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      pg.writeDraft(conn.db, '2026-11-11', 'Seattle', { date: '2026-11-11', location: 'Seattle', notes: `tab ${i}` })));
    expect(results.every(Boolean)).toBe(true);
    const rows = await conn.db.select().from(dailyReports).where(sql`${dailyReports.day} = '2026-11-11'`);
    expect(rows).toHaveLength(1);
  });

  it('log lines written at the same moment each get their own place, none lost', async () => {
    await draftOn('2026-11-12');
    await Promise.all(Array.from({ length: 12 }, (_, i) => pg.pushLog(conn.db, '2026-11-12', 'Seattle', logEntry('emailed', `p${i}`, `n${i}`))));
    const day = (await pg.find(conn.db, '2026-11-12', 'Seattle'))!;
    expect(day.log).toHaveLength(12);
    expect(new Set(day.log.map(l => l.note)).size).toBe(12);
  });

  it('the same transfer arriving twice at once is added to a submitted day once', async () => {
    const saved = await draftOn('2026-11-13');
    const doc = DailyReport.hydrate(saved.toObject());
    doc.set({ status: 'submitted', submittedBy: 'Dee', submittedAt: new Date() });
    await pg.claim(conn.db, doc, [logEntry('submitted', 'Dee', '')]);
    const line = { fromTo: 'SPO — SEA', transferNumber: '5', count: 1, slabs: 3, auto: true, direction: 'in', ticketIds: ['tk-1'] };
    const added = await Promise.all(Array.from({ length: 6 }, () => pg.addTransferIfSubmitted(conn.db, '2026-11-13', 'Seattle', 'tk-1', line, logEntry('transfer_added', 'Dee', 'x'))));
    expect(added.filter(Boolean)).toHaveLength(1);
    const day = (await pg.find(conn.db, '2026-11-13', 'Seattle'))!;
    expect(day.transfers).toHaveLength(1);
    expect(day.log.filter(l => l.action === 'transfer_added')).toHaveLength(1);
  });
});
