import { useState } from 'react';
import type { ReactNode } from 'react';
import { Mic } from 'lucide-react';
import { OPEN_MESSAGE, openSpeechTest } from './openSpeechTest';
import './VoiceTest.css';

/**
 * Admin → Voice Assistant → Speech test (was Admin → Voice Test, 2026-11-27; `embedded` drops its own header inside the tab): the way into the app's speech test, which measures how well an iPhone's mic hears our stone names,
 * brands and slang before the voice assistant is built. Opened from Voice Assistant (navPins `voice_assistant`). The test itself is native (mobile/src/speechTest).
 */
export default function VoiceTestPage({ sidebarToggle = null, embedded = false }: { sidebarToggle?: ReactNode; embedded?: boolean }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true); setMessage('');
    const result = await openSpeechTest();
    if (result !== 'opened') setMessage(OPEN_MESSAGE[result]);
    setBusy(false);
  };

  return (
    <div className={`vt${embedded ? ' is-embedded' : ''}`}>
      {embedded ? null : (
        <header className="vt-head">
          {sidebarToggle}
          <div className="vt-title">
            <h1>Voice Test</h1>
            <span>How well does the iPhone hear our words?</span>
          </div>
        </header>
      )}
      <div className="vt-body">
        <ol className="vt-steps">
          <li>Open this page in the Easy Surfaces app on an iPhone, in a quiet room first.</li>
          <li>Tap <b>Open speech test</b>. It shows one sentence at a time.</li>
          <li>Tap Start, read the sentence out loud, tap Done talking. Do 5–10 sentences with <b>hints</b> off, then the same with hints on.</li>
          <li>Tap <b>Share results</b> and send the text back to whoever is setting up the voice assistant.</li>
        </ol>
        <button type="button" className="vt-open" onClick={() => void open()} disabled={busy}>
          <Mic size={18} aria-hidden="true" /> Open speech test
        </button>
        {message ? <p className="vt-note" role="status">{message}</p> : null}
        <p className="vt-fine">Nothing is recorded or sent anywhere. The words stay on the phone’s screen until you tap Share.</p>
      </div>
    </div>
  );
}
