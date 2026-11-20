import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import type { RawPoint } from '../../utils/locationTracking';
import {
  FLUSH_AT, statusIsStale, FLUSH_EVERY_MS, STATUS_EVERY_MS, phaseFor, shouldKeep, takeBatch, toRawPoint, trimQueue,
  type Phase, type TrackingStatus
} from './collectorRules';
import { clearQueue, loadQueue, saveQueue } from './pointQueue';
import { loadStatus, recordConsent, sendPoints } from './collectorApi';
import { startWatching } from './backgroundLocation';

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
  const [now, setNow] = useState(() => new Date());
  const queue = useRef<RawPoint[]>([]);
  const lastKept = useRef<number | null>(null);
  const flushing = useRef(false);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await loadStatus()); } catch { /* keep the last answer; tried again soon */ }
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || !queue.current.length) return;
    flushing.current = true;
    try {
      while (queue.current.length) {
        const { batch, rest } = takeBatch(queue.current);
        const result = await sendPoints(batch);
        if (result === 'retry') break;
        if (result === 'consent') { void refreshStatus(); break; }
        queue.current = result === 'off' ? [] : rest;
        saveQueue(userId, queue.current);
        if (result === 'off') { void refreshStatus(); break; }
      }
    } finally { flushing.current = false; }
  }, [userId, refreshStatus]);

  // Sign-in: load this person's unsent points and consent; sign-out: forget them.
  useEffect(() => {
    if (!active) return undefined;
    queue.current = trimQueue(loadQueue(userId), Date.now());
    void refreshStatus();
    const timer = setInterval(() => { setNow(new Date()); }, 30 * 1000);
    const statusTimer = setInterval(() => { void refreshStatus(); }, STATUS_EVERY_MS);
    const resume = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) { setNow(new Date()); void refreshStatus(); void flush(); } });
    return () => { clearInterval(timer); clearInterval(statusTimer); void resume.then((h) => h.remove()); };
  }, [active, userId, refreshStatus, flush]);

  // The day rolled over since the server last answered: ask again (time off or weekend work may differ).
  useEffect(() => { if (active && statusIsStale(status, now)) void refreshStatus(); }, [active, status, now, refreshStatus]);

  const phase: Phase = active ? phaseFor({ status, denied, now }) : 'off';

  // Watch while running; a final send when the window closes.
  useEffect(() => {
    if (phase !== 'running') { void flush(); return undefined; }
    let stop: (() => Promise<void>) | null = null; let cancelled = false;
    startWatching(
      (loc) => {
        const point = toRawPoint(loc, Math.random().toString(36).slice(2, 8));
        const at = Number(loc.time);
        if (!point || !shouldKeep(lastKept.current, at)) return;
        lastKept.current = at;
        queue.current = trimQueue([...queue.current, point], Date.now());
        saveQueue(userId, queue.current);
        if (queue.current.length >= FLUSH_AT) void flush();
      },
      () => setDenied(true)
    ).then((s) => { if (cancelled) void s(); else stop = s; }).catch(() => setDenied(true));
    const timer = setInterval(() => { void flush(); }, FLUSH_EVERY_MS);
    return () => { cancelled = true; clearInterval(timer); if (stop) void stop(); };
  }, [phase, userId, flush]);

  // A different person on this phone: drop what belongs to the last one.
  useEffect(() => { if (!userId) clearQueue(); }, [userId]);

  // Allow: saved on the server first; collecting starts when the server's answer says so.
  const consent = useCallback(async () => {
    setSaving(true); setConsentError('');
    try { await recordConsent(); setDenied(false); await refreshStatus(); }
    catch (e) { setConsentError((e as Error).message); }
    finally { setSaving(false); }
  }, [refreshStatus]);
  const retryAfterSettings = useCallback(() => setDenied(false), []);

  return { phase, status, consent, saving, consentError, retryAfterSettings };
}
