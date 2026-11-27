import type { Loose } from '../types/records.ts';
import * as staffData from '../db/staff/index.ts';
import { sendPushToUsers } from './apns.ts';
import { sendEmail } from './emailService.ts';
import { SENDER_NAME } from '../utils/emailSender.ts';
import { receiptAskedMessage, receiptAnsweredMessage, receiptPhrase, type Message } from '../utils/pushEvents.ts';

/**
 * Credit Card Receipts → Ask (src/utils/receiptApproval.ts): the person asked gets a push and an email with
 * the question; when they answer, whoever asked gets a push and an email with the answer. Fire-and-forget:
 * nothing here throws into the route, and a save never waits on Apple or the mail server. The senders are
 * passed in for tests.
 */
export type AskNotifyDeps = {
  push?: (userIds: string[], m: Message) => Promise<unknown>;
  email?: (options: { to: string; subject: string; html: string; defaultSenderName?: string }) => Promise<unknown>;
  findPerson?: (id: string) => Promise<Loose | null>;
  /** The site's address for the link in the email ('' = no link). */
  base?: string;
};

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]!));

const personOf = (id: string) => staffData.userById(id, { select: 'email displayName username isActive' });

function emailHtml(heading: string, lead: string, quote: string, link: string) {
  return `
    <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eaeaea; border-radius: 12px; background: #fafafa;">
      <h2 style="color: #b8902a; margin-top: 0;">${escapeHtml(heading)}</h2>
      <p style="color: #222;">${escapeHtml(lead)}</p>
      <blockquote style="margin: 12px 0; padding: 10px 14px; border-left: 3px solid #d4af37; background: #fff; color: #222;">${escapeHtml(quote)}</blockquote>
      ${link ? `<p><a href="${escapeHtml(link)}" style="color: #b8902a;">Open Credit Card Receipts</a></p>` : '<p style="color: #555;">Open Credit Card Receipts in the app to reply.</p>'}
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
      <p style="font-size: 0.85rem; color: #888; margin: 0;">An automated message from ${escapeHtml(SENDER_NAME)}.</p>
    </div>`;
}

async function tell(label: string, toId: string, message: Message, subject: string, html: string, deps: AskNotifyDeps) {
  const push = deps.push ?? sendPushToUsers;
  const email = deps.email ?? sendEmail;
  const find = deps.findPerson ?? personOf;
  await Promise.all([
    push([toId], message).catch((e) => console.error(`Push (${label}):`, (e as Error)?.message || e)),
    (async () => {
      const person = await find(toId);
      const to = String(person?.email || '').trim();
      if (!to || person?.isActive === false) return;
      await email({ to, subject, html, defaultSenderName: SENDER_NAME });
    })().catch((e) => console.error(`Email (${label}):`, (e as Error)?.message || e))
  ]);
}

const linkOf = (base = '') => (base ? `${base.replace(/\/+$/, '')}/sales?tab=card_receipts` : '');

/** Accounting asked `ask.to` about this receipt. Returns the work (tests await it; the route doesn't). */
export function notifyAsked(expense: Loose, ask: Loose, deps: AskNotifyDeps = {}): Promise<void> {
  const message = receiptAskedMessage(expense, ask);
  const subject = `Question about ${receiptPhrase(expense)}`;
  const html = emailHtml('A question about a receipt', `${ask.byName || 'Accounting'} asked about ${receiptPhrase(expense)}. Answering approves it; or return it to Accounting without approving.`, String(ask.question ?? ''), linkOf(deps.base));
  return tell('receipt asked', String(ask.to), message, subject, html, deps).catch(() => undefined);
}

/** `ask.to` answered: whoever asked is told. */
export function notifyAnswered(expense: Loose, ask: Loose, deps: AskNotifyDeps = {}): Promise<void> {
  const message = receiptAnsweredMessage(expense, ask);
  const declined = ask.declined === true;
  const subject = `${declined ? 'Returned, not approved' : 'Answered'}: ${receiptPhrase(expense)}`;
  const html = declined
    ? emailHtml('A receipt came back to you', `${ask.toName || 'They'} did not approve ${receiptPhrase(expense)}. It is waiting for you again. Your question: “${String(ask.question ?? '')}”`, String(ask.answer ?? ''), linkOf(deps.base))
    : emailHtml('Your question was answered', `${ask.toName || 'They'} answered your question about ${receiptPhrase(expense)}: “${String(ask.question ?? '')}”`, String(ask.answer ?? ''), linkOf(deps.base));
  return tell('receipt answered', String(ask.by), message, subject, html, deps).catch(() => undefined);
}
