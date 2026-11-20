import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { statesSummary } from '../../utils/projectLeads';

/**
 * Project Leads' State filter: one dropdown that ticks several states (owner, 2026-11-20, on every screen
 * size). The list opens **inline under its field** and pushes the fields below it down, instead of floating:
 * the desktop Filters panel and the phone sheet both scroll, and a floating list would be clipped by them.
 */
export default function StatePicker({ states, value, onChange }: {
  states: { name: string; count: number }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((s) => s !== name) : [...value, name]);

  return (
    <div className="prj-field">
      <span id={`${listId}-label`}>State</span>
      <button type="button" className={`prj-multi-btn${value.length ? ' on' : ''}`} aria-haspopup="true" aria-expanded={open}
        aria-controls={listId} aria-labelledby={`${listId}-label ${listId}-btn`} onClick={() => setOpen((o) => !o)}>
        <span id={`${listId}-btn`} className="prj-multi-text">{statesSummary(value)}</span>
        <ChevronDown size={16} className="prj-multi-chev" aria-hidden="true" />
      </button>
      {open ? (
        <div id={listId} className="prj-multi-list" role="group" aria-label="States">
          <div className="prj-multi-tools">
            <button type="button" className="prj-multi-link" onClick={() => onChange(states.map((s) => s.name))} disabled={value.length === states.length}>All</button>
            <button type="button" className="prj-multi-link" onClick={() => onChange([])} disabled={!value.length}>None</button>
          </div>
          {states.map((s) => (
            <label key={s.name} className={`prj-multi-row${value.includes(s.name) ? ' on' : ''}`}>
              <input type="checkbox" checked={value.includes(s.name)} onChange={() => toggle(s.name)} />
              <span>{s.name}</span>
              <span className="prj-muted">{s.count}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
