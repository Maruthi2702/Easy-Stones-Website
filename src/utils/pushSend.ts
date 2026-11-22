/**
 * "Send notification" (2026-11-21, owner's ask): an admin sends a short message to the iPhones of
 * chosen people. Rules shared by the server (src/routes/pushSend.ts) and the screen
 * (src/features/notifications/). Pure: no database, no DOM. Tested in pushSend.test.ts.
 *
 *   Who sends    a role with `send_notifications` (Users & Roles → Notifications). Nobody holds it
 *                until an admin ticks it.
 *   To whom      people on the sender's team (teamScope.ts; All-location logins reach everyone),
 *                ids outside the team are dropped by the server, so ids can't be probed.
 *   The message  1–120 characters, one line of text under the fixed title "Easy Surfaces".
 *   Who receives only a person with the iOS app installed, signed in and notifications allowed
 *                (a registered phone). The screen shows who has none.
 */
export const SEND_NOTIFICATIONS = 'send_notifications';
export const NOTIFICATION_TITLE = 'Easy Surfaces';
export const MESSAGE_MAX = 120;
/** Most people one send may name. */
export const MAX_RECIPIENTS = 200;

export const canSendNotifications = (user: { permissions?: string[] } | null | undefined) =>
  Boolean(user?.permissions?.includes(SEND_NOTIFICATIONS));

/** The message with its whitespace collapsed, or a problem in words for the sender. */
export function cleanMessage(raw: unknown): { message: string; problem: string } {
  const message = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!message) return { message, problem: 'Write the message first.' };
  if (message.length > MESSAGE_MAX) return { message, problem: `Keep the message under ${MESSAGE_MAX} characters.` };
  return { message, problem: '' };
}

/** The ids to send to: strings only, no repeats, no blanks, in the order given. */
export function cleanRecipients(raw: unknown): { ids: string[]; problem: string } {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(v => String(v ?? '').trim()).filter(Boolean))];
  if (!ids.length) return { ids, problem: 'Pick at least one person.' };
  if (ids.length > MAX_RECIPIENTS) return { ids, problem: `Pick at most ${MAX_RECIPIENTS} people at a time.` };
  return { ids, problem: '' };
}

/** What the sender is told once it's sent. */
export function sentLine(asked: number, reached: number, noPhone: number): string {
  const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
  if (reached === 0) return asked === 1 ? 'Not sent: that person has no phone set up for notifications.' : 'Not sent: none of them has a phone set up for notifications.';
  return `Sent to ${people(reached)}${noPhone ? `. ${people(noPhone)} ${noPhone === 1 ? 'has' : 'have'} no phone set up, so ${noPhone === 1 ? 'it' : 'they'} didn’t get it` : ''}.`;
}
