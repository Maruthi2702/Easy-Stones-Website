import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export type FilterChoice = { value: string; label: string; count?: number; dot?: string };

/**
 * One filter dropdown in the Customers tab's look (CustomerList.css's .cl-dd-btn / .cl-pop, on the page's
 * --ccr-* tokens): the closed button says "Label" or "Label: Choice" (gold once something narrows it, with ✕
 * to clear); the list floats inside its own box under the button (never portaled to the body — the CustomSelect
 * incident) and closes on a pick, a click elsewhere or Esc. Single choice; `clearTo` is the value ✕ goes back to
 * (none = the button never shows ✕, e.g. the bank, which always has one).
 */
export default function FilterMenu({ label, value, choices, onChange, clearTo, searchable = false, align = 'left' }: {
  label: string; value: string; choices: FilterChoice[]; onChange: (value: string) => void;
  clearTo?: string; searchable?: boolean; align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const current = choices.find((c) => c.value === value);
  const narrowed = clearTo !== undefined && value !== clearTo;
  const shown = choices.filter((c) => !q || c.label.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (v: string) => { onChange(v); setOpen(false); };

  return (
    <div className="ccr-dd" ref={ref}>
      <button type="button" className={`ccr-dd-btn${narrowed ? ' set' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        onClick={() => { if (!open) setQ(''); setOpen((o) => !o); }}>
        {narrowed || clearTo === undefined
          ? <><span className="k">{label}:</span><span className="lbl">{current?.label ?? value}</span></>
          : <span className="lbl">{label}</span>}
        {narrowed ? (
          <span className="ccr-dd-x" role="button" tabIndex={0} aria-label={`Clear ${label} filter`}
            onClick={(e) => { e.stopPropagation(); onChange(clearTo!); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(clearTo!); } }}>
            <X size={13} aria-hidden="true" />
          </span>
        ) : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open ? (
        <div className={`ccr-pop${align === 'right' ? ' right' : ''}`}>
          {searchable ? (
            <label className="ccr-pop-search">
              <Search size={14} aria-hidden="true" />
              <input type="search" className="no-capitalize" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`} />
            </label>
          ) : null}
          <div role="listbox" id={listId} aria-label={label}>
            {shown.map((c) => (
              <button key={c.value} type="button" role="option" aria-selected={c.value === value} className={`ccr-opt${c.value === value ? ' is-on' : ''}`} onClick={() => pick(c.value)}>
                {c.dot !== undefined ? <span className={`ccr-sdot is-${c.dot}`} aria-hidden="true" /> : null}
                <span className="ccr-opt-l">{c.label}</span>
                {c.count !== undefined ? <span className="n">{c.count.toLocaleString()}</span> : null}
                {c.value === value ? <Check size={15} aria-hidden="true" className="ccr-opt-tick" /> : null}
              </button>
            ))}
            {!shown.length ? <div className="ccr-pop-empty">Nothing matches</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
