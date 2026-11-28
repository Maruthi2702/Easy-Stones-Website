import type { ReactNode } from 'react';
import { MicOff, WifiOff, HelpCircle, Mic } from 'lucide-react';
import { canRetry } from '../assistantMachine';
import type { FailureWhy } from '../assistantMachine';
import type { Assistant } from '../useAssistant';

const WORDS: Record<string, { title: string; body: string }> = {
  unavailable: { title: 'The assistant isn’t available right now', body: 'Your words are kept, so the visit form opens with them filled in.' },
  network: { title: 'No signal right now', body: 'The assistant needs a connection. Your words are kept, so the visit form opens with them filled in.' },
  limit: { title: 'You’ve used today’s turns', body: 'The assistant has a daily limit for each person. Your words are kept, so the visit form opens with them filled in.' },
  forbidden: { title: 'The assistant isn’t switched on for you', body: 'Ask an admin to turn on Voice assistant for your role. The visit form opens with your words in the meantime.' },
  default: { title: 'I couldn’t work that out', body: 'Your words are kept, so the visit form opens with them filled in.' }
};

function Problem({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="va-problem va-in" role="alert">
      <div className="va-problem-head"><span className="va-problem-icon">{icon}</span><h2>{title}</h2></div>
      {children}
    </div>
  );
}

/** Before the first listen on a phone that has not been asked for the microphone and speech recognition. */
export function PermissionView({ a }: { a: Assistant }) {
  return (
    <Problem icon={<Mic size={18} aria-hidden="true" />} title="Allow the microphone">
      <p className="va-note">Easy Surfaces turns your voice into words on your phone. It needs the microphone and Speech Recognition for that. Nothing is recorded.</p>
      <div className="va-actions">
        <button type="button" className="va-btn va-btn-ghost" onClick={a.typeInstead}>Type instead</button>
        <button type="button" className="va-btn va-btn-main va-grow" onClick={() => void a.requestPermission()}>Allow</button>
      </div>
    </Problem>
  );
}

/** Every rung of the failure ladder (docs/VOICE_ASSISTANT_PLAN.md): each ends with a way forward. */
export function ErrorView({ a }: { a: Assistant }) {
  const s = a.state;
  const kind = s.error?.kind;
  if (kind === 'permission-denied') {
    return (
      <Problem icon={<MicOff size={18} aria-hidden="true" />} title="The microphone is off">
        <p className="va-note">Turn on Microphone and Speech Recognition for Easy Surfaces in the phone’s Settings, then come back. Until then you can type the visit.</p>
        <div className="va-actions">
          <button type="button" className="va-btn va-btn-ghost" onClick={a.openForm}>Open the form</button>
          <button type="button" className="va-btn va-btn-main va-grow" onClick={a.typeInstead}>Type the visit</button>
        </div>
      </Problem>
    );
  }
  if (kind === 'nothing-heard') {
    const again = canRetry(s);
    return (
      <Problem icon={<HelpCircle size={18} aria-hidden="true" />} title="I didn’t catch that">
        <p className="va-note">{again ? 'Try again a little closer to the phone, or type it.' : 'I still can’t hear it. Type it, or open the visit form.'}</p>
        <div className="va-actions">
          <button type="button" className="va-btn va-btn-ghost" onClick={a.typeInstead}>Type instead</button>
          {again
            ? <button type="button" className="va-btn va-btn-main va-grow" onClick={a.retry}>Say it again</button>
            : <button type="button" className="va-btn va-btn-main va-grow" onClick={a.openForm}>Open the form</button>}
        </div>
      </Problem>
    );
  }
  const why = (s.error?.why as FailureWhy | undefined) || 'failed';
  const text = WORDS[why] || WORDS.default;
  return (
    <Problem icon={<WifiOff size={18} aria-hidden="true" />} title={text.title}>
      <p className="va-note">{text.body}</p>
      <div className="va-actions">
        <button type="button" className="va-btn va-btn-main va-grow" onClick={a.openForm}>{s.said.length ? 'Open the form with my words' : 'Open the form'}</button>
      </div>
    </Problem>
  );
}
