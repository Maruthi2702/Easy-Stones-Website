import type { Request, RequestHandler, Response } from 'express';
import express from 'express';
import * as staffData from '../db/staff/index.ts';
import { readSetting, writeSetting } from '../db/settings/index.ts';
import * as reminderData from '../db/cardReceipts/reminders.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { deliverReminders, phoneSetOf, siteBase, type ReminderSenders } from '../services/receiptReminders.ts';
import { CARD_RECEIPTS } from '../utils/cardReceipts.ts';
import { isAccountingSide } from '../utils/receiptApproval.ts';
import { displayNameOf } from '../utils/salesReps.ts';
import {
  RECEIPTS_PATH, STAFF_FIELDS, cleanRemindBody, groupByRecipient, idOf, nameOfPerson, nobodyReason, pacificDay, previewGroups, remindProblem, reminderHistory, resolveGroups,
  staffIndex, type Person, type ReminderExpense, type ReminderItem, type Sender, type Team
} from '../utils/receiptReminders.ts';

/**
 * Send reminder (2026-11-23; rules in src/utils/receiptReminders.ts), mounted at /api/card-receipts before the
 * main card receipts router.
 *
 *   POST /expenses/remind  { ids: string[] (1–200), to: { holder, managers, accounting, admins, approvers }: booleans,
 *                            email: boolean, push: boolean, message?: string (≤300) }
 *     → { sent: { people, receipts }, skipped: [{ id, merchant, reason }], noPhone: string[], noEmail: string[] }
 *
 * Switch `send_receipt_reminders`. Each reminded receipt is stamped (once per Pacific day) and gets one history line
 * before anything is sent; then each person gets one email and one push for all their receipts, in the background.
 */
type ReqUser = Sender & { id?: string; _id?: string };
const userOf = (req: Request) => ((req as Request & { user?: ReqUser }).user || {}) as ReqUser;
const userIdOf = (req: Request) => String(userOf(req).id || userOf(req)._id || '');

