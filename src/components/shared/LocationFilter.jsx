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
 *
 * A screen with more to filter by than location (the Delivery Schedule's
 * order search) passes it as `children` — a node, or a function given
 * `{ close }` so a pick can shut the panel. It renders above the Location
 * field, the button shows even when there's only one location to offer (the
 * extra field still needs a home), `active` lights the button's dot for it,
 * `onClear` runs alongside the location reset, and `wide` gives the panel
 * room for them. Without these props the filter is exactly as before.
 * The field is a native <select>, not CustomSelect: CustomSelect portals its
 * menu to <body>, so picking from it inside a panel reads as a click outside
 * and closes the panel mid-choice.
 */

const PANEL_WIDTH = 300;
// A panel with extra fields in it (`wide`, sized by .lf-pop--wide).
const WIDE_PANEL_WIDTH = 380;
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
  className = '',
  children = null,
  active = false,
  onClear,
  wide = false,
  label = 'Filters'
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
    // A field inside the panel that used Escape itself (closing its own
    // results list) marks it handled; only an unhandled Escape shuts the panel.
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false); };
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
  const hasExtra = children != null;
  const showLocation = names.length >= 2;
  if (!showLocation && !hasExtra) return null;

  const picked = multiple ? (Array.isArray(value) ? value : []) : (typeof value === 'string' ? value : ALL_LOCATIONS);
  const isAll = multiple ? picked.length === 0 : !picked;
  const summary = isAll ? allLabel : (multiple ? picked.join(', ') : picked);
  const lit = (showLocation && !isAll) || active;
  const buttonLabel = showLocation ? `${label}, location: ${summary}` : label;
  const close = () => setOpen(false);

  const toggleOpen = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!open && rect) {
      const width = Math.min(wide ? WIDE_PANEL_WIDTH : PANEL_WIDTH, window.innerWidth - 2 * EDGE);
      const left = Math.max(EDGE, Math.min(rect.right - width, window.innerWidth - width - EDGE));
      setPanelLeft(left - rect.left);
    }
    setOpen(o => !o);
  };

  return (
    <div className={`lf ${className}`} ref={rootRef}>
      <button
        type="button"
        className={`lf-btn${lit ? ' is-active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={showLocation ? `${label} — location: ${summary}` : label}
        aria-label={buttonLabel}
        onClick={toggleOpen}
      >
        <Filter size={14} aria-hidden="true" />
        {lit && <span className="lf-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className={`lf-pop${wide ? ' lf-pop--wide' : ''}`} style={{ left: panelLeft }} role="dialog" aria-label={label}>
          <div className="lf-pop-head">
            <span>{label}</span>
            <button type="button" className="lf-pop-close" onClick={close} aria-label={`Close ${label.toLowerCase()}`}>
              <X size={14} />
            </button>
          </div>
          {hasExtra && (
            <div className="lf-extra">
              {typeof children === 'function' ? children({ close }) : children}
            </div>
          )}
          {showLocation && (
            <LocationField
              options={names}
              value={picked}
              onChange={onChange}
              user={user}
              multiple={multiple}
              allLabel={allLabel}
            />
          )}
          <div className="lf-pop-foot">
            <button
              type="button"
              className="lf-clear"
              onClick={() => {
                if (showLocation) onChange?.(multiple ? [] : ALL_LOCATIONS);
                onClear?.();
              }}
            >
              Clear Filter
            </button>
            <button type="button" className="lf-done" onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationFilter;
