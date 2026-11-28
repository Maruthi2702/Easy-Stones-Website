import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { shiftDay } from '../../../components/shared/calendar/calendarDates';
import { findCustomers } from '../../../utils/customerQuickSearch';
import { rankBySound } from '../../../utils/soundAlike';
import type { EditableField } from '../assistantMachine';
import type { Candidate } from '../assistantMachine';
import type { Assistant } from '../useAssistant';

/** A text box that takes focus without scrolling the pinned sheet (CLAUDE.md, phone pop-ups). */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return ref;
}

/** "Type instead": the same sentence, written. It goes to the assistant like a spoken one. */
export function TypedView({ a }: { a: Assistant }) {
  const [text, setText] = useState('');
  const box = useFocusOnMount<HTMLTextAreaElement>();
  const asking = a.state.asking;
  return (
    <form className="va-typed" onSubmit={(e) => { e.preventDefault(); if (text.trim()) a.submitTyped(text); }}>
      <label className="va-label" htmlFor="va-typed">{asking ? 'Type your answer' : 'Type what happened'}</label>
      <textarea
        ref={box} id="va-typed" className="va-text" rows={5} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Visit at Smith Granite, dropped samples, follow up Friday" autoCapitalize="sentences"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) a.submitTyped(text); }}
      />
      <div className="va-actions">
        <button type="button" className="va-btn va-btn-ghost" onClick={a.back}>Back</button>
        <button type="submit" className="va-btn va-btn-main va-grow" disabled={!text.trim()}>Send</button>
      </div>
    </form>
  );
}

/** Find a customer in the sheet: the shared list, by name / city / contact, and by sound when nothing matches; Add customer last. */
export function SearchView({ a }: { a: Assistant }) {
  const [query, setQuery] = useState('');
  const box = useFocusOnMount<HTMLInputElement>();
  const typed = query.trim();
  const rows = useMemo<Candidate[]>(() => {
    if (!typed) return a.recent;
    const toCandidate = (o: { value: string; label: string; city?: string }): Candidate => ({ id: String(o.value), label: o.label, city: o.city || '' });
    const found = findCustomers(a.customerOptions, typed, 30).rows;
    if (found.length) return found.map(toCandidate);
    return rankBySound(a.customerOptions, typed, '', 8).matches.map((m) => toCandidate(m.option));
  }, [typed, a.customerOptions, a.recent]);
  return (
    <div className="va-search">
      <div className="va-field">
        <Search size={18} aria-hidden="true" />
        <input
          ref={box} type="text" className="va-input no-capitalize" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a customer…" aria-label="Find a customer" autoComplete="off" spellCheck={false}
        />
        {query && <button type="button" className="va-clear" aria-label="Clear" onClick={() => setQuery('')}><X size={14} /></button>}
        <button type="button" className="va-link" onClick={a.back}>Back</button>
      </div>
      <div className="va-list va-scroll" role="listbox" aria-label={typed ? 'Customers found' : 'Recent customers'}>
        {!typed && rows.length > 0 && <div className="va-group">Recently opened</div>}
        {rows.map((c) => (
          <button key={c.id} type="button" role="option" aria-selected="false" className="va-result" onClick={() => a.pickCustomer(c)}>
            <span className="va-result-name">{c.label}</span>
            {c.city && <span className="va-result-sub">{c.city}</span>}
          </button>
        ))}
        {!rows.length && (
          <div className="va-empty">
            <p>{typed ? `No customer called “${typed}”.` : 'Type a name, a city or a contact.'}</p>
            {typed && a.canAddCustomer && (
              <button type="button" className="va-btn va-btn-ghost" onClick={() => a.addCustomer(typed)}><UserPlus size={16} aria-hidden="true" />Add customer</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const LABELS: Partial<Record<EditableField, string>> = { notes: 'Notes', outcome: 'Outcome', followUp: 'Follow-up' };

/** Notes, outcome and follow-up are edited in a tall view with the box at the top, so the keyboard never covers it. */
export function TextEditView({ a, field, onClose }: { a: Assistant; field: 'notes' | 'outcome' | 'followUp'; onClose: () => void }) {
  const d = a.state.draft;
  const [text, setText] = useState(d[field]);
  const [due, setDue] = useState(d.followUpDate);
  const box = useFocusOnMount<HTMLTextAreaElement>();
  const today = a.state.today;
  const done = () => {
    a.edit(field, text);
    if (field === 'followUp') a.edit('followUpDate', due);
    onClose();
  };
  return (
    <div className="va-typed">
      <label className="va-label" htmlFor="va-edit">{LABELS[field]}</label>
      <textarea ref={box} id="va-edit" className="va-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} autoCapitalize="sentences" />
      {field === 'followUp' && (
        <div className="va-edit">
          <span className="va-label">Due</span>
          <div className="va-choices">
            <button type="button" className={`va-choice${due === shiftDay(today, 1) ? ' is-on' : ''}`} onClick={() => setDue(shiftDay(today, 1))}>Tomorrow</button>
            <button type="button" className={`va-choice${due === shiftDay(today, 7) ? ' is-on' : ''}`} onClick={() => setDue(shiftDay(today, 7))}>In a week</button>
            {due && <button type="button" className="va-choice" onClick={() => setDue('')}>No day</button>}
          </div>
          <DatePicker id="va-due" value={due} min={today} today={today} onChange={setDue} clearable placeholder="Pick a due day" ariaLabel="Follow-up day" sheetTitle="Follow-up day" />
        </div>
      )}
      <div className="va-actions">
        <button type="button" className="va-btn va-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="va-btn va-btn-main va-grow" onClick={done}>Done</button>
      </div>
    </div>
  );
}
