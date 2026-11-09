/**
 * The real server.ts in Lambda mode, through the real handler, on an in-memory
 * MongoDB (never the .env's database: Lambda mode doesn't read .env).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { HttpApiEvent } from './httpApi.ts';

const SECRET = 'smoke-forward-secret';
let mongo: MongoMemoryServer;
let handler: (event: HttpApiEvent) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;

const event = (path: string, headers: Record<string, string> = {}): HttpApiEvent => ({
  version: '2.0', rawPath: path, rawQueryString: '', isBase64Encoded: false,
  headers: { 'x-forward-secret': SECRET, 'x-forwarded-for': '203.0.113.5, 10.0.0.9', 'x-forwarded-host': 'easy-stones.test', 'x-forwarded-proto': 'https', ...headers },
  requestContext: { http: { method: 'GET', path, sourceIp: '52.1.2.3' } }
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, { RUNTIME: 'lambda', MODULE: 'permits', MONGO_URI: mongo.getUri(), JWT_SECRET: 'smoke-jwt-secret', FORWARD_SECRET: SECRET });
  delete process.env.APP_SECRET_ARN;
  delete process.env.RELAY_URL;
  ({ handler } = await import('./handler.ts'));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  for (const k of ['RUNTIME', 'MODULE', 'MONGO_URI', 'JWT_SECRET', 'FORWARD_SECRET']) delete process.env[k];
});

describe('server.ts on Lambda', () => {
  it('answers a real route (Permits needs a sign-in)', async () => {
    const r = await handler(event('/api/permits/meta'));
    expect(r.statusCode).toBe(401);
    expect(r.headers['cache-control']).toMatch(/no-store/);
  }, 120000);

  it('is connected to the database and nothing else started', async () => {
    const r = await handler(event('/api/health'));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ status: 'ok', dbStatus: 'connected', dbPing: 'success' });
    const server = await import('../../server.ts');
    expect(server.app.get('io')).not.toHaveProperty('sockets'); // the relay, not Socket.IO
    expect(mongoose.connection.readyState).toBe(1);
  });

  it('refuses a request that did not come through Render', async () => {
    expect((await handler(event('/api/health', { 'x-forward-secret': 'guess' }))).statusCode).toBe(403);
  });
});
