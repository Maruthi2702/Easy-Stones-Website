import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import createPushDevicesRouter from './pushDevices.ts';

const TOKEN = 'ab'.repeat(32);
const saved: [string, string][] = []; const removed: [string, string | null][] = []; const sent: string[][] = [];
let on = true;
let server: Server; let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const guard: express.RequestHandler = (req, res, next) => {
    const id = req.header('x-user');
    if (!id) return void res.status(401).json({ message: 'no' });
    req.userId = id; next();
  };
  app.use('/api/push-devices', createPushDevicesRouter({
    guard,
    store: { saveDevice: async (u: string, t: string) => { saved.push([u, t]); }, removeToken: async (t: string, u: string | null) => { removed.push([t, u]); } } as never,
    send: async (ids: string[]) => { sent.push(ids); return { sent: 1, failed: 0, removed: 0, configured: true }; },
    configured: () => on
  }));
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/push-devices`;
});
afterAll(() => { server.close(); });

const call = (method: string, path: string, body?: unknown, user = 'u1') =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined });

describe('push devices route', () => {
  it('needs the sign-in guard', async () => { expect((await call('POST', '', { token: TOKEN }, '')).status).toBe(401); });
  it('saves a token for the caller, lower-cased', async () => {
    expect((await call('POST', '', { token: TOKEN.toUpperCase() })).status).toBe(200);
    expect(saved.at(-1)).toEqual(['u1', TOKEN]);
  });
  it('refuses a token that is not hex', async () => {
    expect((await call('POST', '', { token: 'hello' })).status).toBe(400);
    expect((await call('POST', '', {})).status).toBe(400);
  });
  it('removes only for the caller', async () => {
    expect((await call('DELETE', '', { token: TOKEN })).status).toBe(200);
    expect(removed.at(-1)).toEqual([TOKEN, 'u1']);
  });
  it('tests to the caller only, and says when push is not set up', async () => {
    expect((await call('POST', '/test', undefined, 'u2')).status).toBe(200);
    expect(sent.at(-1)).toEqual(['u2']);
    on = false;
    const r = await call('POST', '/test');
    expect(r.status).toBe(503);
    expect((await r.json()).configured).toBe(false);
  });
});
