import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { locationPermission, locationWasOk, rememberPosition } from '../../utils/geolocationAccess';
import { readOnce } from './readPosition';
import './Location.css';

const SEEN_KEY = 'loc_gate_seen';
const seen = (): boolean => { try { return window.sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { window.sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private window: it may ask again */ } };

/**
 * The sheet that asks for location when staff open the app (owner, 2026-11-19), so
 * it's already allowed by the time someone adds a visit or a resource. The browser's
 * permission belongs to the whole site: once allowed, every screen reads silently and
 * this never shows again. It opens only when the browser hasn't been asked yet, and
 * the browser's own prompt follows a tap here (some browsers ignore a prompt nobody
 * tapped for). "Not now" hides it for this visit to the app; Add visit and Add resource
 * still need location and say how to turn it on.
 */
export default function LocationGate() {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (seen()) return undefined;
    let cancelled = false;
    void locationPermission().then((state) => {
      if (cancelled) return;
      if (state === 'prompt' || (state === 'unknown' && !locationWasOk())) setOpen(true);
    });
    return () => { cancelled = true; };
  }, []);

  if (!open) return null;
  const close = () => { markSeen(); setOpen(false); };
  const allow = async () => {
    setAsking(true);
    try {
      const r = await readOnce({ highAccuracy: false, timeoutMs: 20000 });
      rememberPosition({ lat: r.lat, lng: r.lng });
    } catch { /* refused or slow: the forms explain it when it matters */ }
    close();
  };

  return (
    <div className="fm-tokens">
      <div className="fm-sheet-backdrop loc-gate-backdrop" onClick={close} aria-hidden="true" />
      <div className="fm-sheet loc-gate" role="dialog" aria-modal="true" aria-labelledby="loc-gate-title">
        <div className="loc-gate-body">
          <span className="loc-big"><MapPin size={22} aria-hidden="true" /></span>
          <h3 id="loc-gate-title">Allow location</h3>
          <ul>
            <li>Every visit and resource you add records where you are.</li>
            <li>Only at that moment. Never in the background, never between visits.</li>
            <li>You and your manager see "On site" or how far away it was.</li>
          </ul>
          <button type="button" className="fm-btn fm-btn-primary" onClick={allow} disabled={asking}>{asking ? 'Waiting…' : 'Turn on location'}</button>
          <button type="button" className="loc-retry loc-gate-skip" onClick={close}>Not now</button>
        </div>
      </div>
    </div>
  );
}
