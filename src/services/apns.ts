import { createPrivateKey, sign } from 'node:crypto';
import { connect } from 'node:http2';
import { IOS_BUNDLE_ID, IOS_TEAM_ID } from '../utils/appLinks.ts';
import * as deviceStore from '../db/pushDevices/index.ts';

/**
 * Push notifications to the iOS app through Apple's APNs (2026-11-19), with no
 * extra package: a token signed with the .p8 key (ES256) and Node's HTTP/2.
 *
 * Needs on the server: APNS_KEY_ID, APNS_KEY_P8 (the file's text; "\n" typed as
 * backslash-n is fine) and optionally APNS_TEAM_ID / APNS_TOPIC (default: the
 * app's). Without them `pushConfigured()` is false and a send does nothing —
 * the website never fails because push isn't set up.
 *
 * A phone's token is for Apple's sandbox (an Xcode build) or production
 * (TestFlight / App Store), and the app can't tell which, so a token with no
 * saved environment is tried on production, then sandbox, and the answer is kept.
 * A token Apple calls dead (410, Unregistered, BadDeviceToken on both) is deleted.
 */
export type PushMessage = { title: string; body: string; /** An in-app path to open on tap, e.g. '/sales'. */ path?: string; badge?: number };
export type SendResult = { ok: boolean; status: number; reason: string };
export type Transport = (a: { token: string; environment: 'production' | 'sandbox'; jwt: string; topic: string; payload: string }) => Promise<SendResult>;
export type ApnsConfig = { keyId: string; keyP8: string; teamId: string; topic: string };

const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const keyId = (env.APNS_KEY_ID || '').trim();
  const keyP8 = (env.APNS_KEY_P8 || '').replace(/\\n/g, '\n').trim();
  if (!keyId || !keyP8) return null;
  return { keyId, keyP8, teamId: (env.APNS_TEAM_ID || IOS_TEAM_ID).trim(), topic: (env.APNS_TOPIC || IOS_BUNDLE_ID).trim() };
}
export const pushConfigured = () => configFromEnv() !== null;

/** The provider token Apple wants (valid 20–60 minutes; we reuse one for 40). */
export function providerToken(c: ApnsConfig, nowMs: number): string {
  const head = b64(JSON.stringify({ alg: 'ES256', kid: c.keyId }));
  const body = b64(JSON.stringify({ iss: c.teamId, iat: Math.floor(nowMs / 1000) }));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(c.keyP8), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64(sig)}`;
}
let cached: { jwt: string; at: number; key: string } | null = null;
function jwtFor(c: ApnsConfig, nowMs: number): string {
  const key = `${c.keyId}|${c.teamId}|${c.keyP8.length}`;
  if (!cached || cached.key !== key || nowMs - cached.at > 40 * 60_000) cached = { jwt: providerToken(c, nowMs), at: nowMs, key };
  return cached.jwt;
}

export function payloadFor(m: PushMessage): string {
  const aps: Record<string, unknown> = { alert: { title: m.title.slice(0, 80), body: m.body.slice(0, 240) }, sound: 'default' };
  if (typeof m.badge === 'number') aps.badge = m.badge;
  return JSON.stringify({ aps, ...(m.path ? { path: m.path } : {}) });
}

export const httpTransport: Transport = ({ token, environment, jwt, topic, payload }) => new Promise(resolve => {
  const host = environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const session = connect(host);
  const done = (r: SendResult) => { try { session.close(); } catch { /* already closed */ } resolve(r); };
  session.on('error', e => done({ ok: false, status: 0, reason: `connection: ${e.message}` }));
  const req = session.request({
    ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${jwt}`,
    'apns-topic': topic, 'apns-push-type': 'alert', 'apns-priority': '10'
  });
  let status = 0; let text = '';
  req.setEncoding('utf8');
  req.on('response', h => { status = Number(h[':status']) || 0; });
  req.on('data', c => { text += c; });
  req.on('end', () => {
    let reason = '';
    try { reason = JSON.parse(text || '{}').reason || ''; } catch { /* no body */ }
    done({ ok: status === 200, status, reason });
  });
  req.on('error', e => done({ ok: false, status: 0, reason: `request: ${e.message}` }));
  req.setTimeout(10_000, () => { req.close(); done({ ok: false, status: 0, reason: 'timeout' }); });
  req.end(payload);
});

const dead = (r: SendResult) => r.status === 410 || r.reason === 'Unregistered';
const wrongEnvironment = (r: SendResult) => r.reason === 'BadDeviceToken' || r.reason === 'DeviceTokenNotForTopic';

type Store = Pick<typeof deviceStore, 'devicesFor' | 'removeTokens' | 'setEnvironment'>;
export type SendSummary = { sent: number; failed: number; removed: number; configured: boolean; reasons?: string[] };

/** Sends to every phone of the given people. Never throws: push is a nicety, not part of any save. */
export async function sendPushToUsers(
  userIds: string[], message: PushMessage,
  { transport = httpTransport, store = deviceStore, config = configFromEnv(), now = () => Date.now() }:
  { transport?: Transport; store?: Store; config?: ApnsConfig | null; now?: () => number } = {}
): Promise<SendSummary> {
  const out: SendSummary = { sent: 0, failed: 0, removed: 0, configured: Boolean(config) };
  if (!config || !userIds.length) return out;
  try {
    const phones = await store.devicesFor(userIds);
    const payload = payloadFor(message);
    const gone: string[] = [];
    for (const p of phones) {
      const jwt = jwtFor(config, now());
      const order: ('production' | 'sandbox')[] = p.environment === 'sandbox' ? ['sandbox'] : p.environment === 'production' ? ['production'] : ['production', 'sandbox'];
      let last: SendResult = { ok: false, status: 0, reason: '' };
      for (const environment of order) {
        last = await transport({ token: p.token, environment, jwt, topic: config.topic, payload });
        if (last.ok) { if (!p.environment) await store.setEnvironment(p.token, environment); break; }
        if (dead(last) || !wrongEnvironment(last)) break;
      }
      if (last.ok) out.sent++;
      else { out.failed++; (out.reasons ||= []).push(`${last.status} ${last.reason}`.trim()); console.warn('APNs refused a push:', last.status, last.reason); if (dead(last) || (wrongEnvironment(last) && !p.environment)) gone.push(p.token); }
    }
    await store.removeTokens(gone);
    out.removed = gone.length;
  } catch (e) { console.error('Push send error:', e); }
  return out;
}
