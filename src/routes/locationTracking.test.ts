import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import createLocationTrackingRouter from './locationTracking.ts';
import type { StaffRow } from '../services/locationTracking.ts';
import { CONSENT_VERSION, NO_FACTS, type DayFacts } from '../utils/locationTracking.ts';

const person = (id: string, name: string, role: string, branch: string): StaffRow => ({ id, username: id, name, role, branch, active: true, location: branch, assignedLocations: [branch] });
const STAFF = [
  person('rep1', 'Rita Rep', 'sales_rep', 'Seattle'),
  person('drv1', 'Dan Driver', 'driver', 'Seattle'),
  person('drv2', 'Atl Driver', 'driver', 'Atlanta'),
  person('off1', 'Olive Office', 'csr', 'Seattle'),
  person('mgr1', 'Mo Manager', 'manager', 'Seattle'),
  person('adm1', 'Ada Admin', 'admin', 'Seattle')
];
const directory = { staff: async () => STAFF, trackedRoles: async () => new Set(['sales_rep', 'driver']) };

type Saved = { userId: string; branch: string; n: number };
const saved: Saved[] = [];
const consented = new Set<string>(['rep1', 'drv1', 'drv2']);
const store = {
  recordConsent: async (userId: string) => { consented.add(userId); return new Date('2026-11-19T17:00:00Z'); },
  consentsFor: async (ids: string[]) => new Map(ids.filter(id => consented.has(id)).map(id => [id, new Date('2026-11-19T17:00:00Z')])),
  savePoints: async (userId: string, branch: string, batch: unknown[]) => { saved.push({ userId, branch, n: batch.length }); return batch.length; },
  latestFor: async (ids: string[] | null) => (ids || []).filter(id => id !== 'drv1').map(id => ({ userId: id, recordedAt: new Date('2026-11-18T19:55:00Z'), lat: 47.6, lng: -122.3, accuracyM: 12, branch: 'Seattle', updatedAt: new Date('2026-11-18T19:55:05Z') })),
  trail: async () => TRAIL,
  saveHealth: async (userId: string, h: unknown) => { HEALTH.set(userId, { userId, receivedAt: new Date(), ...(h as object) }); },
  healthFor: async (ids: string[]) => new Map(ids.filter(id => HEALTH.has(id)).map(id => [id, HEALTH.get(id)])),
  logView: async (v: unknown) => { if (LOG_FAILS) throw new Error('log down'); LOG.push(v as never); return true; },
  logViews: async (list: unknown[]) => { LOG.push(...(list as never[])); },
  viewLogFor: async () => LOG_ROWS
};
const HEALTH = new Map<string, Record<string, unknown>>();
const LOG: Record<string, unknown>[] = [];
let LOG_FAILS = false;
const LOG_ROWS = [{ id: 'l1', viewerId: 'mgr1', viewerName: 'Mo Manager', subjectId: 'rep1', subjectName: 'Rita Rep', kind: 'trail', day: '2026-11-18', viewedAt: new Date('2026-11-18T19:00:00Z') }];
const SHORT_TRAIL = [
  { id: '1', recordedAt: new Date('2026-11-18T16:00:00Z'), lat: 47.6, lng: -122.3, accuracyM: 5, speedMps: null },
  { id: '2', recordedAt: new Date('2026-11-18T16:10:00Z'), lat: 47.7, lng: -122.3, accuracyM: 5, speedMps: null }
];
let TRAIL = SHORT_TRAIL;

// Wed 2026-11-18 noon in Seattle (the weekend tests move it).
let NOW = new Date('2026-11-18T20:00:00Z');
const WED = NOW;
// What a person's records say about a day, keyed 'userId:YYYY-MM-DD'.
const FACTS = new Map<string, DayFacts>();
const facts = async (person: { id: string }, days: string[]) => new Map(days.map(d => [d, FACTS.get(`${person.id}:${d}`) ?? NO_FACTS]));
const factsMany = async (people: { id: string; day: string }[]) => new Map(people.map(p => [p.id, FACTS.get(`${p.id}:${p.day}`) ?? NO_FACTS]));
let server: Server; let base = '';
let current: { id: string; permissions: string[]; assignedLocations: string[] } = { id: 'rep1', permissions: [], assignedLocations: ['Seattle'] };
const as = (id: string, permissions: string[], assignedLocations = ['Seattle']) => { current = { id, permissions, assignedLocations }; };

