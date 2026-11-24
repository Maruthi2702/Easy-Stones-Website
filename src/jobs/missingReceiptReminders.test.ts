// Missing-receipt reminders (src/jobs/missingReceiptReminders.ts): with fake time and fake senders, a row gets
// day 2 at 48 h and day 3 at 72 h, each once; then the same job on Postgres (PGlite) through the real data
// layer (src/db/cardReceipts/reminders.ts): stamps and history written, updated_at untouched.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema/index.ts';
import { migrateDb } from '../db/client.ts';
import { useAppDbForTests } from '../db/appDb.ts';
import type { Db } from '../db/copy/plan.ts';
import { runMissingReceiptReminders } from './missingReceiptReminders.ts';
import { HOUR_MS, type Person, type ReminderExpense } from '../utils/receiptReminders.ts';
import type { ReminderGuard, ReminderHistoryEntry } from '../db/cardReceipts/reminders.ts';

const id = (n: number) => n.toString(16).padStart(24, '0');
const P = { rep: id(1), mgr: id(2), acct: id(3), admin: id(4) };
const STAFF: Person[] = [
  { _id: P.rep, displayName: 'Maria Lopez', role: 'sales_rep', location: 'Seattle', email: 'maria@x.test' },
  { _id: P.mgr, displayName: 'Dana Whitfield', role: 'manager', location: 'Seattle', email: 'dana@x.test' },
  { _id: P.acct, displayName: 'Ann Count', role: 'accounting', email: 'ann@x.test' },
  { _id: P.admin, displayName: 'Ada Min', role: 'admin', email: 'ada@x.test' }
];
const CREATED = new Date('2026-11-20T18:00:00Z');
const at = (hours: number) => new Date(CREATED.getTime() + hours * HOUR_MS);

function fakes(rows: ReminderExpense[]) {
  const emails: { to: string; subject: string }[] = [];
  const pushes: { ids: string[]; title: string }[] = [];
  const history: ReminderHistoryEntry[] = [];
  return {
    emails, pushes, history,
    deps: {
      ready: () => true,
      listMissing: async () => rows.map((r) => ({ ...r, reminders: { ...(r.reminders || {}) } })),
      findStaff: async () => STAFF,
      markReminded: async (rid: string, patch: Record<string, string>, entry: ReminderHistoryEntry, guard?: ReminderGuard) => {
        const row = rows.find((r) => String(r._id) === rid)!;
        const r = (row.reminders ||= {}) as Record<string, string>;
        if (guard && (guard.value == null ? r[guard.key] != null : r[guard.key] === guard.value)) return false;
        Object.assign(r, patch);
        history.push(entry);
        return true;
      },
      senders: {
        sendEmail: async (o: { to: string; subject: string }) => { emails.push(o); return { success: true }; },
        sendPush: async (ids: string[], m: { title: string }) => { pushes.push({ ids, title: m.title }); }
      }
    }
  };
}

describe('the hourly job, fake time', () => {
  it('day 2 at 48 h, day 3 at 72 h, each once', async () => {
    const rows: ReminderExpense[] = [{ _id: id(100), userId: P.rep, holderName: 'Maria Lopez', merchant: 'Shell', cents: 6120, date: '2026-11-20', location: 'Seattle', status: 'missing', createdAt: CREATED }];
    const f = fakes(rows);
    expect((await runMissingReceiptReminders(at(47), f.deps)).reminded).toBe(0);
    const day2 = await runMissingReceiptReminders(at(48), f.deps);
    expect(day2).toMatchObject({ due: 1, reminded: 1, day2: 1, day3: 0, people: 2 });
    expect(f.emails.map((e) => e.to).sort()).toEqual(['dana@x.test', 'maria@x.test']);
    expect(f.pushes).toEqual([{ ids: [P.rep], title: 'Missing receipt' }]);
    expect(f.history[0]!.changes).toBe('Missing receipt, day 2 · to Maria Lopez, Dana Whitfield · email + phone');
    // The next hours: nothing again until 72 h.
    expect((await runMissingReceiptReminders(at(49), f.deps)).reminded).toBe(0);
    expect((await runMissingReceiptReminders(at(71), f.deps)).reminded).toBe(0);
    f.emails.length = 0; f.pushes.length = 0;
    const day3 = await runMissingReceiptReminders(at(72), f.deps);
    expect(day3).toMatchObject({ reminded: 1, day2: 0, day3: 1, people: 4 });
    expect(f.emails.map((e) => e.to).sort()).toEqual(['ada@x.test', 'ann@x.test', 'dana@x.test', 'maria@x.test']);
    expect(f.pushes).toHaveLength(4);
    expect(f.emails[0]!.subject).toBe('Still missing: Shell $61.20');
    f.emails.length = 0;
    expect((await runMissingReceiptReminders(at(200), f.deps)).reminded).toBe(0);
    expect(f.emails).toHaveLength(0);
    expect(f.history).toHaveLength(2);
  });

  it('a row first seen past 72 h gets day 3 only; a guard that lost the race sends nothing', async () => {
    const rows: ReminderExpense[] = [
      { _id: id(101), userId: P.rep, holderName: 'Maria Lopez', merchant: 'Arco', cents: 100, date: '2026-11-10', location: 'Seattle', status: 'missing', createdAt: at(-200) },
      { _id: id(102), userId: P.rep, holderName: 'Maria Lopez', merchant: 'Chevron', cents: 200, date: '2026-11-10', location: 'Seattle', status: 'missing', createdAt: at(-200) }
    ];
    const f = fakes(rows);
    const lost = { ...f.deps, markReminded: async (rid: string, patch: Record<string, string>, entry: ReminderHistoryEntry, guard?: ReminderGuard) =>
      (rid === id(102) ? false : f.deps.markReminded(rid, patch, entry, guard)) };
    const run = await runMissingReceiptReminders(at(0), lost);
    expect(run).toMatchObject({ due: 2, reminded: 1, day2: 0, day3: 1 });
    expect(rows[0]!.reminders).toEqual({ missing2At: at(0).toISOString(), missing3At: at(0).toISOString() });
    expect(f.emails.filter((e) => e.to === 'maria@x.test')).toHaveLength(1);
  });

  it('does nothing while the database is not ready', async () => {
    const f = fakes([]);
    expect(await runMissingReceiptReminders(at(100), { ...f.deps, ready: () => false })).toMatchObject({ skipped: 'database not ready' });
  });
});

