import React, { useEffect, useRef, useState } from 'react';
import { locationClass, useDismiss, copyText } from './uiHelpers';
import { Check, Copy, ChevronDown, X, AlertTriangle, Search, Info, Wrench, BookOpen, Presentation } from 'lucide-react';
import { statusMeta, locationOf, dataIssues } from '../../../utils/customerList';

export const StatusDot = ({ status }) => {
  const m = statusMeta(status);
  return (
    <span className={`cl-sd${m.closed ? ' closed' : ''}`} title={status || 'No status'}>
      <span className={`cl-dot ${m.tone}`} aria-hidden="true" />
      {m.short}
    </span>
  );
};

export const LocationTag = ({ customer, name }) => {
  const loc = name || locationOf(customer);
  return <span className={`location-badge ${locationClass(loc)}`}>{loc}</span>;
};

// The name is its own span so a phone-width header can show just the
// initial (CustomerList.css, .cl-dh-meta) — the title keeps it readable.
export const RepBadge = ({ name }) => (name ? (
  <span className="cl-rep" title={`Sales rep: ${name}`}><span className="cl-av" aria-hidden="true">{name[0].toUpperCase()}</span><span className="cl-rep-name">{name}</span></span>
) : (
  <span className="cl-rep cl-muted" title="No sales rep"><span className="cl-un" aria-hidden="true" /><span className="cl-rep-name">Unassigned</span></span>
));

/** "Level - 1", or "L1" where the header has to fit one phone-width row. */
export const LevelTag = ({ level }) => {
  const full = String(level || '').trim();
  if (!full) return null;
  return (
    <span className="cl-lvl" title={full}>
      <span className="cl-lvl-full">{full}</span>
      <span className="cl-lvl-short" aria-hidden="true">{full.replace(/^level\s*-?\s*/i, 'L')}</span>
    </span>
  );
};

export const TypeTag = ({ type }) => {
  const t = type || 'Fabricator';
  const fab = t.toLowerCase() === 'fabricator';
  return (
    <span className={`cl-type ${fab ? 'fabricator' : 'other'}`}>
      <Wrench size={13} strokeWidth={2.25} aria-hidden="true" />{t}
    </span>
  );
};

export const ModaBadges = ({ customer }) => {
  const display = customer.modaDisplay === 'Yes';
  const binders = parseInt(customer.modaBinder, 10) || 0;
  return (
    <span className="cl-moda">
      <span className={`cl-mb ${display ? 'yes' : 'no'}`} title={display ? 'Moda display: yes' : 'Moda display: no'}>
        <Presentation size={13} aria-hidden="true" />{display ? 'Yes' : 'No'}
      </span>
      <span className={`cl-mb${binders ? '' : ' no'}`} title={`Moda binders: ${binders}`}>
        <BookOpen size={13} aria-hidden="true" />{binders}
      </span>
    </span>
  );
};

/** ⚠ when a record is missing something; hover (or a screen reader) says what. */
export const IssueFlag = ({ customer }) => {
  const issues = dataIssues(customer);
  if (!issues.length) return null;
  const label = `Incomplete: ${issues.join(', ')}`;
  return (
    <span className="cl-flag" title={label} role="img" aria-label={label}>
      <AlertTriangle size={14} strokeWidth={2.25} />
    </span>
  );
};

/** Icon button that copies `value` and briefly confirms. */
export const CopyButton = ({ value, what, always = false, size = 13 }) => {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  if (!value) return null;
  return (
    <button
      type="button"
      className={`cl-cpb${always ? ' always' : ''}${done ? ' done' : ''}`}
      aria-label={`Copy ${what} ${value}`}
      title={`Copy ${what}`}
      onClick={async (e) => { e.stopPropagation(); if (await copyText(value)) setDone(true); }}
    >
      {done ? <Check size={size} strokeWidth={2.5} /> : <Copy size={size} />}
      {done && <span className="cl-tip" role="status">Copied</span>}
    </button>
  );
};

/**
 * A filter button with a checkbox list. `options` are { value, label, dot?, n? }
 * or groups { group, options }. `selected` is an array of values.
 */
export const FilterDropdown = ({
  label, options, selected = [], onChange, searchable = false, note, align = 'left', allLabel, renderValue
}) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);

  const groups = (options || []).some(o => o.group)
    ? options
    : [{ group: null, options: options || [] }];
  const flat = groups.flatMap(g => g.options);
  const match = (o) => !q || String(o.label).toLowerCase().includes(q.toLowerCase());
  const labelOf = (v) => flat.find(o => o.value === v)?.label ?? v;

  const toggle = (v) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const isSet = selected.length > 0;
  const shown = renderValue
    ? renderValue(selected, labelOf)
    : (selected.length <= 1 ? (selected[0] !== undefined ? labelOf(selected[0]) : null) : `${selected.length} selected`);

  return (
    <div className="cl-dd" ref={ref}>
      <button
        type="button"
        className={`cl-dd-btn${isSet ? ' set' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (!open) setQ(''); setOpen(!open); }}
      >
        {isSet ? <><span className="k">{label}:</span><span className="lbl">{shown}</span></> : <span className="lbl">{allLabel || label}</span>}
        {isSet ? (
          <span
            className="cl-dd-x"
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label} filter`}
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange([]); } }}
          ><X size={13} /></span>
        ) : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open && (
        <div className={`cl-pop${align === 'right' ? ' right' : ''}`} role="listbox" aria-multiselectable="true" aria-label={label}>
          {searchable && (
            <label className="cl-pop-search">
              <Search size={14} aria-hidden="true" />
              <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`} />
            </label>
          )}
          {groups.map((g, gi) => {
            const opts = g.options.filter(match);
            if (!opts.length) return null;
            return (
              <React.Fragment key={g.group || gi}>
                {g.group && <div className="cl-pop-grp">{g.group}</div>}
                {opts.map(o => (
                  <label key={String(o.value)} className="cl-opt">
                    <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                    {o.dot && <span className={`cl-dot ${o.dot}`} aria-hidden="true" />}
                    {o.icon}
                    <span>{o.label}</span>
                    {o.n !== undefined && <span className="n">{o.n}</span>}
                  </label>
                ))}
              </React.Fragment>
            );
          })}
          {!flat.some(match) && <div className="cl-pop-empty">No matches</div>}
          {note && <div className="cl-pop-note"><Info size={14} aria-hidden="true" /><span>{note}</span></div>}
        </div>
      )}
    </div>
  );
};
