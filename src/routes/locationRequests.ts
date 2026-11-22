import type { Request, RequestHandler } from 'express';
import express from 'express';
import { CONSENT_VERSION, canBeTracked } from '../utils/locationTracking.ts';
import {
  askedNotice, canLocateOnRequest, cleanAnswer, cleanReason, requestStatus
} from '../utils/locationRequests.ts';
import { inTeam, teammatesOf } from '../utils/teamScope.ts';
import { staffDirectory, type Directory } from '../services/locationTracking.ts';
import * as pointStore from '../db/locationPoints/index.ts';
import * as requestStore from '../db/locationPoints/requests.ts';
import * as liveStore from '../db/locationPoints/live.ts';
import { sendPushToUsers, type PushMessage } from '../services/apns.ts';

/**
 * "Locate now" (2026-11-20; rules in src/utils/locationRequests.ts). Outside 7 AM – 6 PM the
 * phone reports nothing on its own; an admin may ask ONE person's phone for ONE position, with a
 * reason, and every ask is kept.
 *
 *   POST /api/location-tracking/locate            { userId, reason } — needs `locate_on_request`; the person must be tracked, on the asker's team and have agreed to the current wording
 *   GET  /api/location-tracking/locate?userId=    that person's log of asks, newest first — same switch and team
 *   GET  /api/location-tracking/locate/pending    the phone: asks still open for ME (who asked, when — never the reason)
 *   POST /api/location-tracking/locate/:id/answer { lat, lng, accuracy? } — the phone answers its own open ask once
 *   GET  /api/location-tracking/locate/:id        one ask and its answer — same switch and team
 *
 * The answer is kept with the ask (location_requests), never in location_points, so the rule that
 * ordinary points are dropped outside the window is untouched. The person is told by a push when asked.
 */
type Requests = Pick<typeof requestStore, 'createRequest' | 'requestById' | 'openFor' | 'answerRequest' | 'log'>;
type Consents = Pick<typeof pointStore, 'consentsFor'>;
type Audit = Pick<typeof liveStore, 'logView'>;
type Notify = (userIds: string[], message: PushMessage) => Promise<{ sent: number }>;