describe('on Postgres', () => {
  let client: PGlite; let db: Db;
  const EXP = id(500);
  const before = process.env.DB_CARD_RECEIPTS;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
    useAppDbForTests(db);
    process.env.DB_CARD_RECEIPTS = 'postgres';
    await db.insert(schema.roles).values([{ id: id(900), name: 'sales_rep', displayName: 'Sales rep' }]).onConflictDoNothing();
    await db.insert(schema.users).values([{ id: P.rep, username: 'maria', displayName: 'Maria Lopez', passwordHash: 'x', role: 'sales_rep' }]);
  }, 60_000);
  afterAll(async () => {
    process.env.DB_CARD_RECEIPTS = before ?? '';
    useAppDbForTests(null);
    await client?.close();
  });
  beforeEach(async () => {
    await db.delete(schema.cardExpenseHistory);
    await db.delete(schema.cardExpenses);
    await db.insert(schema.cardExpenses).values({
      id: EXP, userId: P.rep, holderName: 'Maria Lopez', cardLabel: 'MARU92069', day: '2026-11-20', month: '2026-11', merchant: 'Shell', cents: 6120,
      status: 'missing', createdAt: CREATED, updatedAt: CREATED
    });
    await db.insert(schema.cardExpenseHistory).values({ expenseId: EXP, position: 0, at: CREATED, by: 'Easy Surfaces', action: 'added', changes: 'Missing receipt' });
  });

  it('stamps, adds one history line and leaves updated_at alone; never twice', async () => {
    const emails: string[] = [];
    const deps = { ready: () => true, findStaff: async () => STAFF, senders: { sendEmail: async (o: { to: string }) => { emails.push(o.to); return { success: true }; }, sendPush: async () => undefined } };
    expect(await runMissingReceiptReminders(at(48), deps)).toMatchObject({ due: 1, reminded: 1, day2: 1 });
    expect(await runMissingReceiptReminders(at(49), deps)).toMatchObject({ due: 0, reminded: 0 });
    const [row] = await db.select().from(schema.cardExpenses).where(eq(schema.cardExpenses.id, EXP));
    expect(row!.reminders).toEqual({ missing2At: at(48).toISOString() });
    expect(new Date(row!.updatedAt).getTime()).toBe(CREATED.getTime());
    const lines = await db.select().from(schema.cardExpenseHistory).where(eq(schema.cardExpenseHistory.expenseId, EXP));
    expect(lines.map((l) => [l.position, l.action])).toEqual([[0, 'added'], [1, 'sent a reminder']]);
    expect(emails.sort()).toEqual(['ada@x.test', 'maria@x.test']); // no branch saved on it → no manager → the Admins
    expect((await runMissingReceiptReminders(at(72), deps)).day3).toBe(1);
    const [after] = await db.select().from(schema.cardExpenses).where(eq(schema.cardExpenses.id, EXP));
    expect(after!.reminders).toEqual({ missing2At: at(48).toISOString(), missing3At: at(72).toISOString() });
  });

  it('a manual stamp is guarded by the day', async () => {
    const { markReminded, listByIds } = await import('../db/cardReceipts/reminders.ts');
    const entry = { at: at(1), by: 'Ann Count', action: 'sent a reminder', changes: 'to Maria Lopez · email' };
    expect(await markReminded(EXP, { lastDay: '2026-11-23' }, entry, { key: 'lastDay', value: '2026-11-23' })).toBe(true);
    expect(await markReminded(EXP, { lastDay: '2026-11-23' }, entry, { key: 'lastDay', value: '2026-11-23' })).toBe(false);
    expect(await markReminded(EXP, { lastDay: '2026-11-24' }, entry, { key: 'lastDay', value: '2026-11-24' })).toBe(true);
    const [e] = await listByIds([EXP, 'nope']);
    expect(e).toMatchObject({ _id: EXP, userId: P.rep, status: 'missing', reminders: { lastDay: '2026-11-24' } });
  });
});
