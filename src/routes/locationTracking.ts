import type { Request, RequestHandler } from 'express';
import express from 'express';
import {
  CONSENT_VERSION, agoText, canBeTracked, canViewTeamLocations, cleanPoints, dayBounds, inTrackingWindow, seenStatus, trackingDay, trailMiles,
  WINDOW_END_HOUR, WINDOW_START_HOUR
} from '../utils/locationTracking.ts';
import { inTeam, teammatesOf } from '../utils/teamScope.ts';
import { homeBranchOf, staffDirectory, type Directory } from '../services/locationTracking.ts';
import * as pointStore from '../db/locationPoints/index.ts';

/**
 * Location tracking for the iOS app (2026-11-19; rules in
 * src/utils/locationTracking.ts).
 *
 *   GET  /api/location-tracking/status    am I tracked, and is the window open now (the app collects only when both)
 *   POST /api/location-tracking/consent   { version } — the person agrees to the wording; saved with the time and device
 *   POST /api/location-tracking/points    { points: [{ id, at, lat, lng, accuracy?, speed? }] } — needs `track_location` and a saved consent (403 code 'consent' without it)
 *   GET  /api/location-tracking/team      the tracked people on my team and where each was last seen today — needs `view_team_locations`
 *   GET  /api/location-tracking/team/:userId?date=YYYY-MM-DD   one person's trail for a branch-clock day — same switch, same team
 *
 * The window is enforced here as well as in the app: a point stamped outside
 * 7 AM–6 PM Monday–Friday on the person's branch clock is dropped, never saved.
 * A person sees only their own team (teamScope.ts, by the rep's branch).
 */
type Store = Pick<typeof pointStore, 'savePoints' | 'lastSeen' | 'trail' | 'recordConsent' | 'consentsFor'>;

