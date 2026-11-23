import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import FormModal from '../../components/shared/form/FormModal';
import { useAuth } from '../../context/AuthContext';
import useLocationCollector from './useLocationCollector';
import useLocateRequests from './useLocateRequests';
import { platformWords, untilText } from './collectorRules';
import type { Platform } from './collectorRules';
import { Capacitor } from '@capacitor/core';
import { openBatterySettings, openLocationSettings } from './backgroundLocation';
import './LocationCollector.css';

/**
 * Mounted once in the app shell (App.tsx). Draws nothing outside the phone app or
 * for people who aren't tracked. Tracked staff get, once, the consent screen
 * (wording is the owner-approved plan: when, who sees it, how long it is kept);
 * then a small "Location on until 6 PM" pill while it runs, and a prompt to open
 * Settings if location is off for the app. Works on iPhone and Android (wording by phone: `platformWords`).
 */
export default function LocationCollector() {
  const { user } = useAuth();
  const { phase, status, consent, saving, consentError, retryAfterSettings } = useLocationCollector(user as never);
  const until = untilText(status?.windowEnd ?? 18);
  const words = platformWords(Capacitor.getPlatform() as Platform);
  // A "Locate now" ask from an admin (any hour): answered whenever the app is in front and location is allowed.
  const sent = useLocateRequests(phase === 'running' || phase === 'waiting');
  // The full pill is shown for a few seconds, then shrinks to the pin so it stops covering the screen's content.
  const [small, setSmall] = useState(false);
  useEffect(() => {
    if (phase !== 'running') { setSmall(false); return undefined; }
    const t = setTimeout(() => setSmall(true), 6000);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <>
      {phase === 'needs-consent' ? (
        <FormModal title="Share your location during work hours" size="s" submitLabel="Allow" saving={saving} onSubmit={() => void consent()}>
          <div className="lc-consent">
            {consentError ? <p role="alert" className="lc-error">{consentError}</p> : null}
            <p>Easy Surfaces will read your phone’s location, {words.background}, so your manager can see where you are on the job.</p>
            <ul>
              <li><b>When:</b> {status?.windowStart ?? 7} AM to {until} on your branch’s time, Monday to Friday, and on a Saturday or Sunday only when you have a delivery or stop scheduled. Never at night, and not on a day you log Personal Time Off.</li>
              <li><b>Outside those hours:</b> your phone does not report on its own. An authorised manager can ask it for its location once, with a reason, and you get a notification each time. Every request is recorded.</li>
              <li><b>Who sees it:</b> managers and directors for your branch. Other staff and suppliers do not.</li>
              <li><b>How long:</b> kept 90 days, then deleted.</li>
              <li><b>Stopping:</b> turn Location off for Easy Surfaces in {words.settings} at any time.</li>
            </ul>
            <p>{words.next}</p>
            {words.battery ? <p>{words.battery} <button type="button" className="lc-link" onClick={() => void openBatterySettings()}>Open battery settings</button></p> : null}
          </div>
        </FormModal>
      ) : null}

      {phase === 'running' ? (
        <div className={`lc-pill${small ? ' is-small' : ''}`} role="status" aria-label={`Location on until ${until}`}><MapPin size={14} aria-hidden="true" /><span className="lc-pill-text"> Location on until {until}</span></div>
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
