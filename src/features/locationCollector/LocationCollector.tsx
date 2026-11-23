import { MapPin } from 'lucide-react';
import FormModal from '../../components/shared/form/FormModal';
import { useAuth } from '../../context/AuthContext';
import useLocationCollector from './useLocationCollector';
import useLocateRequests from './useLocateRequests';
import { CONSENT_TITLE, consentBody, platformWords } from './collectorRules';
import type { Platform } from './collectorRules';
import { Capacitor } from '@capacitor/core';
import { openBatterySettings, openLocationSettings } from './backgroundLocation';
import './LocationCollector.css';

/**
 * Mounted once in the app shell (App.tsx). Draws nothing outside the phone app or
 * for people who aren't tracked. Tracked staff get, once, the consent screen
 * (owner's design, version 4: title, one line and on iPhone the two buttons to tap; in the React Native app its own native screen
 * shows it instead, `phoneOwns`);
 * then it runs with no on-screen pin (owner, 2026-11-22: the pin said "on" without checking the phone's permission), and a prompt to open
 * Settings if location is off for the app. Works on iPhone and Android (wording by phone: `platformWords`).
 */
export default function LocationCollector() {
  const { user } = useAuth();
  const { phase, consent, saving, consentError, retryAfterSettings, phoneOwns } = useLocationCollector(user as never);
  const words = platformWords(Capacitor.getPlatform() as Platform);
  // A "Locate now" ask from an admin (any hour): answered whenever the app is in front and location is allowed.
  useLocateRequests(phase === 'running' || phase === 'waiting');

  return (
    <>
      {phase === 'needs-consent' && !phoneOwns ? (
        <FormModal title={CONSENT_TITLE} size="s" submitLabel="Allow" saving={saving} onSubmit={() => void consent()}>
          <div className="lc-consent">
            {consentError ? <p role="alert" className="lc-error">{consentError}</p> : null}
            <p>{consentBody(Capacitor.getPlatform() as Platform)}</p>
            {words.steps ? (
              <div className="lc-steps">
                <p className="lc-steps-head">{words.steps.heading}</p>
                <ol>
                  {words.steps.items.map(step => (
                    <li key={step.button}><span>{step.lead}</span><span className="lc-steps-btn">{step.button}</span></li>
                  ))}
                </ol>
                <p className="lc-steps-warn">{words.steps.warning}</p>
              </div>
            ) : <p>{words.next}</p>}
            {words.battery ? <p>{words.battery} <button type="button" className="lc-link" onClick={() => void openBatterySettings()}>Open battery settings</button></p> : null}
          </div>
        </FormModal>
      ) : null}

      {phase === 'denied' && !phoneOwns ? (
        <div className="lc-pill is-warn" role="alert">
          <MapPin size={14} aria-hidden="true" /> Location is off for Easy Surfaces.
          <button type="button" onClick={() => { void openLocationSettings(); retryAfterSettings(); }}>Open Settings</button>
        </div>
      ) : null}
    </>
  );
}