beforeAll(async () => {
  const app = express();
  app.use(express.json()); // server.ts has one globally
  const authenticate: express.RequestHandler = (req, _res, next) => { req.userId = current.id; req.user = { ...current, type: 'staff' } as never; next(); };
  app.use('/api/location-tracking', createLocationTrackingRouter({ authenticate, directory, store: store as never, facts, factsMany, now: () => NOW }));
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/location-tracking`;
});
afterAll(() => { server?.close(); });

const post = (points: unknown) => fetch(`${base}/points`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points }) });
const pt = (over = {}) => ({ id: 'a', at: '2026-11-18T19:55:00Z', lat: 47.6, lng: -122.3, accuracy: 10, ...over });

describe('POST /points', () => {
  it('refuses someone whose role isn\'t tracked', async () => {
    as('off1', []);
    expect((await post([pt()])).status).toBe(403);
  });
  it('saves good points for the signed-in person on their branch, and drops the rest without an error', async () => {
    saved.length = 0; as('rep1', ['track_location']);
    const res = await post([pt(), pt({ id: 'b', at: '2026-11-18T14:00:00Z' }), pt({ id: 'c', lat: 999 })]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ saved: 1, received: 3, windowNow: true, dropped: { outsideWindow: 1, invalid: 1 } });
    expect(saved).toEqual([{ userId: 'rep1', branch: 'Seattle', n: 1 }]);
  });
  it('uses the person\'s own branch clock', async () => {
    saved.length = 0; as('drv2', ['track_location'], ['Atlanta']);
    // 15:30Z is 7:30 AM in Seattle but 10:30 AM in Atlanta; both in the window. 12:00Z is 7 AM Atlanta, 4 AM Seattle.
    const body = await (await post([pt({ id: 'x', at: '2026-11-18T12:00:00Z' })])).json();
    expect(body.saved).toBe(1);
    as('drv1', ['track_location']);
    const seattle = await (await post([pt({ id: 'y', at: '2026-11-18T12:00:00Z' })])).json();
    expect(seattle.saved).toBe(0);
  });
});

describe('consent', () => {
  const consent = (version: unknown) => fetch(`${base}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
  it('refuses points until the person has agreed, saying why', async () => {
    as('rep2', ['track_location']);
    const res = await post([pt()]);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('consent');
  });
  it('saves consent for the current wording, then points are kept', async () => {
    as('rep2', ['track_location']);
    expect((await consent(CONSENT_VERSION)).status).toBe(200);
    expect((await post([pt()])).status).toBe(200);
  });
  it('refuses an old wording version and someone who isn\'t tracked', async () => {
    as('rep3', ['track_location']);
    const old = await consent(CONSENT_VERSION - 1);
    expect(old.status).toBe(409);
    as('off1', []);
    expect((await consent(1)).status).toBe(403);
  });
  it('shows in the status', async () => {
    as('rep3', ['track_location']);
    expect((await (await fetch(`${base}/status`)).json())).toMatchObject({ tracked: true, consented: false, consentVersion: CONSENT_VERSION });
    as('rep1', ['track_location']);
    expect((await (await fetch(`${base}/status`)).json()).consented).toBe(true);
  });
});

describe('GET /status', () => {
  it('says whether to collect now', async () => {
    as('rep1', ['track_location']);
    expect(await (await fetch(`${base}/status`)).json()).toMatchObject({ tracked: true, branch: 'Seattle', windowNow: true, windowStart: 7, windowEnd: 18, canView: false });
    as('off1', []);
    expect(await (await fetch(`${base}/status`)).json()).toMatchObject({ tracked: false, windowNow: false });
  });
});

describe('GET /team', () => {
  it('needs the view switch', async () => {
    as('mgr1', []);
    expect((await fetch(`${base}/team`)).status).toBe(403);
  });
  it('lists the tracked people on the manager\'s team only, with last seen', async () => {
    as('mgr1', ['view_team_locations']);
    const { people } = await (await fetch(`${base}/team`)).json();
    expect(people.map((p: { id: string }) => p.id)).toEqual(['drv1', 'rep1']); // no Atlanta, no office, no manager
    const rita = people.find((p: { id: string }) => p.id === 'rep1');
    expect(rita).toMatchObject({ status: 'live', ago: '5 min ago', lastSeen: { lat: 47.6 }, consentedAt: '2026-11-19T17:00:00.000Z' });
    expect(people.find((p: { id: string }) => p.id === 'drv1')).toMatchObject({ status: 'none', ago: 'No location today', lastSeen: null });
  });
  it('an all-locations viewer sees every branch', async () => {
    as('adm1', ['view_team_locations'], ['*']);
    const { people } = await (await fetch(`${base}/team`)).json();
    expect(people.map((p: { id: string }) => p.id).sort()).toEqual(['drv1', 'drv2', 'rep1']);
  });
});

