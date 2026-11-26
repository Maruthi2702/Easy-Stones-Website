/**
 * After a bank statement upload makes Missing receipt rows, each cardholder gets one email and one push naming their
 * charges (owner, 2026-11-26). **Only while the automatic-reminders switch is on** (the one setting that governs every
 * reminder: `cardReceiptAutoReminders`); with it off nothing is sent. Never throws: an upload never fails because of it.
 */
import * as staffData from '../db/staff/index.ts';
import type { NewMissing } from '../db/cardStatements/index.ts';
import { automaticRemindersOn } from '../jobs/missingReceiptReminders.ts';
import { sendEmail as realSendEmail } from './emailService.ts';
import { sendPushToUsers } from './apns.ts';
import { phoneSetOf, reminderEmailHtml, siteBase, type ReminderSenders } from './receiptReminders.ts';
import { SENDER_NAME } from '../utils/emailSender.ts';
import { RECEIPTS_PATH, STAFF_FIELDS, statementNoticeWords, type Person } from '../utils/receiptReminders.ts';

export type NoticeDeps = { senders?: ReminderSenders; switchOn?: () => Promise<boolean>; findStaff?: () => Promise<Person[]> };
export type NoticeRun = { people: number; emails: number; pushes: number; skipped?: string };

export async function notifyNewMissingReceipts(fresh: readonly NewMissing[], deps: NoticeDeps = {}): Promise<NoticeRun> {
  const out: NoticeRun = { people: 0, emails: 0, pushes: 0 };
  if (!fresh.length) return { ...out, skipped: 'nothing new' };
  try {
    if (!(await (deps.switchOn ?? automaticRemindersOn)())) return { ...out, skipped: 'switch off' };
    const byHolder = new Map<string, NewMissing[]>();
    for (const m of fresh) byHolder.set(m.userId, [...(byHolder.get(m.userId) ?? []), m]);
    const staff = await (deps.findStaff ?? (() => staffData.findUsers({}, { select: STAFF_FIELDS }) as Promise<Person[]>))();
    const people = new Map(staff.map((p) => [String((p as { _id?: unknown })._id ?? ''), p]));
    const holders = [...byHolder.keys()].filter((id) => (people.get(id) as { isActive?: boolean } | undefined)?.isActive !== false && people.has(id));
    const phones = await phoneSetOf(holders, deps.senders);
    const sendEmail = deps.senders?.sendEmail ?? realSendEmail;
    const sendPush = deps.senders?.sendPush ?? sendPushToUsers;
    const link = siteBase() ? `${siteBase()}${RECEIPTS_PATH}` : '';
    await Promise.all(holders.map(async (id) => {
      const charges = [...byHolder.get(id)!].sort((a, b) => a.date.localeCompare(b.date));
      const words = statementNoticeWords(charges);
      const to = String((people.get(id) as { email?: string }).email ?? '').trim();
      let reached = false;
      if (to) {
        try {
          const r = await sendEmail({ to, subject: words.email.subject, html: reminderEmailHtml(words.email, link), defaultSenderName: SENDER_NAME });
          if (r?.success === false) console.error(`⚠️ Statement notice email to ${to} failed: ${r.error ?? ''}`);
          else { out.emails++; reached = true; }
        } catch (err) { console.error('⚠️ Statement notice email threw:', (err as Error)?.message || err); }
      }
      if (!phones || phones.has(id)) {
        try { await sendPush([id], words.push); out.pushes++; reached = true; } catch (err) { console.error('⚠️ Statement notice push threw:', (err as Error)?.message || err); }
      }
      if (reached) out.people++;
    }));
    return out;
  } catch (err) {
    console.error('Statement notice failed:', (err as Error)?.message || err);
    return out;
  }
}
