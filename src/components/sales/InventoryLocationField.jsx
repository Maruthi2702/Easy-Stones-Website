import React, { useId, useState } from 'react';
import { Search } from 'lucide-react';
import { homeLocationOf } from '../../utils/locationFilter';

// Past this many consignment sites the list gets a search box.
const SEARCH_FROM = 8;

/**
 * Inventory Analysis's location picker, inside the shared Filters panel
 * (LocationFilter's extra-fields slot). Easy Stones' own locations come first;
 * the fabricators holding our stock on consignment follow under their own
 * heading, searchable and in a scrolling list, since there are ~90 of them.
 * Rules for which is which, and where it opens: src/utils/inventoryLocations.js.
 *
 * `value` is the picked locations, [] meaning every location. Uses the shared
 * filter's lf-* styles so it looks like every other location filter.
 */
const InventoryLocationField = ({ company = [], consignment = [], value = [], onChange, user = null }) => {
  const id = useId();
  const [query, setQuery] = useState('');
  const picked = Array.isArray(value) ? value : [];
  const home = homeLocationOf(user);
  const toggle = (name) => onChange?.(picked.includes(name) ? picked.filter(v => v !== name) : [...picked, name]);

  const q = query.trim().toLowerCase();
  const shownConsignment = q ? consignment.filter(n => n.toLowerCase().includes(q)) : consignment;
  const pickedConsignment = consignment.filter(n => picked.includes(n)).length;

  const box = (name, label = name) => (
    <label key={name} className="lf-check">
      <input type="checkbox" checked={picked.includes(name)} onChange={() => toggle(name)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="lf-group invan-loc" role="group" aria-labelledby={`${id}-label`}>
      <span className="lf-group-label" id={`${id}-label`}>Locations</span>
      <div className="lf-checks">
        <label className="lf-check">
          <input type="checkbox" checked={picked.length === 0} onChange={() => onChange?.([])} />
          <span>All locations</span>
        </label>
      </div>

      {company.length > 0 && (
        <div className="invan-loc-section">
          <span className="invan-loc-heading">Easy Stones locations</span>
          <div className="lf-checks">
            {company.map(n => box(n, n === home ? `${n} · Home` : n))}
          </div>
        </div>
      )}

      {consignment.length > 0 && (
        <div className="invan-loc-section">
          <span className="invan-loc-heading">
            Consignment locations ({consignment.length})
            {pickedConsignment > 0 && <span className="invan-loc-count"> · {pickedConsignment} selected</span>}
          </span>
          {consignment.length > SEARCH_FROM && (
            <label className="invan-loc-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search consignment locations"
                aria-label="Search consignment locations"
              />
            </label>
          )}
          <div className="lf-checks invan-loc-scroll">
            {shownConsignment.map(n => box(n))}
            {shownConsignment.length === 0 && <span className="invan-loc-empty">No match for “{query.trim()}”</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryLocationField;
