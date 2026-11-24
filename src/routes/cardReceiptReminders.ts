import type { Request, RequestHandler, Response } from 'express';
import express from 'express';
import * as staffData from '../db/staff/index.ts';
import * as reminderData from '../db/cardReceipts/reminders.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { deliverReminders, siteBase, unreachable, type ReminderSenders } from '../services/receiptReminders.ts';
import { CARD_RECEIPTS } from '../utils/cardReceipts.ts';
import { isAccountingSide } from '../utils/receiptApproval.ts';
import { displayNameOf } from '../utils/salesReps.ts';
import {
  RECEIPTS_PATH, STAFF_FIELDS, cleanRemindBody, groupByRecipient, idOf, nameOfPerson, pacificDay, remindProblem, reminderHistory, resolveGroups,
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
      const items: ReminderItem[] = [];
      const channels = { email: body.email, push: body.push };
      for (const id of body.ids) {
        const e = byId.get(id);
        if (!e) { skipped.push({ id, merchant: '', reason: 'Not found.' }); continue; }
        const skip = (reason: string) => skipped.push({ id, merchant: String(e.merchant || ''), reason });
        const problem = remindProblem({ ...sender, id: me }, e, team, today);
        if (problem) { skip(problem); continue; }
        const people = resolveGroups(body.to, e, staff, { senderId: me });
        if (!people.length) { skip('Nobody to remind.'); continue; }
        const names = people.map((p) => nameOfPerson(staff.byId.get(p)));
        const line = reminderHistory({ byName: senderName, names, ...channels, message: body.message });
        const marked = await reminderData.markReminded(id, { lastDay: today, lastAt: at.toISOString(), lastBy: me, lastByName: senderName },
          { at, ...line }, { key: 'lastDay', value: today });
        if (!marked) { skip('A reminder was already sent today.'); continue; }
        items.push({ expense: e, stage: 'manual', email: body.email ? people : [], push: body.push ? people : [] });
      }
      const batches = groupByRecipient(items);
      const everyone = batches.map((b) => b.userId);
      const { noEmail, noPhone } = await unreachable({ email: body.email ? everyone : [], push: body.push ? everyone : [] }, staff, senders);
      const base = siteBase(req.get('origin') || '');
      void deliverReminders(batches, staff, { senderName, message: body.message, link: base ? `${base}${RECEIPTS_PATH}` : '', senders })
        .catch((err) => console.error('Receipt reminders failed:', (err as Error)?.message || err));
      res.json({ sent: { people: batches.length, receipts: items.length }, skipped, noPhone, noEmail });
    } catch (error) {
      console.error('[card-receipts] remind failed:', error);
      res.status(500).json({ message: 'Could not send the reminders.' });
    }
  });

  return router;
}
