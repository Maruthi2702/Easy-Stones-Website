import { useEffect, useState } from 'react';
import { MapPin, Clock, Users } from 'lucide-react';
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
      <div className="lg-scrim" onClick={close} aria-hidden="true" />
      <div className="lg-sheet" role="dialog" aria-modal="true" aria-labelledby="lg-title">
        <span className="lg-grab" aria-hidden="true" />
        <span className="lg-icon"><MapPin size={26} aria-hidden="true" /></span>
        <h2 className="lg-title" id="lg-title">Allow location</h2>
        <p className="lg-lead">Every visit and resource you add records where you were.</p>
        <ul className="lg-points">
          <li><Clock size={18} aria-hidden="true" /><span>Only at the moment you add one. Never in the background.</span></li>
          <li><Users size={18} aria-hidden="true" /><span>You and your manager see "On site" or how far away it was.</span></li>
        </ul>
        <button type="button" className="fm-btn fm-btn-primary lg-go" onClick={allow} disabled={asking}>{asking ? 'Waiting…' : 'Turn on location'}</button>
        <button type="button" className="lg-skip" onClick={close}>Not now</button>
      </div>
    </div>
  );
}
