import { useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';
import { LocationField } from '../../../components/shared/LocationFilter';
import { MonthPicker, YearPicker } from '../../../components/shared/calendar/Calendar';
import { MONTH_NAMES } from '../../../components/shared/calendar/calendarDates';

/**
 * The Check-In Log's Filters button and its panel: branch (when there's more
 * than one), month and year. A month is always inside a year, so picking one
 * sets both; clearing the year clears the month with it.
 */
export type CheckInFiltersProps = {
  filterMonth: number | null;
  filterYear: number | null;
  filterLocation: string | null;
  onFilterMonthChange: (month: number | null) => void;
  onFilterYearChange: (year: number | null) => void;
  onFilterLocationChange: ((location: string | null) => void) | null;
  /** The branches this person may filter by (accessibleLocations). */
  locationOptions: string[];
  user: unknown;
};

export default function CheckInFilters({
  filterMonth, filterYear, filterLocation, onFilterMonthChange, onFilterYearChange,
  onFilterLocationChange, locationOptions, user
}: CheckInFiltersProps) {
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  // A click or tap anywhere outside the filter button and its panel closes
  // it (same as LocationFilter's panel on the other pages); Escape does too.
  useEffect(() => {
    if (!showFilterDropdown) return undefined;
    const onDown = (e: Event) => { if (!filterRef.current?.contains(e.target as Node)) setShowFilterDropdown(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) setShowFilterDropdown(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showFilterDropdown]);

  return (
    <div className="clp-filter-container" ref={filterRef}>
      <button
        type="button"
        className={`clp-filter-btn ${(filterMonth || filterYear || filterLocation) ? 'clp-filter-active' : ''}`}
        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
        title={filterMonth && filterYear ? `Filters — ${MONTH_NAMES[filterMonth - 1]} ${filterYear}` : 'Filter Check-ins'}
        aria-label={filterMonth && filterYear ? `Filters, currently ${MONTH_NAMES[filterMonth - 1]} ${filterYear}` : 'Filter check-ins'}
      >
        <Filter size={14} />
        <span className="clp-filter-label">
          {filterMonth && filterYear
            ? `${MONTH_NAMES[filterMonth - 1]} ${filterYear}`
            : 'Filters'}
        </span>
        {(filterMonth || filterYear || filterLocation) && (
          <span className="clp-filter-dot" />
        )}
      </button>

      {showFilterDropdown && (
        <div className="clp-filter-popover">
          <div className="clp-filter-popover-header">
            <span>Filter Check-ins</span>
            <button 
              type="button" 
              className="clp-filter-popover-close"
              onClick={() => setShowFilterDropdown(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="clp-filter-popover-body">
            {/* The shared location field (LocationFilter.jsx), offered
                only when there's more than one branch to choose. */}
            {onFilterLocationChange && locationOptions.length > 1 && (
              <LocationField
                options={locationOptions}
                value={filterLocation || ''}
                onChange={(val) => onFilterLocationChange(val || null)}
                user={user}
              />
            )}

            {/* Month and Year are the shared calendar (shared/calendar).
                A month is always inside a year, so picking one sets
                both; clearing the year clears the month with it. */}
            <div className="filter-select-group">
              <label htmlFor="clp-filter-month">Month</label>
              <MonthPicker
                id="clp-filter-month"
                value={filterMonth && filterYear ? `${filterYear}-${String(filterMonth).padStart(2, '0')}` : ''}
                onChange={(ym) => {
                  if (!ym) { onFilterMonthChange(null); return; }
                  onFilterYearChange(Number(ym.slice(0, 4)));
                  onFilterMonthChange(Number(ym.slice(5, 7)));
                }}
                placeholder="Any month"
                clearable
                sheetTitle="Month"
              />
            </div>
            <div className="filter-select-group">
              <label htmlFor="clp-filter-year">Year</label>
              <YearPicker
                id="clp-filter-year"
                value={filterYear || ''}
                onChange={(y) => {
                  if (!y) { onFilterYearChange(null); onFilterMonthChange(null); return; }
                  onFilterYearChange(Number(y));
                }}
                placeholder="Any year"
                clearable
                sheetTitle="Year"
              />
            </div>
          </div>
          <div className="clp-filter-popover-footer">
            <button
              type="button"
              onClick={() => {
                onFilterMonthChange(null);
                onFilterYearChange(null);
                if (onFilterLocationChange) onFilterLocationChange(null);
                setShowFilterDropdown(false);
              }}
              className="filter-btn-clear"
            >
              Clear Filter
            </button>
            <button
              type="button"
              onClick={() => setShowFilterDropdown(false)}
              className="filter-btn-apply"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
