import type { ReactNode } from 'react';
import { BarChart3, Lock } from 'lucide-react';
import LocationFilter from '../../../components/shared/LocationFilter';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import DashboardSearch from '../../../components/shared/DashboardSearch';
import { RECEIVED_METHODS } from '../../../utils/paymentsReceived';
import { homeLocationOf } from '../../../utils/locationFilter';
import { dayLabel, type PaymentFilters } from '../paymentsView';
import type { PaymentsUser } from '../types';

export type PaymentsHeaderProps = {
  sidebarToggle: ReactNode;
  user: PaymentsUser | null;
  locations: string[];
  location: string;
  onLocation: (location: string) => void;
  date: string;
  today: string;
  onDate: (date: string) => void;
  locked: boolean;
  filters: PaymentFilters;
  onFilters: (patch: Partial<PaymentFilters>) => void;
  voidedCount: number;
  searchCount: string | null;
  isPhone: boolean;
  onStats: () => void;
};

/**
 * Title with the branch · day under it, then (owner's calls on the prototype)
 * the app's search box and the shared Filters button together in the right
 * corner. Filters holds Day, Location, Method and Show voided; its gold dot
 * is on when anything but today's day at home with every method is showing.
 * On a phone a stats button opens the day's totals.
 */
export default function PaymentsHeader(p: PaymentsHeaderProps) {
  const home = homeLocationOf(p.user || {});
  const defaultLocation = p.locations.includes(home) ? home : p.locations[0] || '';
  const active = p.filters.method !== 'all' || p.filters.showVoided || (p.locations.length > 0 && p.location !== defaultLocation) || p.date !== p.today;
  return (
    <div className="pay-head">
      {p.sidebarToggle}
      <div className="pay-ttl">
        <h1>Payments</h1>
        <span>{p.location || 'All locations'}{p.location && p.location === home ? ' · Home' : ''} · {dayLabel(p.date)}</span>
      </div>
      {p.locked ? <span className="pay-pill"><Lock size={12} aria-hidden="true" /> Submitted</span> : null}
      {p.isPhone ? (
        <button type="button" className="pay-round" onClick={p.onStats} aria-label="Totals for the day" title="Totals for the day">
          <BarChart3 size={16} aria-hidden="true" />
        </button>
      ) : null}
      <div className="pay-tools">
        <DashboardSearch value={p.filters.search} onChange={(search) => p.onFilters({ search })} label="Search payments"
          placeholder="Search company, invoice, note" count={p.searchCount} />
        <LocationFilter
          options={[]}
          value=""
          onChange={() => {}}
          user={p.user}
          active={active}
          onClear={() => {
            p.onFilters({ method: 'all', showVoided: false });
            p.onDate(p.today);
            if (defaultLocation) p.onLocation(defaultLocation);
          }}
        >
          <div className="lf-group">
            <label className="lf-group-label" htmlFor="pay-filter-day">Day</label>
            <DatePicker id="pay-filter-day" value={p.date} max={p.today} today={p.today} onChange={(d) => d && p.onDate(d)} sheetTitle="Day" />
          </div>
          {p.locations.length > 1 ? (
            <div className="lf-group pay-filter-gap">
              <label className="lf-group-label" htmlFor="pay-filter-location">Location</label>
              <LocationPicker id="pay-filter-location" value={p.location} onChange={p.onLocation}
                allLabel="All locations" options={p.locations} user={p.user} sheetTitle="Location" />
            </div>
          ) : null}
          <div className="lf-group pay-filter-gap">
            <label className="lf-group-label" htmlFor="pay-filter-method">Method</label>
            <select id="pay-filter-method" className="lf-select" value={p.filters.method} onChange={(e) => p.onFilters({ method: e.target.value })}>
              <option value="all">All methods</option>
              {RECEIVED_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <label className="pay-check pay-filter-gap">
            <input type="checkbox" checked={p.filters.showVoided} onChange={(e) => p.onFilters({ showVoided: e.target.checked })} />
            Show voided{p.voidedCount ? ` (${p.voidedCount})` : ''}
          </label>
        </LocationFilter>
      </div>
    </div>
  );
}
