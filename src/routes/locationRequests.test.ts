import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import createLocationRequestsRouter from './locationRequests.ts';
import type { StaffRow } from '../services/locationTracking.ts';
import type { RequestRecord } from '../db/locationPoints/requests.ts';
import { REQUEST_TTL_MS } from '../utils/locationRequests.ts';
const AUDIT: Record<string, unknown>[] = [];

const person = (id: string, name: string, role: string, branch: string): StaffRow => ({ id, username: id, name, role, branch, active: true, location: branch, assignedLocations: [branch] });
const STAFF = [
  person('rep1', 'Rita Rep', 'sales_rep', 'Seattle'),
  person('rep2', 'New Rep', 'sales_rep', 'Seattle'),
  person('atl1', 'Atl Driver', 'driver', 'Atlanta'),
  person('off1', 'Olive Office', 'csr', 'Seattle'),
  person('adm1', 'Ada Admin', 'admin', 'Seattle')
];
const directory = { staff: async () => STAFF, trackedRoles: async () => new Set(['sales_rep', 'driver']) };
const consented = new Set(['rep1', 'atl1']);
const consents = { consentsFor: async (ids: string[]) => new Map(ids.filter(i => consented.has(i)).map(i => [i, new Date('2026-11-20T00:00:00Z')])) };

let NOW = new Date('2026-11-20T03:00:00Z'); // 7 PM in Seattle: outside the window
let rows: RequestRecord[] = [];
const requests = {
  createRequest: async (a: { targetUserId: string; requestedBy: string; requestedByName: string; reason: string; consentVersion: number; now?: Date }) => {
    const r: RequestRecord = { id: `r${rows.length + 1}`, targetUserId: a.targetUserId, requestedBy: a.requestedBy, requestedByName: a.requestedByName, reason: a.reason, requestedAt: a.now!, answeredAt: null, lat: null, lng: null, accuracyM: null, consentVersion: a.consentVersion };
    rows.push(r); return r;
  },
  requestById: async (id: string) => rows.find(r => r.id === id) ?? null,
  openFor: async (userId: string, now: Date) => rows.filter(r => r.targetUserId === userId && !r.answeredAt && now.getTime() - r.requestedAt.getTime() <= REQUEST_TTL_MS),
  answerRequest: async (id: string, userId: string, at: { lat: number; lng: number; accuracyM: number | null }, now: Date) => {
    const r = rows.find(x => x.id === id && x.targetUserId === userId && !x.answeredAt && now.getTime() - x.requestedAt.getTime() <= REQUEST_TTL_MS);
    if (!r) return null;
    Object.assign(r, { answeredAt: now, lat: at.lat, lng: at.lng, accuracyM: at.accuracyM });
    return r;
  },
  log: async (userId: string) => rows.filter(r => r.targetUserId === userId).reverse()
};

