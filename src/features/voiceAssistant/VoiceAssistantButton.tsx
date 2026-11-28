import { useEffect, useState } from 'react';
import Logo from './views/Logo';
import './VoiceAssistant.css';

/** Where the button sits: above the round + (Dashboard, Planner, a customer's profile) or alone / above the list's + (Customers). */
export type VoicePlacement = 'plus' | 'list';

const HINT_KEY = 'assistant.hint.seen';
const HINT_MS = 9000;

const hintSeen = (): boolean => { try { return window.localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
const markHintSeen = () => { try { window.localStorage.setItem(HINT_KEY, '1'); } catch { /* shown again next time */ } };

/**
 * The assistant's round gold button — the Easy Surfaces mark, resting; it turns only while the assistant is listening or working.
 * It sits above the page's round + and never replaces it (the "one +" rule). Mounted only for someone holding Voice assistant on a
 * phone that can do speech (VoiceAssistant.tsx), so a first-time hint ("Tap and say…") can show once without nagging.
 */
export default function VoiceAssistantButton({ placement, spinning, hidden, onClick }: { placement: VoicePlacement; spinning: boolean; hidden: boolean; onClick: () => void }) {
  const [hint, setHint] = useState(() => !hintSeen());
  useEffect(() => {
    if (!hint) return undefined;
    const timer = setTimeout(() => { setHint(false); markHintSeen(); }, HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  return (
    <div className={`va-fab-wrap va-fab-wrap--${placement}${hidden ? ' is-hidden' : ''}`} aria-hidden={hidden || undefined}>
      {hint && !hidden && <div className="va-hint" role="note">Tap and say “log a visit at…”</div>}
      <button
        type="button"
        className="va-fab fm-tokens"
        aria-label="Talk to the assistant: log a visit by voice"
        aria-haspopup="dialog"
        tabIndex={hidden ? -1 : 0}
        onClick={() => { setHint(false); markHintSeen(); onClick(); }}
      >
        <Logo spinning={spinning} size={26} />
      </button>
    </div>
  );
}
