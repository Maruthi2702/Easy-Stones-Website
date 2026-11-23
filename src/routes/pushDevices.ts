import type { Request, RequestHandler, Response } from 'express';
import express from 'express';
import * as deviceStore from '../db/pushDevices/index.ts';
import { pushConfigured, sendPushToUsers, type PushMessage, type SendSummary } from '../services/apns.ts';

/**
 * The iOS app's push devices (2026-11-19; sender in src/services/apns.ts).
 *
 *   POST   /api/push-devices        { token, platform? }  — this phone's token for the signed-in person (replaces whoever had it).
 *                                   platform 'android' = a Firebase (FCM) token; missing or anything else = 'ios' (an APNs token), so
 *                                   app builds from before Android keep working
 *   DELETE /api/push-devices        { token, platform? }  — sign-out: stop pushes to this phone (only if it's the caller's)
 *   POST   /api/push-devices/test              — sends the caller a test notification (optional { message }); says whether push is set up
 *
 * Staff only (the caller passes the same guard as the other Sales routes), and
 * a person only ever registers, removes or tests their own phones.
 */
type Store = Pick<typeof deviceStore, 'saveDevice' | 'removeToken'> & Partial<Pick<typeof deviceStore, 'devicesFor'>>;
type Send = (userIds: string[], m: PushMessage) => Promise<SendSummary>;

export const isDeviceToken = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32,200}$/i.test(v);
/** An FCM registration token: letters, digits, `:`, `_`, `-`; case matters, so it is never lower-cased. */
export const isFcmToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9:_-]{32,4096}$/.test(v);
const platformOf = (v: unknown): 'ios' | 'android' => (v === 'android' ? 'android' : 'ios');
/** The token as it is stored: Apple's is lower-cased hex, Firebase's is kept exactly. Null when it isn't a token of that platform. */
export function storedToken(token: unknown, platform: 'ios' | 'android'): string | null {
  if (platform === 'android') return isFcmToken(token) ? token : null;
  return isDeviceToken(token) ? token.toLowerCase() : null;
}

export default function createPushDevicesRouter(
  { guard, store = deviceStore, send = sendPushToUsers, configured = pushConfigured }:
  { guard: RequestHandler | RequestHandler[]; store?: Store; send?: Send; configured?: () => boolean }
) {
  const router = express.Router();
  const who = (req: Request) => String(req.userId || '');

  router.post('/', guard, async (req: Request, res: Response) => {
    const platform = platformOf(req.body?.platform);
    const token = storedToken(req.body?.token, platform);
    if (!who(req) || !token) return res.status(400).json({ message: 'A device token is needed.' });
    try { await store.saveDevice(who(req), token, platform); res.json({ ok: true }); }
    catch (e) { console.error('Push device save error:', e); res.status(500).json({ message: 'Could not save this phone.' }); }
  });

  router.delete('/', guard, async (req: Request, res: Response) => {
    const token = storedToken(req.body?.token, platformOf(req.body?.platform));
    if (!who(req) || !token) return res.status(400).json({ message: 'A device token is needed.' });
    try { await store.removeToken(token, who(req)); res.json({ ok: true }); }
    catch (e) { console.error('Push device remove error:', e); res.status(500).json({ message: 'Could not remove this phone.' }); }
  });

  router.post('/test', guard, async (req: Request, res: Response) => {
    if (!configured()) return res.status(503).json({ message: 'Push notifications are not set up on the server yet.', configured: false });
    // An optional `message` (up to 120 characters) replaces the default text, so a test can say something specific.
    const custom = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 120) : '';
    const result = await send([who(req)], { title: 'Easy Surfaces', body: custom || 'Notifications are working on this phone.', path: '/sales' });
    // Which phones the server holds for the caller (last 6 of each token + the side Apple took it on, or Firebase for Android), to chase a
    // notification that was accepted but never showed.
    const phones = store.devicesFor ? await store.devicesFor([who(req)]).catch(() => []) : [];
    res.json({ ...result, phones: phones.map(p => ({ token: `…${p.token.slice(-6)}`, platform: p.platform || 'ios', environment: p.platform === 'android' ? 'firebase' : p.environment || 'not yet known' })) });
  });

  return router;
}
