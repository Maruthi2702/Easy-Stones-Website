import { ChevronLeft, ChevronRight, Plus, ArrowLeftRight, Search, X } from 'lucide-react';
import DeliveryOrderSearch from './search/DeliveryOrderSearch';
import LocationFilter from '../../components/shared/LocationFilter';
import { DatePicker } from '../../components/shared/calendar/Calendar';
import { isoOf, todayISO, shiftDay } from '../../components/shared/calendar/calendarDates';
import type { CurrentUser } from '../../types/records';
import type { SearchResultInfo } from './search/DeliveryOrderSearch';
import type { BoardColumn, ScheduleRole, Ticket } from './types';

export type ScheduleHeaderProps = {
  sidebarToggle: React.ReactNode;
  role: ScheduleRole;
  currentUser: CurrentUser | null;
  currentMonday: Date;
  weekRangeText: string;
  handlePrevWeek: () => void;
  handleTodayWeek: () => void;
  handleNextWeek: () => void;
  handlePickWeek: (iso: string) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  filterableLocations: string[];
  locationFilter: string;
  setLocationFilter: (next: unknown) => void;
  canArrangeColumns: boolean;
  setArrangeOpen: (open: boolean) => void;
  handleOrderSearchSelect: (result: Ticket, info: SearchResultInfo) => void;
  handleOpenPodViewer: (delivery: Ticket) => void;
  trucks: BoardColumn[];
  handleOpenAddModal: () => void;
};

/** The Delivery Schedule's one-row toolbar: title, week, Search & filters, Add delivery. */
export default function ScheduleHeader({
  sidebarToggle, role, currentUser, currentMonday, weekRangeText, handlePrevWeek, handleTodayWeek, handleNextWeek,
  handlePickWeek, searchQuery, setSearchQuery, filterableLocations, locationFilter, setLocationFilter,
  canArrangeColumns, setArrangeOpen, handleOrderSearchSelect, handleOpenPodViewer, trucks, handleOpenAddModal
}: ScheduleHeaderProps) {
  return (
    /* ── OPTION 1: 1-ROW COMPACT LUXURY TOOLBAR ── */
    <div className="manifest-top-header header-option-1">
      {/* Left: Title + Sidebar Menu Button */}
      <div className="manifest-title-block">
        {sidebarToggle}
        <div>
          <h2 className="manifest-title">Delivery Schedule</h2>
        </div>
      </div>

      {/* Center: Integrated Glass Pill Nav */}
      <div className="header-glass-pill-nav">
        <div className="week-nav-btn-group">
          <button type="button" className="btn-week-arrow" onClick={handlePrevWeek} title="Previous Week">
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="btn-week-today" onClick={handleTodayWeek} title="Current Week">
            Today
          </button>
          <button type="button" className="btn-week-arrow" onClick={handleNextWeek} title="Next Week">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="pill-divider-line" />
        {/* The week itself opens the calendar: pick any day to jump to its week. */}
        <DatePicker
          variant="bare"
          triggerClassName="week-range-label-text"
          value={isoOf(currentMonday)}
          highlightWeek
          formatText={() => weekRangeText}
          onChange={handlePickWeek}
          shortcuts={[
            { label: 'This week', value: todayISO() },
            { label: 'Next week', value: shiftDay(todayISO(), 7) }
          ]}
          ariaLabel="Week shown"
          sheetTitle="Go to week"
        />
      </div>

      {/* Right: Filters (order search + location) / New Ticket Action */}
      <div className="manifest-header-actions">
        {/* While the panel is shut, a search still filtering the board says
            so here — otherwise rows would vanish with no visible reason. */}
        {role !== 'driver' && searchQuery.trim() && (
          <button
            type="button"
            className="delivery-search-chip"
            onClick={() => setSearchQuery('')}
            title="Clear search"
            aria-label={`Clear search "${searchQuery.trim()}"`}
          >
            <Search size={13} aria-hidden="true" />
            <span className="delivery-search-chip-text">{searchQuery.trim()}</span>
            <X size={13} aria-hidden="true" />
          </button>
        )}

        {/* Order search lives in the Filters panel, above Location — every
            date, the user's own branches only, and it still filters the week
            on screen. Drivers don't get it (the server refuses them too), so
            theirs is the plain location filter. Picking a result shuts the
            panel before jumping to the order. */}
        {role !== 'driver' ? (
          <LocationFilter
            options={filterableLocations}
            value={locationFilter}
            onChange={setLocationFilter}
            user={currentUser}
            label="Search & filters"
            wide
            active={Boolean(searchQuery.trim())}
            onClear={() => setSearchQuery('')}
            // Below Location, since it arranges the location picked there —
            // so only once one is picked.
            after={canArrangeColumns && locationFilter ? ({ close }) => (
              <button
                type="button"
                className="delivery-arrange-btn"
                onClick={() => { close(); setArrangeOpen(true); }}
              >
                <ArrowLeftRight size={14} aria-hidden="true" />
                Arrange Driver Columns
              </button>
            ) : null}
          >
            {({ close }) => (
              <div className="lf-group">
                <span className="lf-group-label">Search orders</span>
                <DeliveryOrderSearch
                  inline
                  autoFocus
                  value={searchQuery}
                  onChange={setSearchQuery}
                  onSelect={(result, info) => { close(); handleOrderSearchSelect(result, info); }}
                  onViewPod={(delivery) => { close(); handleOpenPodViewer(delivery); }}
                  trucks={trucks}
                  viewerLocations={currentUser?.assignedLocations || []}
                />
              </div>
            )}
          </LocationFilter>
        ) : (
          <LocationFilter
            options={filterableLocations}
            value={locationFilter}
            onChange={setLocationFilter}
            user={currentUser}
          />
        )}

        {role === 'office' && (
          <button
            type="button"
            className="btn-add-delivery gold-glow-btn"
            onClick={() => handleOpenAddModal()}
            aria-label="Add delivery"
            title="Add delivery"
          >
            <Plus size={16} />
            {/* "Delivery" drops on small phones so the header row fits
                beside the title (DeliveryScheduleTab.css). */}
            <span>Add<span className="btn-add-delivery-word"> Delivery</span></span>
          </button>
        )}
      </div>
    </div>
  );
}
