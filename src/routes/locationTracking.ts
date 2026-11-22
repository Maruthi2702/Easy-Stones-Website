import type { Request, RequestHandler } from 'express';
import express from 'express';
import {
  CONSENT_VERSION, LIVE_LOG_EVERY_MS, NO_FACTS, canViewLocationAudit, agoText, dayOffReason, inTrackingHours, isWeekdayAt, trackingDayOn, type DayFacts, canBeTracked, canViewTeamLocations, cleanPoints, dayBounds, inTrackingWindow, seenStatus, trackingDay, trailMiles,
  WINDOW_END_HOUR, WINDOW_START_HOUR
} from '../utils/locationTracking.ts';
import { inTeam, teammatesOf } from '../utils/teamScope.ts';
import { parseHeartbeat, quietReason } from '../utils/locationHealth.ts';
import { trailSegments } from '../utils/locationTrail.ts';
import { branchZone } from '../config/branches.ts';
import { homeBranchOf, staffDirectory, type Directory } from '../services/locationTracking.ts';
import * as pointStore from '../db/locationPoints/index.ts';
import * as liveStore from '../db/locationPoints/live.ts';
import { dayFactsFor, dayFactsForPeople } from '../db/locationPoints/workDays.ts';

/**
 * Location tracking for the iOS app (2026-11-19; rules in
 * src/utils/locationTracking.ts).
 *
 *   GET  /api/location-tracking/status    am I tracked, and is the window open now (the app collects only when both)
 *   POST /api/location-tracking/consent   { version } — the person agrees to the wording; saved with the time and device
 *   POST /api/location-tracking/points    { points: [{ id, at, lat, lng, accuracy?, speed? }] } — needs `track_location` and a saved consent (403 code 'consent' without it)
 *   POST /api/location-tracking/heartbeat { permission, lowPower, batteryPct, charging, appVersion, queued, at } — what the phone says about itself (no position); needs `track_location`
 *   GET  /api/location-tracking/team      the tracked people on my team, where each was last seen, and WHY a quiet one is quiet — needs `view_team_locations`. The screen polls it every 15 s: it reads `location_latest`, one row per person.
 *   GET  /api/location-tracking/team/:userId?date=YYYY-MM-DD   one person's trail for a branch-clock day (cut into segments at gaps) — same switch, same team
 *   GET  /api/location-tracking/access-log?subjectId=&viewerId=&from=&to=   who looked at whose location — needs `view_location_audit` (404 without it). Written here, by the server, never by a client.
 *
 * The window is enforced here as well as in the app: a point stamped outside
 * 7 AM–6 PM on a day tracking is on for that person (Monday–Friday, plus weekend days with scheduled work, minus Personal Time Off), on their branch clock, is dropped, never saved.
 * A person sees only their own team (teamScope.ts, by the rep's branch).
 */
type Store = Pick<typeof pointStore, 'savePoints' | 'trail' | 'recordConsent' | 'consentsFor'>
  & Pick<typeof liveStore, 'latestFor' | 'saveHealth' | 'healthFor' | 'logView' | 'logViews' | 'viewLogFor'>;

/** What a person's records say about some days (time off, scheduled work); the route asks for today and yesterday on the branch's clock. */
type Facts = (person: { id: string; username: string }, days: string[]) => Promise<Map<string, DayFacts>>;
/** Many people at once, each for their own day (the team list). */
type FactsMany = (people: { id: string; username: string; day: string }[]) => Promise<Map<string, DayFacts>>;

