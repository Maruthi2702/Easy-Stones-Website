import { generateKeyPairSync, createVerify } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { assertionFor, accessTokenFor, bodyFor, fcmConfigFromEnv, forgetAccessToken, resultOf, sendToAndroid, type FcmConfig, type FcmTransport, type TokenFetcher } from './fcm.ts';
import { sendPushToUsers, pushConfigured, type Transport } from './apns.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const account = { project_id: 'easy-surfaces', client_email: 'push@easy-surfaces.iam.gserviceaccount.com', private_key: pem, token_uri: 'https://oauth2.googleapis.com/token' };
const config: FcmConfig = { projectId: 'easy-surfaces', clientEmail: account.client_email, privateKey: pem, tokenUri: account.token_uri };
const tokenOk: TokenFetcher = async () => ({ status: 200, text: JSON.stringify({ access_token: 'ya29.token', expires_in: 3600 }) });
beforeEach(() => forgetAccessToken());

/** A transport that answers by the registration token inside the request body. */
const scripted = (answers: Record<string, { status: number; text: string }>) => {
  const calls: { token: string; auth: string }[] = [];
  const t: FcmTransport = async ({ accessToken, body }) => {
    const token = (JSON.parse(body) as { message: { token: string } }).message.token;
    calls.push({ token, auth: accessToken });
    return answers[token] ?? { status: 200, text: '{}' };
  };
  return { t, calls };
};

describe('FCM settings', () => {
  it('is off without the key, reads the JSON, or the same JSON in base64, and refuses a broken one', () => {
    expect(fcmConfigFromEnv({})).toBeNull();
    expect(fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(account) } as never)).toMatchObject({ projectId: 'easy-surfaces', clientEmail: account.client_email });
    expect(fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: Buffer.from(JSON.stringify(account)).toString('base64') } as never)?.projectId).toBe('easy-surfaces');
    expect(fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...account, private_key: '' }) } as never)).toBeNull();
    expect(fcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_JSON: 'not json' } as never)).toBeNull();
  });
  it('signs an assertion Google can verify', () => {
    const jwt = assertionFor(config, 1_700_000_000_000);
    const [h, b, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(b, 'base64url').toString())).toMatchObject({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: account.token_uri, iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });
});

describe('FCM access token and messages', () => {
  it('asks Google once and reuses the token until shortly before it expires', async () => {
    let asked = 0;
    const fetcher: TokenFetcher = async (a) => { asked++; expect(a.assertion.split('.')).toHaveLength(3); return tokenOk(a); };
    expect(await accessTokenFor(config, 0, fetcher)).toBe('ya29.token');
    await accessTokenFor(config, 1_000, fetcher);
    expect(asked).toBe(1);
    await accessTokenFor(config, 3_400_000, fetcher);          // under 5 minutes left: renewed
    expect(asked).toBe(2);
  });
  it('throws when Google refuses the sign-in', async () => {
    await expect(accessTokenFor(config, 0, async () => ({ status: 400, text: '{"error":"invalid_grant"}' }))).rejects.toThrow(/refused/);
  });
  it('builds a visible notification with the path to open', () => {
    const m = JSON.parse(bodyFor('tok', { title: 'Easy Surfaces', body: 'Hi', path: '/sales' })).message;
    expect(m).toMatchObject({ token: 'tok', notification: { title: 'Easy Surfaces', body: 'Hi' }, data: { path: '/sales' }, android: { priority: 'HIGH', notification: { channel_id: 'default' } } });
    expect(JSON.parse(bodyFor('tok', { title: 't', body: 'b' })).message.data).toEqual({});
  });
  it('reads FCM answers: sent, dead token, or just failed', () => {
    expect(resultOf(200, '{}')).toMatchObject({ ok: true });
    expect(resultOf(404, JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }))).toMatchObject({ ok: false, dead: true, reason: 'UNREGISTERED' });
    expect(resultOf(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }))).toMatchObject({ dead: true });
    expect(resultOf(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload' } }))).toMatchObject({ dead: false });
    expect(resultOf(503, '{"error":{"status":"UNAVAILABLE"}}')).toMatchObject({ ok: false, dead: false, reason: 'UNAVAILABLE' });
  });
});

