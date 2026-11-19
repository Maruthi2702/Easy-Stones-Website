import { Loader2, MapPinOff, Check, MapPin } from 'lucide-react';
import { APPROXIMATE_OVER_M } from '../../utils/visitLocation.ts';
import type { LocationState } from './useLocationReading';
import './Location.css';

/** The one line under Date on Add visit / Add resource: looking, found, or slow. */
export function LocationLine({ location }: { location: LocationState }) {
  const { status, reading, retry } = location;
  if (status === 'blocked') return null; // the form shows LocationBlocked instead
  if (status === 'ready' && reading) {
    const rough = reading.accuracyM > APPROXIMATE_OVER_M;
    return (
      <div className={`loc-line ${rough ? 'loc-warn' : 'loc-ok'}`} aria-live="polite">
        <span className="loc-ic">{rough ? <MapPin size={13} aria-hidden="true" /> : <Check size={13} strokeWidth={3} aria-hidden="true" />}</span>
        <b>{rough ? 'Location found · approximate' : 'Location found'}</b>
        <small>{`Accurate to about ${reading.accuracyM < 1000 ? `${Math.max(5, Math.round(reading.accuracyM / 5) * 5)} m` : `${(reading.accuracyM / 1000).toFixed(1)} km`}. Saved with this entry.`}</small>
      </div>
    );
  }
  return (
    <div className="loc-line loc-wait" aria-live="polite">
      <span className="loc-ic"><Loader2 size={13} className="loc-spin" aria-hidden="true" /></span>
      <b>{status === 'slow' ? 'Still looking for your location…' : 'Getting your location…'}</b>
      <small>You can save once it's found.</small>
      {status === 'slow' && <button type="button" className="loc-retry" onClick={retry}>Try again</button>}
    </div>
  );
}

const stepsFor = (ua: string): string => {
  if (/iPhone|iPad/i.test(ua)) return 'On iPhone: Settings → Privacy & Security → Location Services → Safari Websites (or this app) → While Using, then come back.';
  if (/Android/i.test(ua)) return 'On Android: tap the lock icon by the address, choose Permissions → Location → Allow, then come back.';
  return 'On a computer: click the lock icon beside the address, set Location to Allow, then come back.';
};

/** Replaces the form when the browser says no. Comes back on its own once location is on. */
export function LocationBlocked({ what, onRetry }: { what: string; onRetry: () => void }) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return (
    <div className="loc-blocked" role="alert">
      <span className="loc-big"><MapPinOff size={22} aria-hidden="true" /></span>
      <h3>Turn on location to add {what}</h3>
      <p>Every visit and resource records where you are. {stepsFor(ua)}</p>
      <button type="button" className="fm-btn fm-btn-primary" onClick={onRetry}>Check again</button>
    </div>
  );
}