export default function createLocationRequestsRouter(
  { authenticate, directory = staffDirectory, requests = requestStore, consents = pointStore, audit = liveStore, notify = sendPushToUsers, now = () => new Date() }:
  { authenticate: RequestHandler; directory?: Directory; requests?: Requests; consents?: Consents; audit?: Audit; notify?: Notify; now?: () => Date }
) {
  const router = express.Router();
  const meOf = (req: Request) => ({ id: String(req.userId || ''), permissions: req.user?.permissions, assignedLocations: req.user?.assignedLocations });
  const fail = (res: express.Response, what: string, err: unknown) => {
    console.error(`Locate request ${what} error:`, err);
    res.status(500).json({ message: 'Something went wrong with the location request.' });
  };
  const view = (r: requestStore.RequestRecord) => ({
    id: r.id, userId: r.targetUserId, status: requestStatus(r, now()), requestedAt: r.requestedAt, requestedByName: r.requestedByName,
    reason: r.reason, answeredAt: r.answeredAt, lat: r.lat, lng: r.lng, accuracyM: r.accuracyM
  });
  /** The tracked person an asker may ask about: on their team, or null (a 404, so ids can't be probed). */
  const targetFor = async (req: Request, userId: string) => {
    const [staff, trackedRoles] = await Promise.all([directory.staff(), directory.trackedRoles()]);
    const person = staff.find(s => s.id === userId);
    if (!person || !trackedRoles.has(person.role) || !inTeam(teammatesOf(meOf(req), staff), userId)) return null;
    return person;
  };

  router.post('/locate', authenticate, async (req, res) => {
    if (!canLocateOnRequest(req.user)) return res.status(403).json({ message: 'You can’t request a location.' });
    const userId = String(req.body?.userId || '');
    const { reason, problem } = cleanReason(req.body?.reason);
    if (problem) return res.status(400).json({ message: problem, code: 'reason' });
    try {
      const person = await targetFor(req, userId);
      if (!person) return res.status(404).json({ message: 'Person not found.' });
      if (person.id === String(req.userId)) return res.status(400).json({ message: 'You can’t request your own location.' });
      if (!(await consents.consentsFor([person.id], CONSENT_VERSION)).has(person.id)) {
        return res.status(409).json({ message: `${person.name} hasn’t agreed to the current location wording yet, so their phone can’t be asked.`, code: 'consent' });
      }
      const at = now();
      const open = (await requests.openFor(person.id, at))[0];
      if (open) return res.status(409).json({ message: `${person.name}’s phone was already asked and hasn’t answered yet.`, code: 'open', request: view(open) });
      const staff = await directory.staff();
      const asker = staff.find(s => s.id === String(req.userId));
      const record = await requests.createRequest({ targetUserId: person.id, requestedBy: String(req.userId), requestedByName: asker?.name || '', reason, consentVersion: CONSENT_VERSION, now: at });
      // Also a line in the access log (admins read one log of every look and every ask); the ask itself is already kept with its reason.
      await audit.logView({ viewerId: String(req.userId), viewerName: asker?.name || '', subjectId: person.id, subjectName: person.name, kind: 'locate' }, at)
        .catch(err => console.error('Location access log error:', err));
      const pushed = (await notify([person.id], askedNotice(asker?.name || '')).catch(() => ({ sent: 0 }))).sent > 0;
      res.status(201).json({ request: view(record), pushed });
    } catch (err) { fail(res, 'create', err); }
  });

  // Before '/locate/:id' so "pending" isn't read as an id.
  router.get('/locate/pending', authenticate, async (req, res) => {
    if (!canBeTracked(req.user)) return res.json({ requests: [] });
    try {
      const me = String(req.userId || '');
      if (!(await consents.consentsFor([me], CONSENT_VERSION)).has(me)) return res.json({ requests: [] });
      const open = await requests.openFor(me, now());
      res.json({ requests: open.map(r => ({ id: r.id, requestedAt: r.requestedAt, requestedByName: r.requestedByName })) });
    } catch (err) { fail(res, 'pending', err); }
  });

  router.post('/locate/:id/answer', authenticate, async (req, res) => {
    if (!canBeTracked(req.user)) return res.status(403).json({ message: 'Location isn’t turned on for your role.' });
    const position = cleanAnswer(req.body);
    if (!position) return res.status(400).json({ message: 'That isn’t a usable position.' });
    try {
      const me = String(req.userId || '');
      if (!(await consents.consentsFor([me], CONSENT_VERSION)).has(me)) return res.status(403).json({ message: 'Agree to location sharing in the app first.', code: 'consent' });
      const done = await requests.answerRequest(String(req.params.id), me, position, now());
      if (!done) return res.status(404).json({ message: 'That request is no longer open.' });
      res.json({ answered: true });
    } catch (err) { fail(res, 'answer', err); }
  });

  router.get('/locate/:id', authenticate, async (req, res) => {
    if (!canLocateOnRequest(req.user)) return res.status(403).json({ message: 'You can’t request a location.' });
    try {
      const record = await requests.requestById(String(req.params.id));
      if (!record || !(await targetFor(req, record.targetUserId))) return res.status(404).json({ message: 'Request not found.' });
      res.json({ request: view(record) });
    } catch (err) { fail(res, 'read', err); }
  });

  router.get('/locate', authenticate, async (req, res) => {
    if (!canLocateOnRequest(req.user)) return res.status(403).json({ message: 'You can’t request a location.' });
    try {
      const person = await targetFor(req, String(req.query.userId || ''));
      if (!person) return res.status(404).json({ message: 'Person not found.' });
      res.json({ requests: (await requests.log(person.id)).map(view) });
    } catch (err) { fail(res, 'log', err); }
  });

  return router;
}
