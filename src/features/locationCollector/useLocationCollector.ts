import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import type { RawPoint } from '../../utils/locationTracking';
import {
  BATTERY_CHECK_MS, FLUSH_AT, HEARTBEAT_EVERY_MS, STILL_EVERY_MS, batteryCrossed, heartbeatBody, needsStillPoint,
  statusIsStale, FLUSH_EVERY_MS, STATUS_EVERY_MS, phaseFor, shouldKeep, takeBatch, toRawPoint, trimQueue,
  type Phase, type TrackingStatus
} from './collectorRules';
import { clearQueue, loadQueue, mergeQueues, saveQueue } from './pointQueue';
import { loadStatus, recordConsent, sendHeartbeat, sendPoints } from './collectorApi';
import { askAlways, clearDurable, currentPosition, insideReactNativeApp, phoneCollects, phoneDenied, startPhoneCollecting, stopPhoneCollecting, loadDurable, readDevice, saveDurable, startWatching, startWakeups, stopWakeups } from './backgroundLocation';

/**
 * Collects the phone's location for a tracked staff member, only inside the
 * 7 AM – 6 PM window (rules: collectorRules.ts, server: locationTracking.ts).
 * Does nothing outside the iOS / Android app, for suppliers or for a role
 * without `track_location`. Points queue on the phone and go in batches.
 */
