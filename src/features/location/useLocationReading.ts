import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetLocationOk, locationPermission, rememberPosition } from '../../utils/geolocationAccess.ts';
import type { LocationReading } from '../../utils/visitLocation.ts';
import { readOnce } from './readPosition.ts';

/**
 * The reading a new visit or resource must carry (owner, 2026-11-19: every one,
 * no exceptions). Starts when the form opens, so it's usually there before the
 * notes are typed.
 *
 *   reading  looking (the form can be filled, Save is locked)
 *   slow     15 s passed: still looking, "Try again" shows
 *   ready    have it; Save unlocks
 *   blocked  the browser says no (or can't do location): the form is replaced by
 *            the steps to turn it on, and re-checks when the person comes back
 *
 * A reading older than about 12 minutes is refreshed in the background while the
 * form stays open (the server refuses one over 15).
 */
export type LocationStatus = 'reading' | 'slow' | 'ready' | 'blocked';
export interface LocationState { status: LocationStatus; reading: LocationReading | null; retry: () => void }

const REFRESH_MS = 4 * 60 * 1000;
const TOO_OLD_MS = 12 * 60 * 1000;

export function useLocationReading(enabled = true): LocationState {
  const [status, setStatus] = useState<LocationStatus>('reading');
  const [reading, setReading] = useState<LocationReading | null>(null);
  const alive = useRef(true);
  const latest = useRef<LocationReading | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const attempt = useCallback(async (quiet = false) => {
    if (!quiet) setStatus('reading');
    const done = (r: LocationReading) => {
      if (!alive.current) return;
      latest.current = r; setReading(r); setStatus('ready'); rememberPosition({ lat: r.lat, lng: r.lng });
    };
    const fail = (code: number) => {
      if (!alive.current) return;
      if (code === 1 || code === 0) { forgetLocationOk(); latest.current = null; setReading(null); setStatus('blocked'); return; }
      const old = latest.current && Date.now() - latest.current.takenAtMs > TOO_OLD_MS;
      if (!quiet || old) setStatus('slow');
    };
    const slowTimer = quiet ? null : setTimeout(() => { if (alive.current) setStatus((s) => (s === 'reading' ? 'slow' : s)); }, 15000);
    try {
      done(await readOnce({ highAccuracy: true, timeoutMs: 15000 }));
    } catch (e1) {
      const code = (e1 as { code?: number })?.code ?? 2;
      if (code === 1 || code === 0) fail(code);
      else {
        // The strong fix timed out (indoors, or a computer): take whatever the device can give.
        try { done(await readOnce({ highAccuracy: false, timeoutMs: 30000 })); } catch (e2) { fail((e2 as { code?: number })?.code ?? 2); }
      }
    } finally { if (slowTimer) clearTimeout(slowTimer); }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let permission: PermissionStatus | null = null;
    let cancelled = false;
    void (async () => {
      const state = await locationPermission();
      if (cancelled) return;
      if (state === 'denied') { setStatus('blocked'); } else { void attempt(); }
      try {
        permission = await navigator.permissions.query({ name: 'geolocation' });
        if (cancelled) return;
        permission.onchange = () => {
          if (!permission) return;
          if (permission.state === 'denied') { latest.current = null; setReading(null); setStatus('blocked'); } else if (permission.state === 'granted') void attempt();
        };
      } catch { /* a browser that can't say: the reading's own result decides */ }
    })();
    const timer = setInterval(() => { void attempt(true); }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); if (permission) permission.onchange = null; };
  }, [enabled, attempt]);

  const retry = useCallback(() => { void attempt(); }, [attempt]);
  return enabled ? { status, reading, retry } : { status: 'ready', reading: null, retry };
}
