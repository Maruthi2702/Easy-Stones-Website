import { createSign } from 'node:crypto';

/**
 * Push notifications to the Android app through Firebase Cloud Messaging (2026-11-22; the iOS twin is apns.ts), with no extra package:
 * a service-account JWT (RS256, Node's crypto) is exchanged for a short-lived access token, then each message goes to the FCM HTTP v1
 * API with `fetch`.
 *
 * Needs on the server: FCM_SERVICE_ACCOUNT_JSON — the Firebase service-account key file's text (or the same text base64-encoded, which
 * is easier to paste into Render). Without it `fcmConfigured()` is false and a send does nothing: the site never fails because
 * Android push isn't set up. A token FCM calls dead (404 / UNREGISTERED, or INVALID_ARGUMENT naming the token) is reported so the
 * caller deletes it.
 */
export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string; tokenUri: string };
export type FcmMessage = { title: string; body: string; /** An in-app path to open on tap, e.g. '/sales'. */ path?: string };
export type FcmResult = { ok: boolean; status: number; reason: string; dead: boolean };
export type FcmTransport = (a: { accessToken: string; projectId: string; body: string }) => Promise<{ status: number; text: string }>;
export type TokenFetcher = (a: { tokenUri: string; assertion: string }) => Promise<{ status: number; text: string }>;

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** The service account from the environment, or null (off). Accepts the JSON text or that text base64-encoded. */
export function fcmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FcmConfig | null {
  const raw = (env.FCM_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  let text = raw;
  if (!raw.startsWith('{')) { try { text = Buffer.from(raw, 'base64').toString('utf8'); } catch { return null; } }
  try {
    const j = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string; token_uri?: string };
    const privateKey = String(j.private_key || '').replace(/\\n/g, '\n').trim();
    if (!j.project_id || !j.client_email || !privateKey) return null;
    return { projectId: j.project_id, clientEmail: j.client_email, privateKey, tokenUri: j.token_uri || 'https://oauth2.googleapis.com/token' };
  } catch { return null; }
}
export const fcmConfigured = () => fcmConfigFromEnv() !== null;

/** The signed assertion Google exchanges for an access token (valid one hour). */
export function assertionFor(c: FcmConfig, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: c.clientEmail, scope: SCOPE, aud: c.tokenUri, iat, exp: iat + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(c.privateKey);
  return `${head}.${body}.${b64(sig)}`;
}

const httpTokenFetcher: TokenFetcher = async ({ tokenUri, assertion }) => {
  const res = await fetch(tokenUri, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(10_000)
  });
  return { status: res.status, text: await res.text() };
};

export const httpTransport: FcmTransport = async ({ accessToken, projectId, body }) => {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000)
  });
  return { status: res.status, text: await res.text() };
};

let cached: { token: string; expiresAt: number; key: string } | null = null;
/** An access token, reused until a few minutes before it expires. */
export async function accessTokenFor(c: FcmConfig, nowMs: number, fetcher: TokenFetcher = httpTokenFetcher): Promise<string> {
  const key = `${c.clientEmail}|${c.projectId}`;
  if (cached && cached.key === key && cached.expiresAt - nowMs > 5 * 60_000) return cached.token;
  const { status, text } = await fetcher({ tokenUri: c.tokenUri, assertion: assertionFor(c, nowMs) });
  let j: { access_token?: string; expires_in?: number } = {};
  try { j = JSON.parse(text || '{}'); } catch { /* not JSON */ }
  if (status !== 200 || !j.access_token) throw new Error(`Google refused the FCM sign-in (${status})`);
  cached = { token: j.access_token, expiresAt: nowMs + (j.expires_in ?? 3600) * 1000, key };
  return j.access_token;
}
export const forgetAccessToken = () => { cached = null; };

/** The FCM v1 request body: a visible notification (shown by the system when the app is closed) plus the path to open on tap. */
export function bodyFor(token: string, m: FcmMessage): string {
  return JSON.stringify({
    message: {
      token,
      notification: { title: m.title.slice(0, 80), body: m.body.slice(0, 240) },
      data: m.path ? { path: m.path } : {},
      android: { priority: 'HIGH', notification: { channel_id: 'default' } }
    }
  });
}

/** What FCM answered, as the caller needs it: sent, or why not, and whether the token is dead for good. */
export function resultOf(status: number, text: string): FcmResult {
  if (status === 200) return { ok: true, status, reason: '', dead: false };
  let code = ''; let message = '';
  try {
    const e = (JSON.parse(text || '{}') as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } }).error;
    code = e?.details?.find(d => d.errorCode)?.errorCode || e?.status || ''; message = e?.message || '';
  } catch { /* no body */ }
  const dead = status === 404 || code === 'UNREGISTERED' || (code === 'INVALID_ARGUMENT' && /registration token/i.test(message));
  return { ok: false, status, reason: code || message || 'error', dead };
}

export type AndroidPhone = { token: string };
export type FcmSummary = { sent: number; failed: number; gone: string[]; reasons: string[] };

/** Sends to each Android phone. Never throws. `config` null = off (nothing sent, nothing failed). */
export async function sendToAndroid(
  phones: AndroidPhone[], message: FcmMessage,
  { config = fcmConfigFromEnv(), transport = httpTransport, tokenFetcher, now = () => Date.now() }:
  { config?: FcmConfig | null; transport?: FcmTransport; tokenFetcher?: TokenFetcher; now?: () => number } = {}
): Promise<FcmSummary> {
  const out: FcmSummary = { sent: 0, failed: 0, gone: [], reasons: [] };
  if (!config || !phones.length) return out;
  let accessToken: string;
  try { accessToken = await accessTokenFor(config, now(), tokenFetcher); }
  catch (e) { out.failed = phones.length; out.reasons.push((e as Error).message); console.warn('FCM sign-in failed:', (e as Error).message); return out; }
  for (const p of phones) {
    let r: FcmResult;
    try { const a = await transport({ accessToken, projectId: config.projectId, body: bodyFor(p.token, message) }); r = resultOf(a.status, a.text); }
    catch (e) { r = { ok: false, status: 0, reason: `request: ${(e as Error).message}`, dead: false }; }
    if (r.ok) { out.sent++; continue; }
    out.failed++; out.reasons.push(`${r.status} ${r.reason}`.trim());
    console.warn('FCM refused a push:', r.status, r.reason);
    if (r.dead) out.gone.push(p.token);
  }
  return out;
}
