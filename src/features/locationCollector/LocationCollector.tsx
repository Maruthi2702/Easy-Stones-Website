import { MapPin } from 'lucide-react';
import FormModal from '../../components/shared/form/FormModal';
import { useAuth } from '../../context/AuthContext';
import useLocationCollector from './useLocationCollector';
import useLocateRequests from './useLocateRequests';
import { untilText } from './collectorRules';
import { openLocationSettings } from './backgroundLocation';
import './LocationCollector.css';

/**
 * Mounted once in the app shell (App.tsx). Draws nothing outside the iOS app or
 * for people who aren't tracked. Tracked staff get, once, the consent screen
 * (wording is the owner-approved plan: when, who sees it, how long it is kept);
 * then a small "Location on until 6 PM" pill while it runs, and a prompt to open
 * iOS Settings if location is off for the app.
 */
export default function LocationCollector() {
  const { user } = useAuth();
  const { phase, status, consent, saving, consentError, retryAfterSettings } = useLocationCollector(user as never);
  const until = untilText(status?.windowEnd ?? 18);
  // A "Locate now" ask from an admin (any hour): answered whenever the app is in front and location is allowed.
  const sent = useLocateRequests(phase === 'running' || phase === 'waiting');

  return (
    <>
      {phase === 'needs-consent' ? (
        <FormModal title="Share your location during work hours" size="s" submitLabel="Allow" saving={saving} onSubmit={() => void consent()}>
          <div className="lc-consent">
            {consentError ? <p role="alert" className="lc-error">{consentError}</p> : null}
            <p>Easy Surfaces will read your phone’s location, including when the app is in the background, so your manager can see where you are on the job.</p>
            <ul>
              <li><b>When:</b> {status?.windowStart ?? 7} AM to {until} on your branch’s time, Monday to Friday, and on a Saturday or Sunday only when you have a delivery or stop scheduled. Never at night, and not on a day you log Personal Time Off.</li>
              <li><b>Outside those hours:</b> your phone does not report on its own. An authorised manager can ask it for its location once, with a reason, and you get a notification each time. Every request is recorded.</li>
              <li><b>Who sees it:</b> managers and directors for your branch. Other staff and suppliers do not.</li>
              <li><b>How long:</b> kept 90 days, then deleted.</li>
              <li><b>Stopping:</b> turn Location off for Easy Surfaces in iPhone Settings at any time.</li>
            </ul>
            <p>iPhone will ask you to allow location next. Choose “Always” so this works when the app is closed.</p>
          </div>
        </FormModal>
      ) : null}

      {phase === 'running' ? (
        <div className="lc-pill" role="status"><MapPin size={14} aria-hidden="true" /> Location on until {until}</div>
      ) : null}

      {sent ? <div className="lc-pill" role="status"><MapPin size={14} aria-hidden="true" /> {sent}</div> : null}

      {phase === 'denied' ? (
        <div className="lc-pill is-warn" role="alert">
          <MapPin size={14} aria-hidden="true" /> Location is off for Easy Surfaces.
          <button type="button" onClick={() => { void openLocationSettings(); retryAfterSettings(); }}>Open Settings</button>
        </div>
      ) : null}
    </>
  );
}
