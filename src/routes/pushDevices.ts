import type { Request, RequestHandler, Response } from 'express';
import express from 'express';
import * as deviceStore from '../db/pushDevices/index.ts';
import { pushConfigured, sendPushToUsers, type PushMessage, type SendSummary } from '../services/apns.ts';

/**
 * The iOS app's push devices (2026-11-19; sender in src/services/apns.ts).
 *
 *   POST   /api/push-devices        { token }  — this phone's APNs token, for the signed-in person (replaces whoever had it)
 *   DELETE /api/push-devices        { token }  — sign-out: stop pushes to this phone (only if it's the caller's)
 *   POST   /api/push-devices/test              — sends the caller a test notification; says whether push is set up
 *
 * Staff only (the caller passes the same guard as the other Sales routes), and
 * a person only ever registers, removes or tests their own phones.
 */
type Store = Pick<typeof deviceStore, 'saveDevice' | 'removeToken'> & Partial<Pick<typeof deviceStore, 'devicesFor'>>;
type Send = (userIds: string[], m: PushMessage) => Promise<SendSummary>;

export const isDeviceToken = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32,200}$/i.test(v);

export default function createPushDevicesRouter(
  { guard, store = deviceStore, send = sendPushToUsers, configured = pushConfigured }:
  { guard: RequestHandler | RequestHandler[]; store?: Store; send?: Send; configured?: () => boolean }
) {
  const router = express.Router();
  const who = (req: Request) => String(req.userId || '');

  router.post('/', guard, async (req: Request, res: Response) => {
    const token = req.body?.token;
    if (!who(req) || !isDeviceToken(token)) return res.status(400).json({ message: 'A device token is needed.' });
    try { await store.saveDevice(who(req), token.toLowerCase()); res.json({ ok: true }); }
    catch (e) { console.error('Push device save error:', e); res.status(500).json({ message: 'Could not save this phone.' }); }
  });

  router.delete('/', guard, async (req: Request, res: Response) => {
    const token = req.body?.token;
    if (!who(req) || !isDeviceToken(token)) return res.status(400).json({ message: 'A device token is needed.' });
    try { await store.removeToken(token.toLowerCase(), who(req)); res.json({ ok: true }); }
    catch (e) { console.error('Push device remove error:', e); res.status(500).json({ message: 'Could not remove this phone.' }); }
  });

  router.post('/test', guard, async (req: Request, res: Response) => {
    if (!configured()) return res.status(503).json({ message: 'Push notifications are not set up on the server yet.', configured: false });
    const result = await send([who(req)], { title: 'Easy Surfaces', body: 'Notifications are working on this phone.', path: '/sales' });
    // Which phones the server holds for the caller (last 6 of each token + the side Apple took it on), to chase a
    // notification that was accepted but never showed.
    const phones = store.devicesFor ? await store.devicesFor([who(req)]).catch(() => []) : [];
    res.json({ ...result, phones: phones.map(p => ({ token: `…${p.token.slice(-6)}`, environment: p.environment || 'not yet known' })) });
  });

  return router;
}
