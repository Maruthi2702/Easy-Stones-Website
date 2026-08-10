import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertCircle, MapPin } from 'lucide-react';
import { API_URL } from '../../../config/api';
import SummaryTable, { SummaryStats } from './SummaryTable';
import { sumRows } from './summaryFigures';

/**
 * The month, one row per day — the part a folder of spreadsheets can't give
 * you. Totals sit at the foot rather than the head so the columns line up
 * under the numbers they add.
 *
 * Days nobody filed in are listed too, up to today: a month that shows only the
 * days somebody remembered looks complete when it isn't, and the gap is the one
 * thing a manager opens this view to find. Across all branches at once that
 * would be four rows a day of mostly nothing, so there the filed days stand on
 * their own.
 *
 * The branch is chosen once, in the top bar, and this view follows it — it used
 * to carry a second selector of its own, which left two controls for one
 * decision and no way to tell which had won.
 */

const dayLabel = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Every day of the month that has already happened, newest first. A month still
 * running stops at today — tomorrow isn't missing, it just hasn't arrived.
 */
const elapsedDays = (month) => {
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  if (month > thisMonth) return [];

  const [y, m] = month.split('-').map(Number);
  const lastOfMonth = new Date(y, m, 0).getDate();
  const last = month === thisMonth ? Number(today.slice(8, 10)) : lastOfMonth;

  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).reverse();
};

const blankDay = (date, location) => ({
  date,
  location,
  status: 'none',
  visitors: 0,
  deliveries: 0,
  pickups: 0,
  transferCount: 0,
  transferSlabs: 0,
  containerCount: 0,
  containerSlabs: 0,
  payments: 0
});

const MonthView = ({ month, location, locations = [], authFetch, onOpenDay }) => {
  const [filed, setFiled] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const allBranches = location === 'all';

  useEffect(() => {
    if (!location) return undefined;
    let alive = true;
    setLoading(true);
    setError(null);
    authFetch(`${API_URL}/api/daily-reports?month=${month}&location=${encodeURIComponent(location)}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).message || 'Could not load the month.');
        return r.json();
      })
      .then(data => { if (alive) setFiled(data.reports || []); })
      .catch(err => { if (alive) { setError(err.message); setFiled([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [authFetch, month, location]);

  const rows = useMemo(() => {
    if (allBranches) {
      return [...filed].sort((a, b) =>
        b.date.localeCompare(a.date) || a.location.localeCompare(b.location));
    }
    const byDate = new Map(filed.map(r => [r.date, r]));
    const days = elapsedDays(month);
    // A day filed ahead of today (or after the month ended) still belongs here.
    for (const r of filed) if (!days.includes(r.date)) days.push(r.date);
    return days
      .sort((a, b) => b.localeCompare(a))
      .map(d => byDate.get(d) || blankDay(d, location));
  }, [filed, month, location, allBranches]);

  const totals = useMemo(() => sumRows(rows), [rows]);

  const monthLabel = new Date(`${month}-01T00:00:00`)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const current = month === todayISO().slice(0, 7);
  const branchLabel = allBranches
    ? `All ${locations.length} locations`
    : location;

  const filedDays = allBranches
    ? new Set(filed.map(r => r.date)).size
    : filed.length;
  const submitted = filed.filter(r => r.status === 'submitted').length;

  const lead = allBranches
    ? [
        { header: 'Day', render: r => dayLabel(r.date), className: 'dr-day' },
        { header: 'Branch', render: r => r.location, className: 'dr-branch' }
      ]
    : [{ header: 'Day', render: r => dayLabel(r.date), className: 'dr-day' }];

  return (
    <div className="dr-month">
      <div className="dr-month-head">
        <h3>{monthLabel}</h3>
        <span className="dr-scope"><MapPin size={12} /> {branchLabel}</span>
        {!loading && !error && (
          <span className="dr-month-meta">
            {filedDays === 0
              ? 'nothing filed yet'
              : `${filedDays} day${filedDays === 1 ? '' : 's'} filed · ${submitted} submitted`}
          </span>
        )}
      </div>

      {error && <div className="dr-error"><AlertCircle size={16} /> <span>{error}</span></div>}

      {!location ? (
        <div className="dr-empty">
          <AlertCircle size={28} />
          <p>No branches are assigned to you.</p>
          <span>Ask an administrator to assign you a location.</span>
        </div>
      ) : loading ? (
        <div className="dr-empty"><Loader2 size={28} className="dr-spin" /><p>Loading {monthLabel}…</p></div>
      ) : rows.length === 0 ? (
        <div className="dr-empty">
          <AlertCircle size={28} />
          <p>Nothing to show for {monthLabel}.</p>
          <span>{current ? 'Days appear here as they are filled in.' : 'This month is still ahead.'}</span>
        </div>
      ) : (
        <>
          <SummaryStats
            totals={totals}
            visitorsNote={`across ${filedDays} day${filedDays === 1 ? '' : 's'} filed`}
            paymentsNote={current ? 'taken month to date' : `taken in ${monthLabel}`}
          />
          <SummaryTable
            lead={lead}
            rows={rows}
            totals={totals}
            totalLabel={current ? 'Month to date' : 'Month total'}
            onRowClick={(r) => onOpenDay(r.date, r.location)}
            rowKey={(r) => `${r.date}-${r.location}`}
            rowTitle={(r) => `Open ${r.location} · ${dayLabel(r.date)}`}
          />
        </>
      )}
    </div>
  );
};

export default MonthView;
