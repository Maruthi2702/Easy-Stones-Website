import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Loader2, FileCheck2 } from 'lucide-react';
import { searchDeliveries } from '../../../api/deliverySchedule';
import { describeSearchResult, SEARCH_MIN_CHARS } from '../../../utils/deliverySearch';
import { formatForDateInput } from '../../../utils/dateUtils';
import './DeliveryOrderSearch.css';

/**
 * "Search SO# or company…" in the Delivery Schedule header. Typing does two
 * things at once:
 *   - the board below keeps filtering the week on screen (the parent passes
 *     the same text to BoardGrid / Pending / Cancelled as before), and
 *   - this dropdown searches every date on the server, so an order delivered
 *     months ago or booked for next month shows up with its date and status.
 *
 * Picking a result calls `onSelect(result, info)`; the parent decides what
 * that means for the viewer's role (jump to its week, open the ticket).
 * Rules for who can search and what matches: src/utils/deliverySearch.js.
 *
 * `inline` is for when it lives inside the header's Filters panel
 * (LocationFilter): the results list flows under the box at the panel's own
 * width instead of floating over the page, and `autoFocus` puts the cursor in
 * the box as the panel opens.
 */
const DEBOUNCE_MS = 300;

const driverLabel = (r, trucks) => {
  if (r.deliveryType === 'will_call') return 'Will call';
  const trk = trucks.find(t => t.id === r.truckId);
  return (trk && (trk.driver || trk.name)) || r.driver || '';
};

const branchLabel = (r) => (
  r.deliveryType === 'transfer' && r.transferDestination
    ? `${r.location || '?'} → ${r.transferDestination}`
    : (r.location || '')
);

const signedTime = (r) => {
  if (!r.pod?.verified || !r.pod?.signedAt) return '';
  const t = new Date(r.pod.signedAt);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const DeliveryOrderSearch = ({ value, onChange, onSelect, onViewPod, trucks = [], viewerLocations = [], inline = false, autoFocus = false }) => {
  const [open, setOpen] = useState(false);
  // The last answer from the server, tagged with the text it answered.
  const [answer, setAnswer] = useState({ query: '', error: false, results: [], total: 0, more: false });
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const query = (value || '').trim();
  const searchable = query.length >= SEARCH_MIN_CHARS;

  // Debounced server search; a newer keystroke aborts the older request so a
  // slow response can never overwrite a newer one. State only changes when an
  // answer arrives — "loading" is just "the answer we hold is for older text".
  useEffect(() => {
    if (!searchable) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await searchDeliveries(query, { signal: controller.signal });
        setAnswer({ query, error: false, results: data.results || [], total: data.total || 0, more: !!data.more });
        setActive(-1);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setAnswer({ query, error: true, results: [], total: 0, more: false });
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, searchable]);

  // While a newer search runs, the previous results stay up (with a spinner)
  // rather than flashing empty on every keystroke.
  const status = !searchable ? 'idle'
    : answer.query !== query ? 'loading'
    : answer.error ? 'error' : 'done';
  const state = { status, results: searchable ? answer.results : [], total: answer.total, more: answer.more };

  // Click/tap outside closes the dropdown (the text stays, so the board keeps
  // its filter).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const today = formatForDateInput(new Date());
  const rows = state.results.map(r => ({ r, info: describeSearchResult(r, { today, viewerLocations }) }));

  const choose = (row) => {
    if (!row) return;
    setOpen(false);
    inputRef.current?.blur();
    onSelect?.(row.r, row.info);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (open) { setOpen(false); e.preventDefault(); }
      else if (value) onChange('');
      return;
    }
    if (!rows.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => (i + 1) % rows.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? rows.length - 1 : i - 1)); }
    if (e.key === 'Enter' && open) { e.preventDefault(); choose(rows[active >= 0 ? active : 0]); }
  };

  const showPanel = open && searchable;

  return (
    <div className={`order-search${inline ? ' order-search--inline' : ''}`} ref={rootRef}>
      <div className="order-search-box">
        <Search size={15} className="order-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search SO# or company…"
          aria-label="Search orders by SO# or company"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="order-search-results"
          aria-autocomplete="list"
          className="order-search-input"
        />
        {state.status === 'loading' && <Loader2 size={14} className="order-search-spin" aria-hidden="true" />}
        {value && (
          <button type="button" className="order-search-clear" aria-label="Clear search" onClick={() => { onChange(''); inputRef.current?.focus(); }}>
            <X size={14} />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="order-search-panel" id="order-search-results" role="listbox">
          {state.status === 'error' && <div className="order-search-msg">Couldn't search right now. Try again in a moment.</div>}
          {state.status === 'loading' && rows.length === 0 && <div className="order-search-msg">Searching…</div>}
          {state.status === 'done' && rows.length === 0 && (
            <div className="order-search-msg">No orders match “{query}” in your locations.</div>
          )}

          {rows.map((row, i) => {
            const { r, info } = row;
            const signed = info.status === 'delivered' ? signedTime(r) : '';
            const driver = driverLabel(r, trucks);
            const branch = branchLabel(r);
            const so = r.soNumber || r.invoiceNumber;
            return (
              <div
                key={r.id}
                role="option"
                aria-selected={i === active}
                className={`order-search-row${i === active ? ' is-active' : ''}${r.pod?.verified && onViewPod ? ' has-pod' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(row)}
              >
                <div className="order-search-line1">
                  <span className={`order-search-status st-${info.status}`}>{info.label}</span>
                  <span className="order-search-when">
                    {info.when}{signed && ` · signed ${signed}`}
                  </span>
                </div>
                <div className="order-search-customer">{r.customerName}</div>
                <div className="order-search-meta">
                  {so && <span>SO# {so}</span>}
                  {driver && <span>{driver}</span>}
                  {branch && <span>{branch}</span>}
                </div>
                {r.pod?.verified && onViewPod && (
                  <button
                    type="button"
                    className="order-search-pod"
                    onClick={(e) => { e.stopPropagation(); setOpen(false); onViewPod(r); }}
                  >
                    <FileCheck2 size={13} /> View proof
                  </button>
                )}
              </div>
            );
          })}

          {state.total > rows.length && (
            <div className="order-search-foot">
              Showing {rows.length} of {state.more ? `${state.total}+` : state.total} matches — type more to narrow it down.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DeliveryOrderSearch;
