import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { countyTree, toggleCounty, toggleState } from '../../../utils/permitView';

/*
 * The Permits filter's counties (2026-10-14): each state as a row with a
 * box that ticks all its counties and a chevron that opens the list, then
 * every county with its own box. Counties the app doesn't pull permits for
 * yet are listed, greyed, with "Not covered yet". Nothing ticked = every
 * county. Rules in src/utils/permitView.ts (countyTree…).
 */

/** A checkbox that can also show "some" (indeterminate). */
function TriBox({ state, onChange, label, disabled = false }: { state: string; onChange: React.ChangeEventHandler<HTMLInputElement>; label: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input ref={ref} type="checkbox" className="pm-cf-box" checked={state === 'all'} onChange={onChange}
      aria-label={label} aria-checked={state === 'some' ? 'mixed' : state === 'all'} disabled={disabled} />
  );
}

export default function CountyFilter({ selected, onChange }: { selected: string[]; onChange: (selected: string[]) => void }) {
  const tree = countyTree(selected);
  // A state opens by itself when one of its counties is ticked.
  const [open, setOpen] = useState(() => Object.fromEntries(tree.map((s) => [s.id, s.state !== 'none'])));

  return (
    <div className="pm-cf" role="group" aria-label="Counties">
      {tree.map((s) => {
        const isOpen = open[s.id];
        const Chevron = isOpen ? ChevronUp : ChevronDown;
        return (
          <div key={s.id} className="pm-cf-state">
            <div className="pm-cf-row pm-cf-head">
              <TriBox state={s.state} label={`All of ${s.name}`} onChange={() => onChange(toggleState(selected, s.id))} />
              <button type="button" className="pm-cf-name" aria-expanded={isOpen} aria-controls={`pm-cf-${s.id}`}
                onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
                <span>{s.name}</span>
                <Chevron size={18} aria-hidden="true" />
              </button>
            </div>
            {isOpen ? (
              <ul className="pm-cf-list" id={`pm-cf-${s.id}`}>
                {s.counties.map((c) => (
                  <li key={c.id} className={`pm-cf-row pm-cf-county${c.covered ? '' : ' off'}`}>
                    <label>
                      <input type="checkbox" className="pm-cf-box" checked={c.checked} disabled={!c.covered && !c.checked}
                        onChange={() => onChange(toggleCounty(selected, c.id))} />
                      <span className="pm-cf-label">{c.name}</span>
                      {c.covered ? null : <span className="pm-cf-note">Not covered yet</span>}
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
