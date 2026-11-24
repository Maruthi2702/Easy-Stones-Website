import mongoose from 'mongoose';
import * as staffData from '../db/staff/index.ts';
import * as reminderData from '../db/cardReceipts/reminders.ts';
import { areaOn } from '../db/appDb.ts';
import { deliverReminders, type ReminderSenders } from '../services/receiptReminders.ts';
import {
  AUTOMATIC_BY, STAFF_FIELDS, dueMissingReminders, groupByRecipient, idOf, missingRecipients, nameOfPerson, reminderHistory, staffIndex,
  type Person, type ReminderExpense, type ReminderItem
} from '../utils/receiptReminders.ts';

/**
 * Missing-receipt reminders (owner, 2026-11-23; rules in src/utils/receiptReminders.ts): every hour, each Missing
 * row 48 h old gets the day-2 reminder and 72 h old the day-3 one, once each. The receipt is stamped **before**
 * anything is sent (a guarded write, so two servers or a crash mid-send never send twice), then each person gets
 * one email and one push listing all their receipts.
 */
export type ReminderJobDeps = {
  listMissing?: () => Promise<ReminderExpense[]>;
  findStaff?: () => Promise<Person[]>;
  markReminded?: typeof reminderData.markReminded;
  senders?: ReminderSenders;
  /** Whether the databases are up; a run before that does nothing. */
  ready?: () => boolean;
};

/** MongoDB connected when anything the job reads is still on it, and Postgres configured when anything is there. */
const databasesReady = () => {
  const areas = [areaOn('card_receipts'), areaOn('staff')];
  if (areas.includes('mongo') && mongoose.connection.readyState !== 1) return false;
  return !areas.includes('postgres') || Boolean(process.env.DATABASE_URL);
};

export type ReminderRun = { due: number; reminded: number; day2: number; day3: number; people: number; emails: number; pushes: number; skipped?: string };

let running = false;

export async function runMissingReceiptReminders(now: Date = new Date(), deps: ReminderJobDeps = {}): Promise<ReminderRun> {
  const out: ReminderRun = { due: 0, reminded: 0, day2: 0, day3: 0, people: 0, emails: 0, pushes: 0 };
  if (!(deps.ready ?? databasesReady)()) return { ...out, skipped: 'database not ready' };
  if (running) return { ...out, skipped: 'already running' };
  running = true;
  try {
    const list = await (deps.listMissing ?? (reminderData.listMissingForReminders as () => Promise<ReminderExpense[]>))();
    const due = dueMissingReminders(list, now);
    out.due = due.length;
    if (!due.length) return out;
    const staff = staffIndex(await (deps.findStaff ?? (() => staffData.findUsers({}, { select: STAFF_FIELDS }) as Promise<Person[]>))());
    const mark = deps.markReminded ?? reminderData.markReminded;
    const items: ReminderItem[] = [];
    for (const d of due) {
      const who = missingRecipients(d, staff);
      if (!who.email.length && !who.push.length) continue;
      const names = [...new Set([...who.email, ...who.push])].map((id) => nameOfPerson(staff.byId.get(id)));
      const line = reminderHistory({ byName: AUTOMATIC_BY, names, email: who.email.length > 0, push: who.push.length > 0, stage: d.stage });
      // Stamp first: a guard on the stamp's own key means a second run (or server) finds it done and sends nothing.
      const marked = await mark(idOf(d.expense), d.stamps as Record<string, string>, { at: now, ...line },
        { key: d.stage === 'day3' ? 'missing3At' : 'missing2At' });
      if (!marked) continue;
      items.push({ expense: d.expense, stage: d.stage, email: who.email, push: who.push });
      out[d.stage]++;
    }
    out.reminded = items.length;
    const batches = groupByRecipient(items);
    out.people = batches.length;
    const sent = await deliverReminders(batches, staff, { senders: deps.senders });
    out.emails = sent.emails;
    out.pushes = sent.pushes;
    return out;
  } catch (err) {
    console.error('Missing-receipt reminders failed:', (err as Error)?.message || err);
    return out;
  } finally {
    running = false;
    console.log(`🧾 Missing-receipt reminders: ${out.due} due · ${out.reminded} reminded (day 2: ${out.day2}, day 3: ${out.day3}) · ${out.people} people · ${out.emails} emails · ${out.pushes} pushes`);
  }
}

export function startMissingReceiptReminders() {
  setTimeout(() => { void runMissingReceiptReminders(); }, 5 * 60 * 1000).unref();
  setInterval(() => { void runMissingReceiptReminders(); }, 60 * 60 * 1000).unref();
}
