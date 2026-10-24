import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { ClipboardList, ChevronLeft, ChevronRight, Check, Unlock, MapPin } from 'lucide-react';
import ExportMenu from './ExportMenu';
import type { ExportItem } from './ExportMenu';
import LocationFilter from '../../../components/shared/LocationFilter';
import { DatePicker, MonthPicker } from '../../../components/shared/calendar/Calendar';
import { todayISO, monthOf, shiftDay, shiftMonth, withMonth } from '../../../components/shared/calendar/calendarDates';
import { ALL } from '../reportFigures';
import type { Loose } from '../../../types/records';
import type { Report } from '../types';

export type ReportTopBarProps = {
  sidebarToggle: ReactNode;
  view: string;
  setView: (view: string) => void;
  date: string;
  setDate: (date: string) => void;
  /** The branches this person may report on. */
  locations: string[];
  /** The branch on screen, or ALL. */
  location: string;
  setLocation: (location: string) => void;
  currentUser: Loose | null;
  exportItems: ExportItem[];
  allBranches: boolean;
  submitted: boolean;
  canSubmit: boolean;
  canReopen: boolean;
  submitDay: () => void;
  loading: boolean;
  report: Report | null;
  saving: boolean;
  setReopenOpen: Dispatch<SetStateAction<boolean>>;
};

/** The bar over the sheet: Day / Month, the date stepper, the branch, Export, Submit / Reopen. */
export default function ReportTopBar({
  sidebarToggle, view, setView, date, setDate, locations, location, setLocation, currentUser,
  exportItems, allBranches, submitted, canSubmit, canReopen, submitDay, loading, report, saving, setReopenOpen
}: ReportTopBarProps) {
  return (
    <header className="dr-topbar">
      {sidebarToggle}
      <div className="dr-title">
        <ClipboardList size={19} />
        <h2>Daily Work Report</h2>
      </div>

      <div className="dr-viewtoggle" role="tablist" aria-label="Report view">
        <button
          role="tab"
          aria-selected={view === 'day'}
          className={view === 'day' ? 'on' : ''}
          onClick={() => setView('day')}
        >Day</button>
        <button
          role="tab"
          aria-selected={view === 'month'}
          className={view === 'month' ? 'on' : ''}
          onClick={() => setView('month')}
        >Month</button>
      </div>

      {view === 'day' ? (
        <div className="dr-datenav">
          <button onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
          {/* No leading icon: the native picker indicator inside the field is
              already a calendar, and two of them 130px apart is clutter. */}
          <DatePicker
            className="dr-datepick"
            variant="bare"
            icon="none"
            value={date}
            onChange={(next) => next && setDate(next)}
            ariaLabel="Report date"
            sheetTitle="Report date"
          />
          <button onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day"><ChevronRight size={16} /></button>
          {date !== todayISO() && (
            <button className="dr-today" onClick={() => setDate(todayISO())}>Today</button>
          )}
        </div>
      ) : (
        /* The month view had no way to leave the current month — the same
           stepper, a month at a time, over the one date both views share. */
        <div className="dr-datenav">
          <button onClick={() => setDate(shiftMonth(date, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <MonthPicker
            className="dr-datepick"
            variant="bare"
            icon="none"
            value={monthOf(date)}
            onChange={(ym) => ym && setDate(withMonth(date, ym))}
            ariaLabel="Report month"
            sheetTitle="Report month"
          />
          <button onClick={() => setDate(shiftMonth(date, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
          {monthOf(date) !== monthOf(todayISO()) && (
            <button className="dr-today" onClick={() => setDate(todayISO())}>This month</button>
          )}
        </div>
      )}

      {/* Only the branches assigned to this person, and "all" means all of
          those — never every branch the company has. With just one there's
          nothing to pick, but the sheet still says whose it is. */}
      {locations.length > 1 ? (
        <LocationFilter
          options={locations}
          value={location === ALL ? '' : location}
          onChange={(v) => setLocation(v || ALL)}
          user={currentUser}
        />
      ) : locations[0] ? (
        <span className="dr-locpick">
          <MapPin size={14} /> {locations[0]}
        </span>
      ) : null}

      <div className="dr-actions">
        <ExportMenu items={exportItems} />
        {view === 'day' && !allBranches && !submitted && canSubmit && (
          <button className="dr-btn dr-btn--gold" onClick={submitDay} disabled={loading || !report || saving}>
            <Check size={14} /> Submit day
          </button>
        )}
        {view === 'day' && !allBranches && submitted && canReopen && (
          <button className="dr-btn" onClick={() => setReopenOpen(true)}>
            <Unlock size={14} /> Reopen
          </button>
        )}
      </div>
    </header>
  );
}
