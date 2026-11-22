import type { Request, RequestHandler } from 'express';
import express from 'express';
import { NOTIFICATION_TITLE, canSendNotifications, cleanMessage, cleanRecipients, sentLine } from '../utils/pushSend.ts';
import { inTeam, teammatesOf } from '../utils/teamScope.ts';
import { staffDirectory, type Directory } from '../services/locationTracking.ts';
import * as deviceStore from '../db/pushDevices/index.ts';
import { pushConfigured, sendPushToUsers, type PushMessage, type SendSummary } from '../services/apns.ts';

/**
 * "Send notification" (2026-11-21; rules in src/utils/pushSend.ts). An admin sends a short message
 * to the iPhones of people on their team.
 *
 *   GET  /api/push-send/people   the people the caller may send to, each with how many phones are set up
 *   POST /api/push-send          { userIds, message } — sends; answers who was reached and who has no phone
 *
 * Both need `send_notifications`. A person outside the caller's team is dropped, so ids can't be probed.
 * Every send is logged on the server (who, how many, the message) — there is no table for it yet.
 */
type Devices = Pick<typeof deviceStore, 'devicesFor'>;
type Send = (userIds: string[], m: PushMessage) => Promise<SendSummary>;

export default function createPushSendRouter(
  { authenticate, directory = staffDirectory, devices = deviceStore, send = sendPushToUsers, configured = pushConfigured }:
  { authenticate: RequestHandler; directory?: Directory; devices?: Devices; send?: Send; configured?: () => boolean }
) {
  const router = express.Router();
  const meOf = (req: Request) => ({ id: String(req.userId || ''), permissions: req.user?.permissions, assignedLocations: req.user?.assignedLocations });
  const fail = (res: express.Response, what: string, err: unknown) => {
    console.error(`Send notification ${what} error:`, err);
    res.status(500).json({ message: 'Something went wrong sending the notification.' });
  };
  const allowed = (req: Request) => canSendNotifications(req.user);

  router.get('/people', authenticate, async (req, res) => {
    if (!allowed(req)) return res.status(403).json({ message: 'You can’t send notifications.' });
    try {
      const staff = await directory.staff();
      const team = teammatesOf(meOf(req), staff);
      const people = staff.filter(s => s.active && inTeam(team, s.id));
      const phones = await devices.devicesFor(people.map(p => p.id));
      const count = new Map<string, number>();
      for (const d of phones) count.set(d.userId, (count.get(d.userId) || 0) + 1);
      res.json({
        configured: configured(),
        people: people.map(p => ({ id: p.id, name: p.name, role: p.role, branch: p.branch, phones: count.get(p.id) || 0 }))
      });
    } catch (err) { fail(res, 'people', err); }
  });

  router.post('/', authenticate, async (req, res) => {
    if (!allowed(req)) return res.status(403).json({ message: 'You can’t send notifications.' });
    const { message, problem: messageProblem } = cleanMessage(req.body?.message);
    if (messageProblem) return res.status(400).json({ message: messageProblem, code: 'message' });
    const { ids, problem: idsProblem } = cleanRecipients(req.body?.userIds);
    if (idsProblem) return res.status(400).json({ message: idsProblem, code: 'people' });
    if (!configured()) return res.status(503).json({ message: 'Push notifications are not set up on the server yet.', configured: false });
    try {
      const staff = await directory.staff();
      const team = teammatesOf(meOf(req), staff);
      const allowedIds = new Set(staff.filter(s => s.active && inTeam(team, s.id)).map(s => s.id));
      const targets = ids.filter(id => allowedIds.has(id));
      if (!targets.length) return res.status(404).json({ message: 'Those people weren’t found.' });
      const withPhone = new Set((await devices.devicesFor(targets)).map(d => d.userId));
      const reachable = targets.filter(id => withPhone.has(id));
      const noPhone = targets.filter(id => !withPhone.has(id));
      const result = reachable.length ? await send(reachable, { title: NOTIFICATION_TITLE, body: message, path: '/sales' }) : null;
      console.log(`Notification from ${meOf(req).id} to ${targets.length} people (${reachable.length} with a phone, ${result?.sent ?? 0} phones sent): ${message}`);
      const reached = result && result.sent > 0 ? reachable.length : 0;
      res.json({
        asked: targets.length, reached, noPhone: noPhone.map(id => staff.find(s => s.id === id)?.name || ''),
        failed: result?.failed ?? 0, reasons: result?.reasons,
        line: sentLine(targets.length, reached, noPhone.length)
      });
    } catch (err) { fail(res, 'send', err); }
  });

  return router;
}
