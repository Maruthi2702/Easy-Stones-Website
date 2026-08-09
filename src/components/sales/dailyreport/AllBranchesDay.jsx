import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertCircle, CalendarDays } from 'lucide-react';
import { API_URL } from '../../../config/api';
import SummaryTable, { SummaryStats } from './SummaryTable';
import { sumRows } from './summaryFigures';

/**
 * One day across every branch the viewer is assigned to.
 *
 * The form itself is per branch — a report belongs to the people who filled it
 * in and is submitted by one of them — so this is the day read rather than
 * written: the four branches side by side, each row a way into its own sheet.
 * Branches nobody has opened yet are listed as Not started, which is the whole
 * point of looking at the day this way.
 */

const longDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

const isToday = (iso) => {
  const d = new Date();
  return iso === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const AllBranchesDay = ({ date, authFetch, onOpenBranch }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const tzOffset = -new Date().getTimezoneOffset();
    authFetch(`${API_URL}/api/daily-reports/overview/${date}?tzOffset=${tzOffset}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).message || 'Could not load that day.');
        return r.json();
      })
      .then(data => { if (alive) setRows(data.rows || []); })
      .catch(err => { if (alive) { setError(err.message); setRows([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [authFetch, date]);

  const totals = useMemo(() => sumRows(rows), [rows]);
  const started = rows.filter(r => r.status !== 'none').length;
  const submitted = rows.filter(r => r.status === 'submitted').length;

  return (
    <div className="dr-month">
      <div className="dr-month-head">
        <h3>{longDate(date)}</h3>
        <span className="dr-scope">
          <CalendarDays size={12} /> {rows.length ? `All ${rows.length} locations` : 'All locations'}
        </span>
        {!loading && !error && rows.length > 0 && (
          <span className="dr-month-meta">
            {started} of {rows.length} started · {submitted} submitted
          </span>
        )}
      </div>

      {error && <div className="dr-error"><AlertCircle size={16} /> <span>{error}</span></div>}

      {loading ? (
        <div className="dr-empty"><Loader2 size={28} className="dr-spin" /><p>Loading every branch…</p></div>
      ) : rows.length === 0 ? (
        <div className="dr-empty">
          <AlertCircle size={28} />
          <p>No branches are assigned to you.</p>
          <span>Ask an administrator to assign you a location.</span>
        </div>
      ) : (
        <>
          <SummaryStats
            totals={totals}
            visitorsNote={`across ${rows.length} branch${rows.length === 1 ? '' : 'es'}`}
            paymentsNote={isToday(date) ? 'taken today' : 'taken that day'}
          />
          <SummaryTable
            lead={[{ header: 'Branch', render: r => r.location, className: 'dr-day' }]}
            rows={rows}
            totals={totals}
            totalLabel="All locations"
            onRowClick={(r) => onOpenBranch(r.location)}
            rowKey={(r) => r.location}
            rowTitle={(r) => `Open the ${r.location} report`}
          />
        </>
      )}
    </div>
  );
};

export default AllBranchesDay;
