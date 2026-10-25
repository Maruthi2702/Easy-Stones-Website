import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { cartActions } from '../cartStore';
import type { LotGroup, ShownLine } from './cartLines';

/** "All 3 from bundle B1 · colours match", or the bundles when they're mixed. */
export function LotBadge({ group }: { group: LotGroup }) {
  if (group.slabs < 2) return null;
  if (group.mixedLots) {
    return (
      <div className="cd-lot cd-lot-warn">
        <AlertTriangle size={14} aria-hidden="true" />
        From {group.bundles.length} bundles ({group.bundles.map((b) => b.bundle).join(', ')}) · colour may vary
      </div>
    );
  }
  return (
    <div className="cd-lot cd-lot-ok">
      <Check size={14} aria-hidden="true" />
      All {group.slabs} from bundle {group.bundles[0].bundle} · colours match
    </div>
  );
}

/** A slab's note in the full-width cart; saved when the box loses focus. */
export function NoteInput({ line }: { line: ShownLine }) {
  const [value, setValue] = useState(line.note || '');
  // A note saved elsewhere (another tab, the server) replaces what's shown.
  const [shownNote, setShownNote] = useState(line.note || '');
  if ((line.note || '') !== shownNote) {
    setShownNote(line.note || '');
    setValue(line.note || '');
  }
  const save = () => { if (value !== (line.note || '')) cartActions.setNote(line.slabKey, value); };
  return (
    <input
      className="cd-note"
      value={value}
      maxLength={300}
      placeholder="Add a note"
      aria-label={`Note for ${line.slabKey}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}
