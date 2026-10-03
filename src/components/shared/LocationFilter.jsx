import React, { useEffect, useId, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';
import { ALL_LOCATIONS, locationNames, homeLocationOf } from '../../utils/locationFilter';
import './LocationFilter.css';

/**
 * The one location filter every screen uses: the round filter-icon button the
 * Check-In Log introduced, opening a Filters panel with the Location choice
 * inside — "All locations" first, then each branch, the viewer's home location
 * marked. Pair it with useLocationFilter / useLocationsFilter
 * (useLocationFilter.js), which open it on the home location and remember a
 * different pick for the session.
 *
 * `options` is only what to offer — each screen decides that from its own
 * access rules, and the server enforces them. Hidden when there are fewer
 * than two options, since there is nothing to choose between.
 *
 * Single-choice (value: '' = All) by default; `multiple` takes an array
 * (value: [] = All) and shows checkboxes.
 *
 * A screen whose Filters panel already exists (the Check-In Log) puts
 * <LocationField> inside its own panel instead of adding a second button.
 * The field is a native <select>, not CustomSelect: CustomSelect portals its
 * menu to <body>, so picking from it inside a panel reads as a click outside
 * and closes the panel mid-choice.
 */

const PANEL_WIDTH = 300;
const EDGE = 16; // the page gutter the panel keeps clear of

export const LocationField = ({
  options = [],
  value,
  onChange,
  user = null,
  multiple = false,
  allLabel = 'All locations'
}) => {
  const id = useId();
  const names = locationNames(options);
  const home = homeLocationOf(user);
  const labelOf = (n) => (n === home ? `${n} · Home` : n);

  if (multiple) {
    const picked = Array.isArray(value) ? value : [];
    const toggle = (n) => onChange?.(picked.includes(n) ? picked.filter(v => v !== n) : [...picked, n]);
    return (
      <div className="lf-group" role="group" aria-labelledby={`${id}-label`}>
        <span className="lf-group-label" id={`${id}-label`}>Locations</span>
        <div className="lf-checks">
          <label className="lf-check">
            <input type="checkbox" checked={picked.length === 0} onChange={() => onChange?.([])} />
            <span>{allLabel}</span>
          </label>
          {names.map(n => (
            <label key={n} className="lf-check">
              <input type="checkbox" checked={picked.includes(n)} onChange={() => toggle(n)} />
              <span>{labelOf(n)}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="lf-group">
      <label className="lf-group-label" htmlFor={id}>Location</label>
      <select
        id={id}
        className="lf-select"
        value={typeof value === 'string' ? value : ALL_LOCATIONS}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value={ALL_LOCATIONS}>{allLabel}</option>
        {names.map(n => <option key={n} value={n}>{labelOf(n)}</option>)}
      </select>
    </div>
  );
};

const LocationFilter = ({
  options = [],
  value,
  onChange,
  user = null,
  multiple = false,
  allLabel = 'All locations',
  className = ''
}) => {
  const [open, setOpen] = useState(false);
  // Where the panel sits, in px from the button's left edge: lined up with
  // the button's right edge, then nudged to stay 16px inside the screen —
  // on a phone the button is often too near one side for either edge to fit.
  const [panelLeft, setPanelLeft] = useState(0);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const names = locationNames(options);
  if (names.length < 2) return null;

  const picked = multiple ? (Array.isArray(value) ? value : []) : (typeof value === 'string' ? value : ALL_LOCATIONS);
  const isAll = multiple ? picked.length === 0 : !picked;
  const summary = isAll ? allLabel : (multiple ? picked.join(', ') : picked);

  const toggleOpen = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!open && rect) {
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * EDGE);
      const left = Math.max(EDGE, Math.min(rect.right - width, window.innerWidth - width - EDGE));
      setPanelLeft(left - rect.left);
    }
    setOpen(o => !o);
  };

  return (
    <div className={`lf ${className}`} ref={rootRef}>
      <button
        type="button"
        className={`lf-btn${isAll ? '' : ' is-active'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Filters — location: ${summary}`}
        aria-label={`Filters, location: ${summary}`}
        onClick={toggleOpen}
      >
        <Filter size={14} aria-hidden="true" />
        {!isAll && <span className="lf-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="lf-pop" style={{ left: panelLeft }} role="dialog" aria-label="Filters">
          <div className="lf-pop-head">
            <span>Filters</span>
            <button type="button" className="lf-pop-close" onClick={() => setOpen(false)} aria-label="Close filters">
              <X size={14} />
            </button>
          </div>
          <LocationField
            options={names}
            value={picked}
            onChange={onChange}
            user={user}
            multiple={multiple}
            allLabel={allLabel}
          />
          <div className="lf-pop-foot">
            <button type="button" className="lf-clear" onClick={() => onChange?.(multiple ? [] : ALL_LOCATIONS)}>
              Clear Filter
            </button>
            <button type="button" className="lf-done" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationFilter;
