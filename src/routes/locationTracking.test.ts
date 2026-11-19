import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import createLocationTrackingRouter from './locationTracking.ts';
import type { StaffRow } from '../services/locationTracking.ts';
import { NO_FACTS, type DayFacts } from '../utils/locationTracking.ts';

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
  lastSeen: async (ids: string[] | null) => (ids || []).filter(id => id !== 'drv1').map(id => ({ userId: id, recordedAt: new Date('2026-11-18T19:55:00Z'), lat: 47.6, lng: -122.3, accuracyM: 12, branch: 'Seattle' })),
  trail: async () => [
    { id: '1', recordedAt: new Date('2026-11-18T16:00:00Z'), lat: 47.6, lng: -122.3, accuracyM: 5, speedMps: null },
    { id: '2', recordedAt: new Date('2026-11-18T16:10:00Z'), lat: 47.7, lng: -122.3, accuracyM: 5, speedMps: null }
  ]
};

// Wed 2026-11-18 noon in Seattle (the weekend tests move it).
let NOW = new Date('2026-11-18T20:00:00Z');
const WED = NOW;
// What a person's records say about a day, keyed 'userId:YYYY-MM-DD'.
const FACTS = new Map<string, DayFacts>();
const facts = async (person: { id: string }, days: string[]) => new Map(days.map(d => [d, FACTS.get(`${person.id}:${d}`) ?? NO_FACTS]));
let server: Server; let base = '';
let current: { id: string; permissions: string[]; assignedLocations: string[] } = { id: 'rep1', permissions: [], assignedLocations: ['Seattle'] };
const as = (id: string, permissions: string[], assignedLocations = ['Seattle']) => { current = { id, permissions, assignedLocations }; };

beforeAll(async () => {
  const app = express();
  app.use(express.json()); // server.ts has one globally
  const authenticate: express.RequestHandler = (req, _res, next) => { req.userId = current.id; req.user = { ...current, type: 'staff' } as never; next(); };
  app.use('/api/location-tracking', createLocationTrackingRouter({ authenticate, directory, store: store as never, facts, now: () => NOW }));
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
    expect((await consent(1)).status).toBe(200);
    expect((await post([pt()])).status).toBe(200);
  });
  it('refuses an old wording version and someone who isn\'t tracked', async () => {
    as('rep3', ['track_location']);
    const old = await consent(0);
    expect(old.status).toBe(409);
    as('off1', []);
    expect((await consent(1)).status).toBe(403);
  });
  it('shows in the status', async () => {
    as('rep3', ['track_location']);
    expect((await (await fetch(`${base}/status`)).json())).toMatchObject({ tracked: true, consented: false, consentVersion: 1 });
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
