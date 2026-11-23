import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import createPushSendRouter from './pushSend.ts';
import type { StaffRow } from '../services/locationTracking.ts';

const person = (id: string, name: string, role: string, branch: string, active = true): StaffRow => ({ id, username: id, name, role, branch, active, location: branch, assignedLocations: [branch] });
const STAFF = [
  person('rep1', 'Rita Rep', 'sales_rep', 'Seattle'),
  person('rep2', 'New Rep', 'sales_rep', 'Seattle'),
  person('gone', 'Gone Gary', 'sales_rep', 'Seattle', false),
  person('atl1', 'Atl Driver', 'driver', 'Atlanta'),
  person('adm1', 'Ada Admin', 'admin', 'Seattle')
];
const directory = { staff: async () => STAFF, trackedRoles: async () => new Set<string>() };
const phones = new Set(['rep1', 'atl1', 'adm1']); // rep2 has none
const devices = { devicesFor: async (ids: string[]) => ids.filter(i => phones.has(i)).map(i => ({ id: `d${i}`, userId: i, token: `tok${i}`, environment: 'production', platform: 'ios' as const })) };
const sent: { ids: string[]; title: string; body: string }[] = [];
const send = async (ids: string[], m: { title: string; body: string }) => { sent.push({ ids, title: m.title, body: m.body }); return { sent: ids.length, failed: 0, removed: 0, configured: true }; };
let isConfigured = true;

let server: Server; let base = '';
let current = { id: 'adm1', permissions: [] as string[], assignedLocations: ['Seattle'] };
const as = (id: string, permissions: string[], assignedLocations = ['Seattle']) => { current = { id, permissions, assignedLocations }; };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const authenticate: express.RequestHandler = (req, _res, next) => { req.userId = current.id; req.user = { ...current, type: 'staff' } as never; next(); };
  app.use('/api/push-send', createPushSendRouter({ authenticate, directory, devices, send: send as never, configured: () => isConfigured }));
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/push-send`;
});
afterAll(() => { server?.close(); });
beforeEach(() => { sent.length = 0; isConfigured = true; as('adm1', ['send_notifications']); });

const post = (body: object) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('who may send', () => {
  it('needs the switch, for the list and for sending', async () => {
    as('adm1', ['manage_users']);
    expect((await fetch(`${base}/people`)).status).toBe(403);
    expect((await post({ userIds: ['rep1'], message: 'Hi' })).status).toBe(403);
    expect(sent).toEqual([]);
  });
});

describe('the people list', () => {
  it('shows the active people on the team with their phone counts', async () => {
    const body = await (await fetch(`${base}/people`)).json();
    expect(body.people.map((p: { id: string }) => p.id).sort()).toEqual(['adm1', 'rep1', 'rep2']);
    expect(body.people.find((p: { id: string }) => p.id === 'rep2').phones).toBe(0);
    expect(body.people.find((p: { id: string }) => p.id === 'rep1').phones).toBe(1);
  });
  it('lets an All-locations login reach every branch', async () => {
    as('adm1', ['send_notifications'], ['*']);
    const body = await (await fetch(`${base}/people`)).json();
    expect(body.people.map((p: { id: string }) => p.id)).toContain('atl1');
  });
});

describe('sending', () => {
  it('sends to people with a phone and says who has none', async () => {
    const res = await post({ userIds: ['rep1', 'rep2'], message: '  Hi   Maruthi ' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sent).toEqual([{ ids: ['rep1'], title: 'Easy Surfaces', body: 'Hi Maruthi' }]);
    expect(body).toMatchObject({ asked: 2, reached: 1, noPhone: ['New Rep'] });
    expect(body.line).toMatch(/Sent to 1 person/);
  });
  it('drops people outside the team, deactivated people and unknown ids', async () => {
    const res = await post({ userIds: ['atl1', 'gone', 'nobody'], message: 'Hi' });
    expect(res.status).toBe(404);
    expect(sent).toEqual([]);
    const mixed = await (await post({ userIds: ['atl1', 'rep1'], message: 'Hi' })).json();
    expect(sent[0].ids).toEqual(['rep1']);
    expect(mixed.asked).toBe(1);
  });
  it('sends nothing when nobody asked has a phone', async () => {
    const body = await (await post({ userIds: ['rep2'], message: 'Hi' })).json();
    expect(sent).toEqual([]);
    expect(body).toMatchObject({ reached: 0, noPhone: ['New Rep'] });
    expect(body.line).toMatch(/Not sent/);
  });
  it('refuses a missing message or recipients, and a long message', async () => {
    expect((await post({ userIds: ['rep1'], message: '  ' })).status).toBe(400);
    expect((await post({ userIds: [], message: 'Hi' })).status).toBe(400);
    expect((await post({ userIds: ['rep1'], message: 'x'.repeat(121) })).status).toBe(400);
    expect(sent).toEqual([]);
  });
  it('says so when push is not set up on the server', async () => {
    isConfigured = false;
    const res = await post({ userIds: ['rep1'], message: 'Hi' });
    expect(res.status).toBe(503);
    expect(sent).toEqual([]);
  });
});