describe('sendToAndroid', () => {
  it('does nothing when off or with no phones', async () => {
    const { t, calls } = scripted({});
    expect(await sendToAndroid([{ token: 'a' }], { title: 't', body: 'b' }, { config: null, transport: t })).toEqual({ sent: 0, failed: 0, gone: [], reasons: [] });
    expect(await sendToAndroid([], { title: 't', body: 'b' }, { config, transport: t, tokenFetcher: tokenOk })).toMatchObject({ sent: 0 });
    expect(calls).toEqual([]);
  });
  it('counts sent and failed, and lists only dead tokens for removal', async () => {
    const { t, calls } = scripted({
      dead: { status: 404, text: JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) },
      flaky: { status: 503, text: '{"error":{"status":"UNAVAILABLE"}}' }
    });
    const r = await sendToAndroid([{ token: 'good' }, { token: 'dead' }, { token: 'flaky' }], { title: 't', body: 'b' }, { config, transport: t, tokenFetcher: tokenOk });
    expect(r).toMatchObject({ sent: 1, failed: 2, gone: ['dead'] });
    expect(calls.every(c => c.auth === 'ya29.token')).toBe(true);
  });
  it('fails them all, without throwing, when Google will not sign in', async () => {
    const { t } = scripted({});
    const r = await sendToAndroid([{ token: 'a' }, { token: 'b' }], { title: 't', body: 'b' }, { config, transport: t, tokenFetcher: async () => ({ status: 401, text: '{}' }) });
    expect(r).toMatchObject({ sent: 0, failed: 2 });
  });
});

describe('sendPushToUsers routes by platform', () => {
  const phones = [
    { id: '1', userId: 'u', token: 'apple1', environment: 'production', platform: 'ios' },
    { id: '2', userId: 'u', token: 'old-build', environment: 'production' },                  // saved before platforms existed
    { id: '3', userId: 'u', token: 'droid', environment: '', platform: 'android' },
    { id: '4', userId: 'u', token: 'dead', environment: '', platform: 'android' },
    { id: '5', userId: 'other', token: 'not-asked', environment: '', platform: 'android' }
  ];
  const store = () => { const removed: string[] = []; return { removed, store: { devicesFor: async (ids: string[]) => phones.filter(p => ids.includes(p.userId)), removeTokens: async (x: string[]) => { removed.push(...x); }, setEnvironment: async () => undefined } as never }; };
  const apnsConfig = { keyId: 'K', keyP8: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), teamId: 'T', topic: 'app.easysurfaces' };
  const apple: Transport & { sent: string[] } = Object.assign((async ({ token }: { token: string }) => { apple.sent.push(token); return { ok: true, status: 200, reason: '' }; }) as Transport, { sent: [] as string[] });

  it('sends each phone through its own service and removes only dead Android tokens', async () => {
    apple.sent.length = 0;
    const s = store();
    const fcm = scripted({ dead: { status: 404, text: JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) } });
    const r = await sendPushToUsers(['u'], { title: 't', body: 'b' }, { transport: apple, store: s.store, config: apnsConfig, fcm: { config, transport: fcm.t, tokenFetcher: tokenOk } });
    expect(apple.sent).toEqual(['apple1', 'old-build']);                      // a phone with no platform is an iPhone
    expect(fcm.calls.map(c => c.token)).toEqual(['droid', 'dead']);            // and the person who wasn't asked gets nothing
    expect(r).toMatchObject({ sent: 3, failed: 1, removed: 1, configured: true });
    expect(s.removed).toEqual(['dead']);
  });
  it('works for Android alone when Apple is not set up, and skips iPhones quietly', async () => {
    apple.sent.length = 0;
    const fcm = scripted({});
    const r = await sendPushToUsers(['u'], { title: 't', body: 'b' }, { transport: apple, store: store().store, config: null, fcm: { config, transport: fcm.t, tokenFetcher: tokenOk } });
    expect(apple.sent).toEqual([]);
    expect(r).toMatchObject({ sent: 2, failed: 0, configured: true });
  });
  it('is off and harmless when neither is set up', async () => {
    const fcm = scripted({});
    const r = await sendPushToUsers(['u'], { title: 't', body: 'b' }, { transport: apple, store: store().store, config: null, fcm: { config: null, transport: fcm.t } });
    expect(r).toMatchObject({ sent: 0, failed: 0, configured: false });
    expect(fcm.calls).toEqual([]);
  });
  it('reports push as configured when either service is', () => {
    const was = process.env.FCM_SERVICE_ACCOUNT_JSON;
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(account);
    expect(pushConfigured()).toBe(true);
    if (was === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON; else process.env.FCM_SERVICE_ACCOUNT_JSON = was;
  });
});