export default function createCardReceiptRemindersRouter({ authenticate, senders = {}, now = () => new Date() }: {
  authenticate: RequestHandler;
  senders?: ReminderSenders;
  now?: () => Date;
}) {
  const router = express.Router();

  // The switch for the hourly Missing-receipt job (src/jobs/missingReceiptReminders.ts). Off until turned on.
  const AUTO_KEY = 'cardReceiptAutoReminders';
  const manages = (req: Request) => (userOf(req).permissions || []).includes(CARD_RECEIPTS.MANAGE_CARDS);
  router.get('/auto-reminders', authenticate, async (req: Request, res: Response) => {
    if (!manages(req)) return res.status(403).json({ message: 'Access denied.' });
    try { res.json({ on: (await readSetting(AUTO_KEY)) === true }); } catch { res.status(500).json({ message: 'Could not read the setting.' }); }
  });
  router.put('/auto-reminders', authenticate, async (req: Request, res: Response) => {
    if (!manages(req)) return res.status(403).json({ message: 'Access denied.' });
    if (typeof req.body?.on !== 'boolean') return res.status(400).json({ message: 'on must be true or false.' });
    try {
      await writeSetting(AUTO_KEY, req.body.on, userIdOf(req));
      console.log(`Automatic receipt reminders turned ${req.body.on ? 'ON' : 'off'} by ${userIdOf(req)}`);
      res.json({ on: req.body.on });
    } catch { res.status(500).json({ message: 'Could not save the setting.' }); }
  });

  router.post('/expenses/remind', authenticate, async (req: Request, res: Response) => {
    const sender = userOf(req);
    if (!(sender.permissions || []).includes(CARD_RECEIPTS.REMIND)) return res.status(403).json({ message: 'Access denied.' });
    const { value: body, problems } = cleanRemindBody(req.body);
    if (!body) return res.status(400).json({ message: 'Some fields need attention.', problems });
    const me = userIdOf(req);
    const senderName = displayNameOf(sender as never);
    try {
      const at = now();
      const today = pacificDay(at);
      // Accounting and Admins remind about anyone; a manager only about their team.
      const team: Team = isAccountingSide(sender.role) ? '*' : await teamOfRequest(req) as Team;
      const [found, staffList] = await Promise.all([
        reminderData.listByIds(body.ids) as Promise<ReminderExpense[]>,
        staffData.findUsers({}, { select: STAFF_FIELDS }) as Promise<Person[]>
      ]);
      const staff = staffIndex(staffList);
      const byId = new Map(found.map((e) => [idOf(e), e]));
      const skipped: { id: string; merchant: string; reason: string }[] = [];
      const channels = { email: body.email, push: body.push };
      // First who each receipt means, then who can actually be reached, so nothing is stamped that goes nowhere.
      const planned: { id: string; e: ReminderExpense; people: string[] }[] = [];
      for (const id of body.ids) {
        const e = byId.get(id);
        if (!e) { skipped.push({ id, merchant: '', reason: 'Not found.' }); continue; }
        const skip = (reason: string) => skipped.push({ id, merchant: String(e.merchant || ''), reason });
        const problem = remindProblem({ ...sender, id: me }, e, team, today);
        if (problem) { skip(problem); continue; }
        const people = resolveGroups(body.to, e, staff, { senderId: me });
        if (!people.length) { skip(nobodyReason(body.to, e, staff, me)); continue; }
        planned.push({ id, e, people });
      }
      const phones = body.push ? await phoneSetOf([...new Set(planned.flatMap((p) => p.people))], senders) : new Set<string>();
      const hasEmail = (pid: string) => !!String(staff.byId.get(pid)?.email ?? '').trim();
      const hasPhone = (pid: string) => phones === null || phones.has(pid); // phones unreadable: nobody is ruled out
      const reach = (pid: string) => (body.email && hasEmail(pid)) || (body.push && hasPhone(pid));
      const items: ReminderItem[] = [];
      const noContact = new Set<string>();
      for (const { id, e, people } of planned) {
        const skip = (reason: string) => skipped.push({ id, merchant: String(e.merchant || ''), reason });
        const reached = people.filter(reach);
        people.filter((pid) => !reach(pid)).forEach((pid) => noContact.add(nameOfPerson(staff.byId.get(pid))));
        if (!reached.length) {
          const what = body.email && body.push ? 'email address or phone with the app' : body.email ? 'email address' : 'phone with the app';
          skip(`${people.map((pid) => nameOfPerson(staff.byId.get(pid))).join(', ')} ${people.length === 1 ? 'has' : 'have'} no ${what}, so nothing could be sent.`);
          continue;
        }
        const names = reached.map((pid) => nameOfPerson(staff.byId.get(pid)));
        const line = reminderHistory({ byName: senderName, names, ...channels, message: body.message });
        const marked = await reminderData.markReminded(id, { lastDay: today, lastAt: at.toISOString(), lastBy: me, lastByName: senderName },
          { at, ...line }, { key: 'lastDay', value: today });
        if (!marked) { skip('A reminder was already sent today.'); continue; }
        items.push({ expense: e, stage: 'manual', email: body.email ? reached.filter(hasEmail) : [], push: body.push ? reached.filter(hasPhone) : [] });
      }
      const batches = groupByRecipient(items);
      const everyone = batches.map((b) => b.userId);
      const base = siteBase(req.get('origin') || '');
      const nameOf = (pid: string) => nameOfPerson(staff.byId.get(pid));
      // Reached one way only: named so the sender knows.
      const noEmail = body.email ? everyone.filter((pid) => !hasEmail(pid)).map(nameOf) : [];
      const noPhone = body.push ? everyone.filter((pid) => !hasPhone(pid)).map(nameOf) : [];
      // Send before answering, so what we say happened did: a receipt nobody got a message about is not "reminded".
      const delivery = await deliverReminders(batches, staff, { senderName, message: body.message, link: base ? `${base}${RECEIPTS_PATH}` : '', senders })
        .catch((err) => { console.error('Receipt reminders failed:', (err as Error)?.message || err); return { emails: 0, pushes: 0, failed: everyone }; });
      const failed = new Set(delivery.failed);
      let done = 0;
      for (const item of items) {
        const targets = [...new Set([...item.email, ...item.push])];
        if (!targets.some((t) => !failed.has(t))) {
          // Nothing got through: free the day again and leave a line saying so.
          await reminderData.markReminded(idOf(item.expense), { lastDay: '' },
            { at: now(), by: senderName, action: 'reminder not delivered', changes: 'Could not be sent — try again' }).catch(() => false);
          skipped.push({ id: idOf(item.expense), merchant: String(item.expense.merchant || ''), reason: 'The email and phone message could not be sent. Try again.' });
        } else done++;
      }
      const people = batches.filter((b) => !failed.has(b.userId)).length;
      res.json({ sent: { people: done ? people : 0, receipts: done }, skipped, noPhone, noEmail, noContact: [...noContact] });
    } catch (error) {
      console.error('[card-receipts] remind failed:', error);
      res.status(500).json({ message: 'Could not send the reminders.' });
    }
  });

  /** Who each group means for these receipts (names, never the sender), so the form says who it will reach. */
  router.post('/expenses/remind/preview', authenticate, async (req: Request, res: Response) => {
    const sender = userOf(req);
    if (!(sender.permissions || []).includes(CARD_RECEIPTS.REMIND)) return res.status(403).json({ message: 'Access denied.' });
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(String).slice(0, 200) : [];
    if (!ids.length) return res.status(400).json({ message: 'Pick at least one receipt.' });
    try {
      const [found, staffList] = await Promise.all([
        reminderData.listByIds(ids) as Promise<ReminderExpense[]>,
        staffData.findUsers({}, { select: STAFF_FIELDS }) as Promise<Person[]>
      ]);
      // Only what the real send would act on, so the names and the count match what happens.
      const me = userIdOf(req);
      const today = pacificDay(now());
      const team: Team = isAccountingSide(sender.role) ? '*' : await teamOfRequest(req) as Team;
      const byId = new Map(found.map((e) => [idOf(e), e]));
      const ok: ReminderExpense[] = [];
      const skipped: { id: string; merchant: string; reason: string }[] = [];
      for (const id of ids) {
        const e = byId.get(id);
        if (!e) { skipped.push({ id, merchant: '', reason: 'Not found.' }); continue; }
        const problem = remindProblem({ ...sender, id: me }, e, team, today);
        if (problem) skipped.push({ id, merchant: String(e.merchant || ''), reason: problem });
        else ok.push(e);
      }
      const staff = staffIndex(staffList);
      const groups = previewGroups(ok, staff, me);
      // Who can be reached by email / phone, so the button's count is who would really get it.
      const everyone = [...new Set(Object.values(groups).flatMap((g) => g.ids))];
      const phones = await phoneSetOf(everyone, senders);
      const contact = Object.fromEntries(everyone.map((pid) => [pid, { email: !!String(staff.byId.get(pid)?.email ?? '').trim(), phone: phones === null || phones.has(pid) }]));
      res.json({ groups, contact, skipped });
    } catch (error) {
      console.error('[card-receipts] remind preview failed:', error);
      res.status(500).json({ message: 'Could not work out who would be reminded.' });
    }
  });

  return router;
}