export default function createLocationTrackingRouter(
  { authenticate, directory = staffDirectory, store = pointStore, now = () => new Date() }:
  { authenticate: RequestHandler; directory?: Directory; store?: Store; now?: () => Date }
) {
  const router = express.Router();
  const meOf = (req: Request) => ({ id: String(req.userId || ''), permissions: req.user?.permissions, assignedLocations: req.user?.assignedLocations });
  const fail = (res: express.Response, what: string, err: unknown) => {
    console.error(`Location tracking ${what} error:`, err);
    res.status(500).json({ message: 'Something went wrong with location tracking.' });
  };

  router.get('/status', authenticate, async (req, res) => {
    try {
      const staff = await directory.staff();
      const me = staff.find(s => s.id === String(req.userId || ''));
      const branch = me?.branch || homeBranchOf({ assignedLocations: req.user?.assignedLocations });
      const tracked = canBeTracked(req.user);
      const consented = tracked && (await store.consentsFor([String(req.userId || '')], CONSENT_VERSION)).has(String(req.userId || ''));
      res.json({ tracked, consented, consentVersion: CONSENT_VERSION, branch, windowNow: tracked && inTrackingWindow(now(), branch), windowStart: WINDOW_START_HOUR, windowEnd: WINDOW_END_HOUR, canView: canViewTeamLocations(req.user) });
    } catch (err) { fail(res, 'status', err); }
  });

  router.post('/consent', authenticate, async (req, res) => {
    if (!canBeTracked(req.user)) return res.status(403).json({ message: 'Location tracking isn’t turned on for your role.' });
    // Only the current wording can be agreed to: a phone with an old build is told to update.
    if (Number(req.body?.version) !== CONSENT_VERSION) return res.status(409).json({ message: 'The wording has changed. Update the app and try again.', consentVersion: CONSENT_VERSION });
    try {
      const at = await store.recordConsent(String(req.userId), CONSENT_VERSION, String(req.get('user-agent') || ''));
      res.json({ consented: true, at, consentVersion: CONSENT_VERSION });
    } catch (err) { fail(res, 'consent', err); }
  });

  router.post('/points', authenticate, async (req, res) => {
    if (!canBeTracked(req.user)) return res.status(403).json({ message: 'Location tracking isn’t turned on for your role.' });
    try {
      // No record that they agreed to the current wording, no points kept.
      if (!(await store.consentsFor([String(req.userId)], CONSENT_VERSION)).has(String(req.userId))) {
        return res.status(403).json({ message: 'Agree to location sharing in the app first.', code: 'consent' });
      }
      const staff = await directory.staff();
      const me = staff.find(s => s.id === String(req.userId || ''));
      const branch = me?.branch || homeBranchOf({ assignedLocations: req.user?.assignedLocations });
      const { kept, dropped } = cleanPoints(req.body?.points, branch, now());
      const saved = await store.savePoints(String(req.userId), branch, kept);
      res.json({ saved, received: Array.isArray(req.body?.points) ? req.body.points.length : 0, dropped, windowNow: inTrackingWindow(now(), branch) });
    } catch (err) { fail(res, 'save', err); }
  });

  router.get('/team', authenticate, async (req, res) => {
    if (!canViewTeamLocations(req.user)) return res.status(403).json({ message: 'You can’t see your team’s locations.' });
    try {
      const [staff, trackedRoles] = await Promise.all([directory.staff(), directory.trackedRoles()]);
      const team = teammatesOf(meOf(req), staff);
      const people = staff.filter(s => s.active && trackedRoles.has(s.role) && inTeam(team, s.id));
      const at = now();
      // A person's "today" is their own branch's day: yesterday's last spot is not where they are.
      const since = new Date(at.getTime() - 24 * 3600 * 1000);
      const seen = new Map((await store.lastSeen(people.map(p => p.id), since)).map(r => [r.userId, r]));
      const consents = await store.consentsFor(people.map(p => p.id), CONSENT_VERSION);
      res.json({
        people: people.map(p => {
          const row = seen.get(p.id);
          const todayFrom = dayBounds(trackingDay(at, p.branch), p.branch)?.from;
          const last = row && (!todayFrom || row.recordedAt >= todayFrom) ? row : undefined;
          return {
            id: p.id, name: p.name, branch: p.branch, role: p.role,
            lastSeen: last ? { at: last.recordedAt, lat: last.lat, lng: last.lng, accuracyM: last.accuracyM } : null,
            status: seenStatus(last?.recordedAt, at), ago: agoText(last?.recordedAt, at),
            consentedAt: consents.get(p.id) ?? null
          };
        }).sort((a, b) => a.name.localeCompare(b.name)),
        windowNow: true
      });
    } catch (err) { fail(res, 'team', err); }
  });

  router.get('/team/:userId', authenticate, async (req, res) => {
    if (!canViewTeamLocations(req.user)) return res.status(403).json({ message: 'You can’t see your team’s locations.' });
    const userId = String(req.params.userId);
    try {
      const [staff, trackedRoles] = await Promise.all([directory.staff(), directory.trackedRoles()]);
      const person = staff.find(s => s.id === userId);
      // Someone outside the team, or not tracked, is "not found" — never "forbidden", so ids can't be probed.
      if (!person || !trackedRoles.has(person.role) || !inTeam(teammatesOf(meOf(req), staff), userId)) return res.status(404).json({ message: 'Person not found.' });
      const day = typeof req.query.date === 'string' && req.query.date ? req.query.date : trackingDay(now(), person.branch);
      const bounds = dayBounds(day, person.branch);
      if (!bounds) return res.status(400).json({ message: 'Pick a day as YYYY-MM-DD.' });
      const rows = await store.trail(userId, bounds.from, bounds.to);
      res.json({
        person: { id: person.id, name: person.name, branch: person.branch }, day,
        points: rows.map(r => ({ at: r.recordedAt, lat: r.lat, lng: r.lng, accuracyM: r.accuracyM })),
        miles: trailMiles(rows.map(r => ({ lat: r.lat, lng: r.lng, at: r.recordedAt }))),
        first: rows[0]?.recordedAt ?? null, last: rows[rows.length - 1]?.recordedAt ?? null
      });
    } catch (err) { fail(res, 'day', err); }
  });

  return router;
}