export default function createLocationTrackingRouter(
  { authenticate, directory = staffDirectory, store = { ...pointStore, ...liveStore }, facts = dayFactsFor, factsMany = dayFactsForPeople, now = () => new Date() }:
  { authenticate: RequestHandler; directory?: Directory; store?: Store; facts?: Facts; factsMany?: FactsMany; now?: () => Date }
) {
  const router = express.Router();
  const meOf = (req: Request) => ({ id: String(req.userId || ''), permissions: req.user?.permissions, assignedLocations: req.user?.assignedLocations });
  const fail = (res: express.Response, what: string, err: unknown) => {
    console.error(`Location tracking ${what} error:`, err);
    res.status(500).json({ message: 'Something went wrong with location tracking.' });
  };

  /** The last three days' facts for a person, by branch-clock day (a batch holds at most 48 hours of points). */
  const factsFor = async (person: { id: string; username: string }, branch: string) => {
    const at = now();
    const today = trackingDay(at, branch);
    const days = [trackingDay(new Date(at.getTime() - 48 * 3600 * 1000), branch), trackingDay(new Date(at.getTime() - 24 * 3600 * 1000), branch), today];
    const byDay = await facts(person, days);
    return { today, byDay, of: (day: string): DayFacts => byDay.get(day) ?? NO_FACTS };
  };

  router.get('/status', authenticate, async (req, res) => {
    try {
      const staff = await directory.staff();
      const me = staff.find(s => s.id === String(req.userId || ''));
      const branch = me?.branch || homeBranchOf({ assignedLocations: req.user?.assignedLocations });
      const tracked = canBeTracked(req.user);
      const f = await factsFor({ id: String(req.userId || ''), username: me?.username || '' }, branch);
      const weekday = isWeekdayAt(now(), branch);
      const dayOn = trackingDayOn(weekday, f.of(f.today));
      const consented = tracked && (await store.consentsFor([String(req.userId || '')], CONSENT_VERSION)).has(String(req.userId || ''));
      res.json({ tracked, consented, consentVersion: CONSENT_VERSION, branch, day: f.today, dayOn, dayOffReason: dayOffReason(weekday, f.of(f.today)), windowNow: tracked && dayOn && inTrackingHours(now(), branch), windowStart: WINDOW_START_HOUR, windowEnd: WINDOW_END_HOUR, canView: canViewTeamLocations(req.user) });
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
      const f = await factsFor({ id: String(req.userId), username: me?.username || '' }, branch);
      const [last] = await store.latestFor([String(req.userId)]);
      const { kept, dropped } = cleanPoints(req.body?.points, branch, now(), f.of, last ? { lat: last.lat, lng: last.lng, at: last.recordedAt } : null);
      const saved = await store.savePoints(String(req.userId), branch, kept);
      res.json({ saved, received: Array.isArray(req.body?.points) ? req.body.points.length : 0, dropped, windowNow: inTrackingWindow(now(), branch, f.of(f.today)) });
    } catch (err) { fail(res, 'save', err); }
  });

  router.post('/heartbeat', authenticate, async (req, res) => {
    if (!canBeTracked(req.user)) return res.status(403).json({ message: 'Location tracking isn’t turned on for your role.' });
    const h = parseHeartbeat(req.body, now());
    if (!h) return res.status(400).json({ message: 'Send what the phone says about itself.' });
    try { await store.saveHealth(String(req.userId), h); res.json({ ok: true }); } catch (err) { fail(res, 'heartbeat', err); }
  });

  const viewerOf = async (req: Request, staff?: Awaited<ReturnType<Directory['staff']>>) => {
    const id = String(req.userId || '');
    const rows = staff ?? await directory.staff();
    return { id, name: rows.find(s => s.id === id)?.name || String(req.user?.username || '') };
  };

  router.get('/team', authenticate, async (req, res) => {
    if (!canViewTeamLocations(req.user)) return res.status(403).json({ message: 'You can’t see your team’s locations.' });
    try {
      const [staff, trackedRoles] = await Promise.all([directory.staff(), directory.trackedRoles()]);
      const team = teammatesOf(meOf(req), staff);
      const people = staff.filter(s => s.active && trackedRoles.has(s.role) && inTeam(team, s.id));
      const ids = people.map(p => p.id);
      const at = now();
      const [latestRows, healthById, consents, dayFacts] = await Promise.all([
        store.latestFor(ids), store.healthFor(ids), store.consentsFor(ids, CONSENT_VERSION),
        factsMany(people.map(p => ({ id: p.id, username: p.username, day: trackingDay(at, p.branch) })))
      ]);
      const seen = new Map(latestRows.map(r => [r.userId, r]));
      const out = people.map(p => {
        const row = seen.get(p.id);
        // A person's "today" is their own branch's day: yesterday's last spot is not where they are.
        const todayFrom = dayBounds(trackingDay(at, p.branch), p.branch)?.from;
        const last = row && (!todayFrom || row.recordedAt >= todayFrom) ? row : undefined;
        const h = healthById.get(p.id) ?? null;
        const windowNow = inTrackingWindow(at, p.branch, dayFacts.get(p.id) ?? NO_FACTS);
        const quiet = consents.has(p.id) ? quietReason({ windowNow, lastPointAt: last?.recordedAt ?? null, heartbeat: h, now: at, zone: branchZone(p.branch) }) : null;
        return {
          id: p.id, name: p.name, branch: p.branch, role: p.role,
          lastSeen: last ? { at: last.recordedAt, lat: last.lat, lng: last.lng, accuracyM: last.accuracyM } : null,
          status: seenStatus(last?.recordedAt, at), ago: agoText(last?.recordedAt, at),
          consentedAt: consents.get(p.id) ?? null,
          windowNow, quiet,
          device: h ? { permission: h.permission, lowPower: h.lowPower, batteryPct: h.batteryPct, charging: h.charging, queued: h.queued, appVersion: h.appVersion, reportedAt: h.reportedAt } : null
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      // The access log: one line per viewer and person per 12 h for the map (a trail or a Locate now is always a line).
      const viewer = await viewerOf(req, staff);
      const withPosition = out.filter(o => o.lastSeen && o.id !== viewer.id);
      void store.logViews(withPosition.map(o => ({ viewerId: viewer.id, viewerName: viewer.name, subjectId: o.id, subjectName: o.name, kind: 'live' as const })), at, LIVE_LOG_EVERY_MS)
        .catch(err => console.error('Location access log error:', err));
      res.json({ people: out, windowNow: out.some(o => o.windowNow), serverTime: at });
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
      const viewer = await viewerOf(req, staff);
      // A trail is never shown without its line in the access log: if the line can't be written, nothing is shown.
      if (viewer.id !== person.id) await store.logView({ viewerId: viewer.id, viewerName: viewer.name, subjectId: person.id, subjectName: person.name, kind: 'trail', day }, now());
      const { segments, gaps } = trailSegments(rows.map(r => ({ lat: r.lat, lng: r.lng, at: r.recordedAt })));
      res.json({
        gaps,
        person: { id: person.id, name: person.name, branch: person.branch }, day,
        points: rows.map(r => ({ at: r.recordedAt, lat: r.lat, lng: r.lng, accuracyM: r.accuracyM })),
        // Miles are added up per segment, so a gap in the data is never counted as a straight drive across it.
        miles: Math.round(segments.reduce((sum, seg) => sum + trailMiles(seg), 0) * 10) / 10,
        first: rows[0]?.recordedAt ?? null, last: rows[rows.length - 1]?.recordedAt ?? null
      });
    } catch (err) { fail(res, 'day', err); }
  });

  router.get('/access-log', authenticate, async (req, res) => {
    // 404, not 403: a login without the switch can't tell the log exists.
    if (!canViewLocationAudit(req.user)) return res.status(404).json({ message: 'Not found.' });
    const date = (v: unknown) => { const d = typeof v === 'string' && v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : undefined; };
    try {
      const rows = await store.viewLogFor({
        subjectId: typeof req.query.subjectId === 'string' && req.query.subjectId ? req.query.subjectId : undefined,
        viewerId: typeof req.query.viewerId === 'string' && req.query.viewerId ? req.query.viewerId : undefined,
        from: date(req.query.from), to: date(req.query.to), limit: Number(req.query.limit) || 200
      });
      res.json({ entries: rows.map(r => ({ id: r.id, viewerId: r.viewerId, viewerName: r.viewerName, subjectId: r.subjectId, subjectName: r.subjectName, kind: r.kind, day: r.day, at: r.viewedAt })) });
    } catch (err) { fail(res, 'access log', err); }
  });

  return router;
}
