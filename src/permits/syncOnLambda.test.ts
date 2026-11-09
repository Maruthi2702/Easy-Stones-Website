import type { Loose } from '../types/records.ts';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import createPermitsRouter from './router.ts';
import { permitSyncOnLambda } from './syncOnLambda.ts';
import { STALE_RUN_MS } from './staleRun.ts';
import { PermitRun } from './models.ts';
import { ALL_PERMIT_PERMISSIONS } from './permissions.ts';

let mongo: MongoMemoryServer;
let app: ReturnType<typeof express>;
const NOW = new Date('2026-11-08T17:00:00Z');
const ADMIN = { id: 'u1', displayName: 'Krish', permissions: [...ALL_PERMIT_PERMISSIONS] };
const api = (method: 'get' | 'post', url: string) => request(app)[method](`/api/permits${url}`).set('x-test-user', JSON.stringify(ADMIN));

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use('/api/permits', createPermitsRouter({
    sync: permitSyncOnLambda({ sourceIds: () => ['whatcom'] }, () => NOW),
    customerIndexMs: 0,
    authenticate: (req: Loose, res: Loose, next: () => void) => {
      req.user = JSON.parse(req.headers['x-test-user']);
      next();
    }
  }));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(() => PermitRun.deleteMany({}));

describe('Permits on Lambda', () => {
  it('reads "running" from an open pull in the database', async () => {
    expect((await api('get', '/meta')).body).toMatchObject({ running: false, sources: [{ id: 'whatcom' }] });
    await PermitRun.create({ source: 'whatcom', kind: 'daily', since: '2026-10-09', startedAt: new Date(NOW.getTime() - 60_000) });
    expect((await api('get', '/meta')).body.running).toBe(true);
  });

  it('a pull left open past the stale age (a server that died) is not running', async () => {
    await PermitRun.create({ source: 'whatcom', kind: 'daily', since: '2026-10-09', startedAt: new Date(NOW.getTime() - STALE_RUN_MS - 1000) });
    expect((await api('get', '/meta')).body.running).toBe(false);
  });

  it('never starts a pull: /refresh answers 503', async () => {
    const res = await api('post', '/refresh');
    expect(res.status).toBe(503);
    expect(await PermitRun.countDocuments()).toBe(0);
  });
});
