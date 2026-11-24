/**
 * Sends card receipt reminders: one email and one push per person (words: src/utils/receiptReminders.ts).
 * Email only through `sendEmail` (SES, then Gmail), push only through `sendPushToUsers` (iPhone / Android).
 * Each person is sent to on their own and nothing throws: a reminder is never part of a save.
 */
import { sendEmail as realSendEmail } from './emailService.ts';
import { sendPushToUsers } from './apns.ts';
import { devicesFor } from '../db/pushDevices/index.ts';
import { SENDER_NAME } from '../utils/emailSender.ts';
import {
  RECEIPTS_PATH, nameOfPerson, reminderEmailWords, reminderPushWords, type Person, type RecipientBatch, type StaffIndex
} from '../utils/receiptReminders.ts';

export type ReminderSenders = {
  sendEmail?: (o: { to: string; subject: string; html: string; defaultSenderName?: string; replyTo?: string }) => Promise<{ success: boolean; error?: string | null }>;
  sendPush?: (userIds: string[], m: { title: string; body: string; path: string }) => Promise<unknown>;
  /** Of these people, who has a phone registered for push. */
  phonesOf?: (userIds: string[]) => Promise<string[]>;
};

const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as '&']));

/** The site's address for the email's button (the caller's own origin when there is one). */
export const siteBase = (origin = '') => (origin || process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

/** Of these people, who has a phone registered for push; null when that couldn't be read (nobody is then ruled out). */
export async function phoneSetOf(ids: readonly string[], senders: ReminderSenders = {}): Promise<Set<string> | null> {
  if (!ids.length) return new Set();
  try {
    return new Set(await (senders.phonesOf ?? defaultPhonesOf)([...ids]));
  } catch (err) {
    console.error('Receipt reminders: could not read phones:', (err as Error)?.message || err);
    return null;
  }
}

const defaultPhonesOf = async (ids: string[]) => [...new Set((await devicesFor(ids)).map((d) => String(d.userId)))];

export function reminderEmailHtml(words: ReturnType<typeof reminderEmailWords>, link: string) {
  // Tables and outright colours, so a forward keeps its look (see the Selection Sheet email).
  const row = (r: { title: string; sub: string; amount: string }, first: boolean) => `
        <tr>
          <td style="padding:14px 16px;${first ? '' : 'border-top:1px solid #e2e8f0;'}font-family:Inter,Arial,sans-serif;color:#0f172a">
            <div style="font-size:15px;font-weight:600;color:#0f172a">${escapeHtml(r.title)}</div>
            <div style="font-size:13px;color:#64748b;padding-top:3px">${escapeHtml(r.sub)}</div>
          </td>
          <td align="right" valign="top" style="padding:14px 16px;${first ? '' : 'border-top:1px solid #e2e8f0;'}font-family:Inter,Arial,sans-serif;font-size:15px;font-weight:700;color:#0f172a;white-space:nowrap">${escapeHtml(r.amount)}</td>
        </tr>`;
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr>
        <td width="30" height="30" align="center" valign="middle" bgcolor="#c9a227" style="width:30px;height:30px;border-radius:8px;font-weight:700;font-size:15px;color:#1f1a08">E</td>
        <td style="padding-left:10px;font-size:12px;font-weight:700;letter-spacing:1px;color:#334155">EASY SURFACES</td>
      </tr></table>
      <h2 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:#0f172a">${escapeHtml(words.headline)}</h2>
      <p style="margin:0 0 16px;line-height:1.55;color:#334155">${escapeHtml(words.intro)}</p>
      ${words.message ? `<p style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #c9a227;background:#faf7ea;line-height:1.5;color:#1f2937">“${escapeHtml(words.message)}”</p>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate">
        ${words.rows.map((r, i) => row(r, i === 0)).join('')}
        ${words.total ? `<tr>
          <td style="padding:12px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;font-family:Inter,Arial,sans-serif;font-size:13px;color:#475569">${words.rows.length} receipts</td>
          <td align="right" style="padding:12px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;font-family:Inter,Arial,sans-serif;font-size:13px;font-weight:700;color:#0f172a">${escapeHtml(words.total)}</td>
        </tr>` : ''}
      </table>
      ${link ? `<p style="margin:0 0 22px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#c9a227;color:#1f1a08;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:10px">${escapeHtml(words.button)}</a></p>` : ''}
      <p style="margin:0;font-size:13px;color:#5a6574;line-height:1.5;border-top:1px solid #e2e8f0;padding-top:14px">Sales → Credit Card Receipts</p>
    </div>`;
}

/** Who of these people can't be reached: no email address, no phone with the app (names). */
export async function unreachable(ids: { email: readonly string[]; push: readonly string[] }, staff: StaffIndex, senders: ReminderSenders = {}) {
  const person = (id: string) => staff.byId.get(id) as Person | undefined;
  const noEmail = ids.email.filter((id) => !String(person(id)?.email ?? '').trim()).map((id) => nameOfPerson(person(id)));
  let noPhone: string[] = [];
  if (ids.push.length) {
    try {
      const withPhone = new Set(await (senders.phonesOf ?? defaultPhonesOf)([...ids.push]));
      noPhone = ids.push.filter((id) => !withPhone.has(id)).map((id) => nameOfPerson(person(id)));
    } catch (err) {
      console.error('Receipt reminders: could not read phones:', (err as Error)?.message || err);
    }
  }
  return { noEmail, noPhone };
}

/**
 * Sends each person their email and push. Every person is independent (one failing never stops the rest);
 * resolves to how many emails and pushes were handed over.
 */
export async function deliverReminders(batches: readonly RecipientBatch[], staff: StaffIndex, {
  senderName = '', message = '', link = '', senders = {}
}: { senderName?: string; message?: string; link?: string; senders?: ReminderSenders } = {}) {
  const sendEmail = senders.sendEmail ?? realSendEmail;
  const sendPush = senders.sendPush ?? sendPushToUsers;
  const url = link || (siteBase() ? `${siteBase()}${RECEIPTS_PATH}` : '');
  let emails = 0, pushes = 0;
  /** People something was tried for and nothing got through to. */
  const failed: string[] = [];
  await Promise.all(batches.map(async (b) => {
    let tried = false, delivered = false;
    const p = staff.byId.get(b.userId);
    const to = String(p?.email ?? '').trim();
    if (b.email.length && to) {
      tried = true;
      try {
        const words = reminderEmailWords({ readerId: b.userId, items: b.email, senderName, message });
        const r = await sendEmail({ to, subject: words.subject, html: reminderEmailHtml(words, url), defaultSenderName: SENDER_NAME });
        if (r?.success === false) console.error(`⚠️ Receipt reminder email to ${to} failed: ${r.error ?? ''}`);
        else { emails++; delivered = true; }
      } catch (err) {
        console.error(`⚠️ Receipt reminder email to ${to} threw:`, (err as Error)?.message || err);
      }
    }
    if (b.push.length) {
      tried = true;
      try {
        await sendPush([b.userId], reminderPushWords({ readerId: b.userId, items: b.push, senderName }));
        pushes++;
        delivered = true;
      } catch (err) {
        console.error('⚠️ Receipt reminder push threw:', (err as Error)?.message || err);
      }
    }
    if (tried && !delivered) failed.push(b.userId);
  }));
  return { emails, pushes, failed };
}