describe('GET /team/:userId', () => {
  it('returns a teammate\'s day with miles', async () => {
    as('mgr1', ['view_team_locations']);
    const body = await (await fetch(`${base}/team/rep1?date=2026-11-18`)).json();
    expect(body.person).toMatchObject({ id: 'rep1', branch: 'Seattle' });
    expect(body.points).toHaveLength(2);
    expect(body.miles).toBeGreaterThan(6);
  });
  it('answers not found for another branch, an untracked person or a bad day', async () => {
    as('mgr1', ['view_team_locations']);
    expect((await fetch(`${base}/team/drv2`)).status).toBe(404);
    expect((await fetch(`${base}/team/off1`)).status).toBe(404);
    expect((await fetch(`${base}/team/nobody`)).status).toBe(404);
    expect((await fetch(`${base}/team/rep1?date=soon`)).status).toBe(400);
  });
  it('needs the view switch', async () => {
    as('rep1', ['track_location']);
    expect((await fetch(`${base}/team/rep1`)).status).toBe(403);
  });
});

describe('time off and weekend work', () => {
  const SAT = new Date('2026-11-21T20:00:00Z'); // Saturday noon in Seattle
  const status = async () => (await fetch(`${base}/status`)).json();
  afterEach(() => { NOW = WED; FACTS.clear(); });

  it('turns a weekday off for Personal Time Off: status says why and points are dropped', async () => {
    FACTS.set('rep1:2026-11-18', { timeOff: true, scheduledWork: false });
    as('rep1', ['track_location']);
    expect(await status()).toMatchObject({ day: '2026-11-18', dayOn: false, dayOffReason: 'timeOff', windowNow: false });
    const body = await (await post([pt()])).json();
    expect(body).toMatchObject({ saved: 0, windowNow: false, dropped: { outsideWindow: 1 } });
  });
  it('is off on a weekend with nothing scheduled', async () => {
    NOW = SAT; as('rep1', ['track_location']);
    expect(await status()).toMatchObject({ dayOn: false, dayOffReason: 'weekend', windowNow: false });
    expect((await (await post([pt({ at: '2026-11-21T19:55:00Z' })])).json()).saved).toBe(0);
  });
  it('is on for a weekend day with scheduled work, but only during the hours', async () => {
    NOW = SAT; FACTS.set('rep1:2026-11-21', { timeOff: false, scheduledWork: true });
    as('rep1', ['track_location']);
    expect(await status()).toMatchObject({ dayOn: true, dayOffReason: '', windowNow: true });
    expect((await (await post([pt({ at: '2026-11-21T19:55:00Z' })])).json()).saved).toBe(1);
    NOW = new Date('2026-11-22T03:30:00Z'); // Saturday 7:30 PM
    FACTS.set('rep1:2026-11-21', { timeOff: false, scheduledWork: true });
    expect(await status()).toMatchObject({ dayOn: true, windowNow: false });
  });
  it('reads a batch by each point\'s own day', async () => {
    NOW = new Date('2026-11-21T18:00:00Z'); // Saturday 10 AM
    FACTS.set('rep1:2026-11-20', { timeOff: true, scheduledWork: false }); // Friday off
    as('rep1', ['track_location']);
    const body = await (await post([pt({ id: 'f', at: '2026-11-20T20:00:00Z' }), pt({ id: 's', at: '2026-11-21T17:00:00Z' })])).json();
    expect(body.saved).toBe(0); // Friday is time off, Saturday has nothing scheduled
  });
});

