import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as api from '../collector/api';
import { authorization } from '../collector/device';
import { collectorState, startCollecting } from '../collector/nativeCollector';
import { answerLocateRequests } from '../locate/answerNow';

const LOOK_EVERY_MS = 60 * 1000;

/**
 * What the phone itself decides about location tracking, with no page: does this person have to agree (tracked, no agreement on
 * the server for the current wording), is collecting switched on once they have, and has the phone's location permission been
 * turned off. Looks when it starts, every minute and whenever the app comes to the front. The website draws nothing of this in the
 * app (`phoneOwns` in useLocationCollector); the rules (window, who is tracked) stay the server's.
 */
export function useLocationConsent(active: boolean) {
  const [needsConsent, setNeedsConsent] = useState(false);
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const looking = useRef(false);

  const look = useCallback(async () => {
    if (looking.current) return;
    looking.current = true;
    try {
      const answer = await api.loadStatus();
      if (answer.kind !== 'status') { setNeedsConsent(false); setDenied(false); return; }
      const { tracked, consented } = answer.status;
      setNeedsConsent(tracked && !consented);
      if (!tracked || !consented) { setDenied(false); return; }
      // Agreed: make sure the phone is collecting (the first time on a new phone this asks for location), and watch the permission.
      if (!collectorState().enabled) {
        const me = await api.whoAmI();
        if (me) await startCollecting(me);
      }
      setDenied((await authorization()) === 'denied');
    } catch { /* no signal: look again later */ }
    finally { looking.current = false; }
  }, []);

  useEffect(() => {
    if (!active) { setNeedsConsent(false); setDenied(false); return undefined; }
    void look();
    const timer = setInterval(() => { void look(); }, LOOK_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void look(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [active, look]);

  /** Allow: saved on the server first, then collecting starts (and the phone asks for location). */
  const allow = useCallback(async () => {
    setSaving(true); setError('');
    try {
      await api.recordConsent();
      const me = await api.whoAmI();
      if (me) await startCollecting(me);
      setNeedsConsent(false);
      await look();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }, [look]);

  return { needsConsent, denied, saving, error, allow };
}