export default function useLocationCollector(user: { id?: string; _id?: string; type?: string } | null | undefined) {
  const userId = String(user?.id || user?._id || '');
  const active = Capacitor.isNativePlatform() && user?.type === 'internal' && Boolean(userId);
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [denied, setDenied] = useState(false);
  // Inside the React Native app the PHONE collects and sends (mobile/src/collector), not this page: it works with the page suspended or
  // closed. `phone`: null = still asking, true = the phone collects (this page must not), false = this page collects (the Capacitor app,
  // or a React Native build whose phone can't). Until the phone answers this page collects nothing, so a point is never sent twice.
  const hosted = insideReactNativeApp();
  const [phone, setPhone] = useState<boolean | null>(hosted ? null : false);
  const pageCollects = phone === false;
  const [now, setNow] = useState(() => new Date());
  const queue = useRef<RawPoint[]>([]);
  const lastKept = useRef<number | null>(null);
  const flushing = useRef(false);

  /** Both copies of the unsent points: localStorage now, and the native file (on newer app builds) right behind it. */
  const persist = useCallback(() => {
    saveQueue(userId, queue.current);
    void saveDurable(userId, queue.current);
  }, [userId]);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await loadStatus()); } catch { /* keep the last answer; tried again soon */ }
  }, []);

  const flush = useCallback(async () => {
    if (!pageCollects || flushing.current || !queue.current.length) return;
    flushing.current = true;
    try {
      while (queue.current.length) {
        const { batch, rest } = takeBatch(queue.current);
        const result = await sendPoints(batch);
        if (result === 'retry') break;
        if (result === 'consent') { void refreshStatus(); break; }
        queue.current = result === 'off' ? [] : rest;
        persist();
        if (result === 'off') { void refreshStatus(); break; }
      }
    } finally { flushing.current = false; }
  }, [userId, refreshStatus, pageCollects]);

  // Sign-in: load this person's unsent points and consent; sign-out: forget them.
  useEffect(() => {
    if (!active) return undefined;
    queue.current = trimQueue(loadQueue(userId), Date.now());
    // The file the native plugin keeps survives a cleared web store and a killed app: join it in once it's read.
    let alive = true;
    void loadDurable(userId).then((saved) => {
      if (alive && saved.length) { queue.current = trimQueue(mergeQueues(queue.current, saved), Date.now()); persist(); }
    });
    void refreshStatus();
    const timer = setInterval(() => { setNow(new Date()); }, 30 * 1000);
    const statusTimer = setInterval(() => { void refreshStatus(); }, STATUS_EVERY_MS);
    const resume = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) { setNow(new Date()); void refreshStatus(); void flush(); } });
    return () => { alive = false; clearInterval(timer); clearInterval(statusTimer); void resume.then((h) => h.remove()); };
  }, [active, userId, refreshStatus, flush, persist]);

  // The day rolled over since the server last answered: ask again (time off or weekend work may differ).
  useEffect(() => { if (active && statusIsStale(status, now)) void refreshStatus(); }, [active, status, now, refreshStatus]);

  const phase: Phase = active ? phaseFor({ status, denied, now }) : 'off';

  // Watch while running; a final send when the window closes.
  useEffect(() => {
    if (!pageCollects) return undefined;                                  // the phone collects (React Native app)
    if (phase !== 'running') { void flush(); return undefined; }
    let stop: (() => Promise<void>) | null = null; let cancelled = false;
    startWatching(
      (loc) => {
        const point = toRawPoint(loc, Math.random().toString(36).slice(2, 8));
        const at = Number(loc.time);
        if (!point || !shouldKeep(lastKept.current, at)) return;
        lastKept.current = at;
        queue.current = trimQueue([...queue.current, point], Date.now());
        persist();
        if (queue.current.length >= FLUSH_AT) void flush();
      },
      () => setDenied(true)
    ).then((s) => { if (cancelled) void s(); else stop = s; }).catch(() => setDenied(true));
    const timer = setInterval(() => { void flush(); }, FLUSH_EVERY_MS);
    return () => { cancelled = true; clearInterval(timer); if (stop) void stop(); };
  }, [phase, userId, flush, pageCollects]);

  // What the phone says about itself: on start, every 5 minutes, and at once when the battery falls to 15% / 5%
  // (so a manager can see "Battery 3% at 2:14 PM" instead of an unexplained silence). Also while location is denied.
  const beat = useCallback(async () => {
    const device = await readDevice();
    void sendHeartbeat(heartbeatBody(device, queue.current.length, new Date()));
    return device;
  }, []);
  useEffect(() => {
    if (!pageCollects || (phase !== 'running' && phase !== 'denied')) return undefined;
    let battery: number | null = null; let cancelled = false;
    void beat().then((d) => { if (!cancelled) battery = d.batteryPct; });
    const every = setInterval(() => { void beat(); }, HEARTBEAT_EVERY_MS);
    const watch = setInterval(() => {
      void readDevice().then((d) => {
        if (cancelled) return;
        const crossed = batteryCrossed(battery, d.batteryPct, d.charging);
        battery = d.batteryPct;
        if (crossed) { void flush(); void beat(); }   // get everything off the phone while it still can
      });
    }, BATTERY_CHECK_MS);
    return () => { cancelled = true; clearInterval(every); clearInterval(watch); };
  }, [phase, beat, flush, pageCollects]);

  // "Still here": the watcher only fires on movement, so a phone sitting in a showroom sends nothing. Read one position
  // when none was kept for 5 minutes, so a gap on the map means missing data, not a person who didn't move.
  useEffect(() => {
    if (!pageCollects || phase !== 'running') return undefined;
    let busy = false;
    const check = async () => {
      if (busy || !needsStillPoint(lastKept.current, Date.now())) return;
      busy = true;
      try {
        const here = await currentPosition();
        if (!here) return;
        const at = Date.now();
        const point = toRawPoint({ latitude: here.lat, longitude: here.lng, accuracy: here.accuracy, time: at }, Math.random().toString(36).slice(2, 8));
        if (!point || !needsStillPoint(lastKept.current, at)) return;
        lastKept.current = at;
        queue.current = trimQueue([...queue.current, point], at);
        persist();
      } finally { busy = false; }
    };
    const timer = setInterval(() => { void check(); }, Math.min(STILL_EVERY_MS, 60 * 1000));
    return () => clearInterval(timer);
  }, [phase, userId, pageCollects]);

  // A different person on this phone: drop what belongs to the last one (both copies).
  useEffect(() => { if (!userId) { clearQueue(); void clearDurable(); } }, [userId]);

  // Wake-ups: while this person is tracked and has agreed, ask iOS to relaunch the app when the phone moves, even after the
  // app was force-quit (needs "Always"); stop when they aren't tracked or haven't agreed. Older app builds ignore it.
  useEffect(() => {
    if (!active || !pageCollects) return;
    if (phase === 'running' || phase === 'waiting' || phase === 'denied') void startWakeups();
    else void stopWakeups();
  }, [active, phase, pageCollects]);

  // React Native app: ask the phone whether it collects by itself; then switch it on and off with the phase, and mirror its permission.
  useEffect(() => {
    if (!active || !hosted) return undefined;
    let alive = true;
    void phoneCollects().then((yes) => { if (alive) setPhone(yes); });
    return () => { alive = false; };
  }, [active, hosted]);
  useEffect(() => {
    if (!active || phone !== true) return;
    // Tracked and agreed: the phone collects (it asks for location the first time) and sends; otherwise it stops.
    if (phase === 'running' || phase === 'waiting') void startPhoneCollecting(userId).then((r) => { if (r.denied) setDenied(true); });
    else if (phase === 'off' || phase === 'needs-consent') void stopPhoneCollecting();
  }, [active, phone, phase, userId]);
  useEffect(() => { if (hosted && !userId) void stopPhoneCollecting(); }, [hosted, userId]);
  useEffect(() => {
    if (!active || phone !== true) return undefined;
    const timer = setInterval(() => { void phoneDenied().then((d) => setDenied(d)); }, 60 * 1000);
    return () => clearInterval(timer);
  }, [active, phone]);

  // Allow: saved on the server first; collecting starts when the server's answer says so.
  const consent = useCallback(async () => {
    setSaving(true); setConsentError('');
    try {
      await recordConsent(); setDenied(false);
      // Android asks for "Allow all the time" as its own step; the disclosure above has just been shown, as Google Play requires.
      if (Capacitor.getPlatform() === 'android') await askAlways();
      await refreshStatus();
    }
    catch (e) { setConsentError((e as Error).message); }
    finally { setSaving(false); }
  }, [refreshStatus]);
  const retryAfterSettings = useCallback(() => setDenied(false), []);

  return { phase, status, consent, saving, consentError, retryAfterSettings };
}