describe('location v2: bad fixes, heartbeat, why quiet, gaps, the access log', () => {
  afterEach(() => { NOW = WED; FACTS.clear(); HEALTH.clear(); LOG.length = 0; LOG_FAILS = false; TRAIL = SHORT_TRAIL; });

  it('drops a point that jumped miles from the newest saved one', async () => {
    saved.length = 0; as('rep1', ['track_location']);
    // the newest saved point is 47.6 at 19:55; 48.0 a minute later is ~44 km away
    const body = await (await post([pt({ id: 'j', at: '2026-11-18T19:56:00Z', lat: 48.0 })])).json();
    expect(body).toMatchObject({ saved: 0, dropped: { teleport: 1 } });
  });

  describe('POST /heartbeat', () => {
    const beat = (body: unknown) => fetch(`${base}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    it('is for tracked people only', async () => {
      as('off1', []);
      expect((await beat({ permission: 'always' })).status).toBe(403);
    });
    it('keeps what the phone says about itself', async () => {
      as('rep1', ['track_location']);
      expect((await beat({ permission: 'when-in-use', batteryPct: 40, lowPower: true, queued: 3, appVersion: '1.0' })).status).toBe(200);
      expect(HEALTH.get('rep1')).toMatchObject({ permission: 'when-in-use', batteryPct: 40, lowPower: true, queued: 3 });
    });
    it('treats a missing body as nothing to keep', async () => {
      as('rep1', ['track_location']);
      expect((await fetch(`${base}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' })).status).toBe(400);
    });
  });

  describe('GET /team: why a person is quiet', () => {
    const team = async () => (await (await fetch(`${base}/team`)).json()).people as { id: string; quiet: { code: string; text: string } | null; windowNow: boolean; device: unknown }[];
    it('says plain silence for a person with no point today, and nothing for one who is reporting', async () => {
      as('mgr1', ['view_team_locations']);
      const people = await team();
      expect(people.find(p => p.id === 'drv1')!.quiet).toMatchObject({ code: 'silent', text: 'No location from this phone today' });
      expect(people.find(p => p.id === 'rep1')!.quiet).toBeNull();
    });
    it('names a permission problem from the phone\'s heartbeat, and a dead battery for a quiet phone', async () => {
      as('mgr1', ['view_team_locations']);
      HEALTH.set('rep1', { userId: 'rep1', permission: 'when-in-use', lowPower: false, batteryPct: 60, charging: false, queued: 0, appVersion: '1', reportedAt: new Date('2026-11-18T19:58:00Z') });
      HEALTH.set('drv1', { userId: 'drv1', permission: 'always', lowPower: false, batteryPct: 3, charging: false, queued: 0, appVersion: '1', reportedAt: new Date('2026-11-18T19:40:00Z') });
      const people = await team();
      expect(people.find(p => p.id === 'rep1')!.quiet?.code).toBe('when-in-use');
      expect(people.find(p => p.id === 'drv1')!.quiet?.code).toBe('battery-dying');
      expect(people.find(p => p.id === 'drv1')!.device).toMatchObject({ batteryPct: 3, permission: 'always' });
    });
    it('is quiet about quiet on a day tracking is off (time off)', async () => {
      as('mgr1', ['view_team_locations']);
      FACTS.set('drv1:2026-11-18', { timeOff: true, scheduledWork: false });
      const drv = (await team()).find(p => p.id === 'drv1')!;
      expect(drv).toMatchObject({ windowNow: false, quiet: null });
    });
  });

  describe('the access log is written by the server', () => {
    it('a look at the map is one line per person who has a position, never the viewer\'s own', async () => {
      as('mgr1', ['view_team_locations']);
      await fetch(`${base}/team`);
      await new Promise(r => setTimeout(r, 10));
      expect(LOG).toEqual([expect.objectContaining({ viewerId: 'mgr1', viewerName: 'Mo Manager', subjectId: 'rep1', kind: 'live' })]); // drv1 has no position
    });
    it('a trail is a line with its day', async () => {
      as('mgr1', ['view_team_locations']);
      await fetch(`${base}/team/rep1?date=2026-11-18`);
      expect(LOG).toEqual([expect.objectContaining({ viewerId: 'mgr1', subjectId: 'rep1', kind: 'trail', day: '2026-11-18' })]);
    });
    it('shows no trail at all when its line can\'t be written', async () => {
      as('mgr1', ['view_team_locations']);
      LOG_FAILS = true;
      expect((await fetch(`${base}/team/rep1?date=2026-11-18`)).status).toBe(500);
    });
    it('GET /access-log is 404 without the switch and lists lines with it', async () => {
      as('mgr1', ['view_team_locations']);
      expect((await fetch(`${base}/access-log`)).status).toBe(404);
      as('adm1', ['view_location_audit']);
      const body = await (await fetch(`${base}/access-log?subjectId=rep1`)).json();
      expect(body.entries).toEqual([expect.objectContaining({ viewerName: 'Mo Manager', subjectName: 'Rita Rep', kind: 'trail', day: '2026-11-18', at: '2026-11-18T19:00:00.000Z' })]);
    });
  });

  it('a trail with a hole in it lists the gap and does not count miles across it', async () => {
    as('mgr1', ['view_team_locations']);
    TRAIL = [
      { id: '1', recordedAt: new Date('2026-11-18T16:00:00Z'), lat: 47.6, lng: -122.3, accuracyM: 5, speedMps: null },
      { id: '2', recordedAt: new Date('2026-11-18T16:05:00Z'), lat: 47.6, lng: -122.3, accuracyM: 5, speedMps: null },
      { id: '3', recordedAt: new Date('2026-11-18T17:30:00Z'), lat: 47.7, lng: -122.3, accuracyM: 5, speedMps: null }
    ];
    const body = await (await fetch(`${base}/team/rep1?date=2026-11-18`)).json();
    expect(body.gaps).toEqual([{ from: '2026-11-18T16:05:00.000Z', to: '2026-11-18T17:30:00.000Z', minutes: 85 }]);
    expect(body.miles).toBe(0);
    expect(body.points).toHaveLength(3);
  });
});
