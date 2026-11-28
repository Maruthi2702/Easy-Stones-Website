import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { undoLeftMs } from '../assistantMachine';
import type { Assistant } from '../useAssistant';

/**
 * After Save the card collapses into this bar: "Visit saved", Undo for ten seconds (the bar shows the time running out), and
 * "Add another". It never covers the page — the visit is already in the list behind it.
 */
export default function SavedBar({ a }: { a: Assistant }) {
  const s = a.state;
  // Fixed when the bar appears: the drain is a CSS animation, so nothing re-renders while it runs.
  const [leftMs] = useState(() => undoLeftMs(s, Date.now()));
  const label = a.types.find((t) => t.name === s.draft.visitType)?.label || s.draft.visitType;
  return (
    <div className="va-bar" role="status" aria-live="polite" aria-label="Visit saved">
      <span className="va-bar-check" aria-hidden="true"><Check size={20} strokeWidth={3} /></span>
      <span className="va-bar-text">
        <strong>Visit saved</strong>
        <small>{[s.customer?.label, label].filter(Boolean).join(' · ')}</small>
      </span>
      {s.undo === 'ready' && (
        <button type="button" className="va-bar-btn" onClick={() => void a.undo()}>
          Undo
          <i className="va-bar-drain" style={{ ['--va-undo-ms' as string]: `${leftMs}ms` }} aria-hidden="true" />
        </button>
      )}
      {s.undo === 'working' && <span className="va-bar-note">Undoing…</span>}
      {s.undo === 'failed' && <span className="va-bar-note">Couldn’t undo. Delete it from the visit.</span>}
      <button type="button" className="va-bar-btn va-bar-main" onClick={a.addAnother}>Add another</button>
      <button type="button" className="va-bar-x" aria-label="Close" onClick={a.close}><X size={16} aria-hidden="true" /></button>
    </div>
  );
}
