import { useCallback, useState } from 'react';
import type { FuelMetadata } from '../../../fuelman/types';
import { MonthPicker } from '../../../components/shared/calendar/Calendar';
import { todayISO } from '../../../components/shared/calendar/calendarDates';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import { FUEL_MAN as P } from '../../../fuelman/permissions';
import { fuelApi, downloadFuel } from '../api';
import { money } from '../format';
import Tabs from './Tabs';
import { useFuelQuery } from '../useFuelQuery';
export default function LocationTotals({ metadata, initialMonth, reload }: { metadata: FuelMetadata; initialMonth?: string; reload: number }) {
  const [month, setMonth] = useState(initialMonth || todayISO().slice(0, 7)), [location, setLocation] = useState(''), [view, setView] = useState('locations');
  const [downloadError, setDownloadError] = useState('');
  const pager = usePagination();
  const read = useCallback((signal: AbortSignal) => fuelApi.pnl(month, location, signal), [month, location]);
  const { data, error, loading } = useFuelQuery(JSON.stringify([month, location, reload]), read);
  const count = data ? view === 'locations' ? data.locations.length : data.drivers.length : 0;
  const range = (pager.currentPage - 1) * pager.rowsPerPage;
  return <div className="fuel-panel"><div className="fuel-toolbar">
    <MonthPicker value={month} onChange={v => { setMonth(v); pager.resetPage(); setDownloadError(''); }} ariaLabel="P&L reporting month" sheetTitle="Reporting month" />
    <LocationPicker id="fuel-total-location" value={location} onChange={v => { setLocation(v); pager.resetPage(); setDownloadError(''); }} options={metadata.locations} allLabel="All permitted locations" />
    {metadata.permissions.includes(P.EXPORT) && <button onClick={() => void downloadFuel(`/pnl?month=${month}&location=${encodeURIComponent(location)}&format=csv`, `fuel-man-${month}.csv`).catch(e => setDownloadError(e.message))}>Export P&L input</button>}
  </div><p className="fuel-muted">Approved Fuel Man expense component by statement month. Payment records and unrelated P&L categories are kept separately.</p>
    {(error || downloadError) && <p className="fuel-error" role="alert">{error || downloadError}</p>}{loading && <p role="status">Loading location totals…</p>}
    {data && !loading && <><div className="fuel-stats"><div><span>Published expense total</span><strong>{data.reportCount ? money(data.totalCents) : 'Not published'}</strong></div>
      <div><span>Published reports</span><strong>{data.reportCount}</strong></div><div><span>Previous month · {data.previousMonth}</span><strong>{money(data.previousTotalCents)}</strong></div>
      <div><span>Change in expense</span><strong>{data.changePercent === null ? '—' : `${data.changePercent > 0 ? '+' : ''}${data.changePercent}%`}</strong></div></div>
      <Tabs label="Expense totals views" value={view as 'locations' | 'drivers'} onChange={id => { setView(id); pager.resetPage(); }} items={[{ id: 'locations', label: 'By location' }, { id: 'drivers', label: 'By driver' }]} />
      <div className="fuel-table-wrap"><table className="fuel-table"><thead>{view === 'locations' ? <tr><th>Location</th><th>Fuel</th><th>DEF</th><th>Supplies</th><th>Non-fuel tax</th><th>Adjustments</th><th>Total</th></tr> : <tr><th>Driver</th><th>Locations</th><th>Total expenses</th></tr>}</thead>
        <tbody>{view === 'locations' ? data.locations.slice(range, range + pager.rowsPerPage).map(row => <tr key={row.location}>
          <td data-label="Location"><strong>{row.location}</strong><small>{row.driverCount} drivers</small></td><td data-label="Fuel">{money(row.amounts.fuel)}</td><td data-label="DEF">{money(row.amounts.def)}</td><td data-label="Supplies">{money(row.amounts.supplies)}</td><td data-label="Non-fuel tax">{money(row.amounts.tax)}</td><td data-label="Adjustments">{money(row.amounts.adjustment)}</td><td data-label="Total"><strong>{money(row.totalCents)}</strong></td>
        </tr>) : data.drivers.slice(range, range + pager.rowsPerPage).map(row => <tr key={row.driverKey}><td data-label="Driver">{row.driverName}</td><td data-label="Locations">{row.locations.join(' / ')}</td><td data-label="Total expenses"><strong>{money(row.totalCents)}</strong></td></tr>)}</tbody></table></div>
      {!count && <p className="fuel-empty">No published expenses for this month and location selection. Unreviewed uploads are not included.</p>}
      <Pagination {...pager} totalPages={pageCount(count, pager.rowsPerPage)} totalCount={count} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
    </>}
  </div>;
}