let server: Server; let base = '';
let current: { id: string; permissions: string[]; assignedLocations: string[] } = { id: 'adm1', permissions: [], assignedLocations: ['Seattle'] };
const as = (id: string, permissions: string[], assignedLocations = ['Seattle']) => { current = { id, permissions, assignedLocations }; };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const authenticate: express.RequestHandler = (req, _res, next) => { req.userId = current.id; req.user = { ...current, type: 'staff' } as never; next(); };
  app.use('/api/location-tracking', createLocationRequestsRouter({ authenticate, directory, requests: requests as never, consents, audit: { logView: async (v: unknown) => { AUDIT.push(v as never); return true; } }, now: () => NOW }));
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/location-tracking`;
});
afterAll(() => { server?.close(); });
beforeEach(() => { rows = []; NOW = new Date('2026-11-20T03:00:00Z'); as('adm1', ['locate_on_request']); });

const ask = (body: object) => fetch(`${base}/locate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const answer = (id: string, body: object) => fetch(`${base}/locate/${id}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('asking', () => {
  it('needs the switch', async () => {
    as('adm1', ['view_team_locations']);
    expect((await ask({ userId: 'rep1', reason: 'Truck not back' })).status).toBe(403);
  });
  it('needs a reason', async () => {
    const res = await ask({ userId: 'rep1', reason: 'no' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reason');
  });
  it('asks a tracked, consented person on the team and logs it, without notifying them', async () => {
    const res = await ask({ userId: 'rep1', reason: 'Truck not back' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pushed).toBeUndefined();
    expect(body.request).toMatchObject({ userId: 'rep1', status: 'pending', reason: 'Truck not back' });
    expect(rows).toHaveLength(1);
    expect(AUDIT).toEqual([expect.objectContaining({ subjectId: 'rep1', kind: 'locate' })]); // and one line in the access log
  });
  it('says 404 for someone outside the team, not tracked, or unknown', async () => {
    for (const id of ['atl1', 'off1', 'nobody']) expect((await ask({ userId: id, reason: 'Truck not back' })).status).toBe(404);
  });
  it('refuses yourself', async () => {
    as('rep1', ['locate_on_request']);
    expect((await ask({ userId: 'rep1', reason: 'Testing it' })).status).toBe(400);
  });
  it('refuses a person who hasn’t agreed to the current wording', async () => {
    const res = await ask({ userId: 'rep2', reason: 'Truck not back' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('consent');
    expect(rows).toHaveLength(0);
  });
  it('doesn’t ask twice while one is open, but does after it expires', async () => {
    await ask({ userId: 'rep1', reason: 'Truck not back' });
    const again = await ask({ userId: 'rep1', reason: 'Truck not back' });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('open');
    NOW = new Date(NOW.getTime() + REQUEST_TTL_MS + 60_000);
    expect((await ask({ userId: 'rep1', reason: 'Still not back' })).status).toBe(201);
  });
});

describe('the phone', () => {
  it('sees only its own open asks, with who asked and never why', async () => {
    await ask({ userId: 'rep1', reason: 'Secret reason' });
    as('rep1', ['track_location']);
    const mine = await (await fetch(`${base}/locate/pending`)).json();
    expect(mine.requests).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain('Secret reason');
    expect(mine.requests[0].requestedByName).toBe('Ada Admin');
    as('atl1', ['track_location']);
    expect((await (await fetch(`${base}/locate/pending`)).json()).requests).toEqual([]);
  });
  it('answers its own ask once; nobody else can answer it', async () => {
    const id = (await (await ask({ userId: 'rep1', reason: 'Truck not back' })).json()).request.id;
    as('atl1', ['track_location']);
    expect((await answer(id, { lat: 47.6, lng: -122.3 })).status).toBe(404);
    as('rep1', ['track_location']);
    expect((await answer(id, { lat: 0, lng: 0 })).status).toBe(400);
    expect((await answer(id, { lat: 47.6, lng: -122.3, accuracy: 15 })).status).toBe(200);
    expect((await answer(id, { lat: 47.7, lng: -122.3 })).status).toBe(404);
  });
  it('can’t answer without agreeing to the wording', async () => {
    rows.push({ id: 'x', targetUserId: 'rep2', requestedBy: 'adm1', requestedByName: 'Ada', reason: 'Old ask', requestedAt: NOW, answeredAt: null, lat: null, lng: null, accuracyM: null, consentVersion: 1 });
    as('rep2', ['track_location']);
    expect((await answer('x', { lat: 47.6, lng: -122.3 })).status).toBe(403);
  });
});

describe('the admin reads the answer and the log', () => {
  it('shows status, position and a log for the person', async () => {
    const id = (await (await ask({ userId: 'rep1', reason: 'Truck not back' })).json()).request.id;
    as('rep1', ['track_location']);
    await answer(id, { lat: 47.6, lng: -122.3, accuracy: 15 });
    as('adm1', ['locate_on_request']);
    const one = (await (await fetch(`${base}/locate/${id}`)).json()).request;
    expect(one).toMatchObject({ status: 'answered', lat: 47.6, lng: -122.3, accuracyM: 15 });
    const log = (await (await fetch(`${base}/locate?userId=rep1`)).json()).requests;
    expect(log).toHaveLength(1);
    expect((await fetch(`${base}/locate?userId=atl1`)).status).toBe(404);
    as('rep1', ['track_location']);
    expect((await fetch(`${base}/locate/${id}`)).status).toBe(403);
  });
});
