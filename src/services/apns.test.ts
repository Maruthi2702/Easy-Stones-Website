import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { configFromEnv, payloadFor, providerToken, sendPushToUsers, type SendResult, type Transport } from './apns.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const config = { keyId: 'KEY1234567', keyP8: p8, teamId: 'F82RKW6P64', topic: 'app.easysurfaces' };

function fakeStore(phones: { id: string; userId: string; token: string; environment: string }[]) {
  const removed: string[] = []; const env: Record<string, string> = {};
  return { removed, env, store: {
    devicesFor: async (ids: string[]) => phones.filter(p => ids.includes(p.userId)),
    removeTokens: async (t: string[]) => { removed.push(...t); },
    setEnvironment: async (t: string, e: string) => { env[t] = e; }
  } as never };
}
const script = (answers: Record<string, SendResult>): Transport & { calls: string[] } => {
  const calls: string[] = [];
  const t = (async ({ token, environment }) => { calls.push(`${token}:${environment}`); return answers[`${token}:${environment}`] ?? { ok: false, status: 0, reason: 'unscripted' }; }) as Transport & { calls: string[] };
  t.calls = calls; return t;
};
const OK = { ok: true, status: 200, reason: '' };

describe('APNs', () => {
  it('reads its settings from the environment, or is off', () => {
    expect(configFromEnv({})).toBeNull();
    expect(configFromEnv({ APNS_KEY_ID: 'K', APNS_KEY_P8: 'a\\nb' } as never)).toMatchObject({ keyId: 'K', keyP8: 'a\nb', teamId: 'F82RKW6P64', topic: 'app.easysurfaces' });
  });
  it('signs a provider token Apple can verify', () => {
    const jwt = providerToken(config, 1_700_000_000_000);
    const [h, b, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(JSON.parse(Buffer.from(b, 'base64url').toString())).toEqual({ iss: 'F82RKW6P64', iat: 1_700_000_000 });
    expect(verify('sha256', Buffer.from(`${h}.${b}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });
  it('builds the payload with a path to open', () => {
    expect(JSON.parse(payloadFor({ title: 'Hi', body: 'There', path: '/sales', badge: 2 }))).toEqual({ aps: { alert: { title: 'Hi', body: 'There' }, sound: 'default', badge: 2 }, path: '/sales' });
  });
  it('does nothing when push is not set up', async () => {
    const t = script({}); const f = fakeStore([{ id: '1', userId: 'u', token: 'a', environment: '' }]);
    expect(await sendPushToUsers(['u'], { title: 't', body: 'b' }, { transport: t, store: f.store, config: null })).toMatchObject({ sent: 0, configured: false });
    expect(t.calls).toEqual([]);
  });
  it('learns the environment: production first, then sandbox, and keeps the answer', async () => {
    const t = script({ 'a:production': { ok: false, status: 400, reason: 'BadDeviceToken' }, 'a:sandbox': OK });
    const f = fakeStore([{ id: '1', userId: 'u', token: 'a', environment: '' }]);
    const r = await sendPushToUsers(['u'], { title: 't', body: 'b' }, { transport: t, store: f.store, config });
    expect(r).toMatchObject({ sent: 1, failed: 0, removed: 0 });
    expect(t.calls).toEqual(['a:production', 'a:sandbox']);
    expect(f.env).toEqual({ a: 'sandbox' });
  });
  it('uses the saved environment only, and only for the people asked', async () => {
    const t = script({ 'a:sandbox': OK });
    const f = fakeStore([{ id: '1', userId: 'u', token: 'a', environment: 'sandbox' }, { id: '2', userId: 'other', token: 'b', environment: '' }]);
    await sendPushToUsers(['u'], { title: 't', body: 'b' }, { transport: t, store: f.store, config });
    expect(t.calls).toEqual(['a:sandbox']);
  });
  it('removes a token Apple says is gone, and a token wrong on both, but not one that merely failed', async () => {
    const t = script({
      'gone:production': { ok: false, status: 410, reason: 'Unregistered' },
      'bad:production': { ok: false, status: 400, reason: 'BadDeviceToken' }, 'bad:sandbox': { ok: false, status: 400, reason: 'BadDeviceToken' },
      'flaky:production': { ok: false, status: 503, reason: 'ServiceUnavailable' }
    });
    const f = fakeStore(['gone', 'bad', 'flaky'].map((token, i) => ({ id: String(i), userId: 'u', token, environment: '' })));
    const r = await sendPushToUsers(['u'], { title: 't', body: 'b' }, { transport: t, store: f.store, config });
    expect(r).toMatchObject({ sent: 0, failed: 3, removed: 2 });
    expect(f.removed.sort()).toEqual(['bad', 'gone']);
  });
});
