import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertCircle, Lock, FileEdit, Minus } from 'lucide-react';
import { API_URL } from '../../../config/api';

/**
 * The month, one row per day — the part a folder of spreadsheets can't give
 * you. Totals sit at the foot rather than the head so the columns line up
 * under the numbers they add.
 */

const STATUS = {
  submitted: { label: 'Submitted', cls: 'ok', Icon: Lock },
  draft: { label: 'Draft', cls: 'warn', Icon: FileEdit },
  closed: { label: 'Closed', cls: 'off', Icon: Minus }
};

const dayLabel = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
};

const money = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MonthView = ({ month, location, locations = [], authFetch, onOpenDay }) => {
  const [scope, setScope] = useState(location || 'all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { setScope(location || 'all'); }, [location]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    authFetch(`${API_URL}/api/daily-reports?month=${month}&location=${encodeURIComponent(scope)}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).message || 'Could not load the month.');
        return r.json();
      })
      .then(data => { if (alive) setRows(data.reports || []); })
      .catch(err => { if (alive) { setError(err.message); setRows([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [authFetch, month, scope]);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    visitors: t.visitors + (r.visitors || 0),
    deliveries: t.deliveries + (r.deliveries || 0),
    pickups: t.pickups + (r.pickups || 0),
    transferSlabs: t.transferSlabs + (r.transferSlabs || 0),
    containerSlabs: t.containerSlabs + (r.containerSlabs || 0),
    payments: t.payments + (r.payments || 0)
  }), { visitors: 0, deliveries: 0, pickups: 0, transferSlabs: 0, containerSlabs: 0, payments: 0 }), [rows]);

  const showBranch = scope === 'all' && locations.length > 1;
  const monthLabel = new Date(`${month}-01T00:00:00`)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="dr-month">
      <div className="dr-month-head">
        <h3>{monthLabel}</h3>
        {locations.length > 1 && (
          <label className="dr-locpick">
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Branch filter">
              <option value="all">All branches</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <div className="dr-error"><AlertCircle size={16} /> <span>{error}</span></div>}

      {loading ? (
        <div className="dr-empty"><Loader2 size={28} className="dr-spin" /><p>Loading {monthLabel}…</p></div>
      ) : rows.length === 0 ? (
        <div className="dr-empty">
          <AlertCircle size={28} />
          <p>No reports filed for {monthLabel}.</p>
          <span>Days appear here once someone starts filling one in.</span>
        </div>
      ) : (
        <div className="dr-card">
          <div className="dr-table-scroll">
            <table className="dr-table dr-table--month">
              <thead>
                <tr>
                  <th>Day</th>
                  {showBranch && <th>Branch</th>}
                  <th className="dr-num">Visitors</th>
                  <th className="dr-num">Deliveries</th>
                  <th className="dr-num">Pick-ups</th>
                  <th className="dr-num">Transfer slabs</th>
                  <th className="dr-num">Container slabs</th>
                  <th className="dr-num">Payments</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const s = STATUS[r.status] || STATUS.draft;
                  return (
                    <tr key={`${r.date}-${r.location}`} className="dr-monthrow" onClick={() => onOpenDay(r.date)}>
                      <td className="dr-day">{dayLabel(r.date)}</td>
                      {showBranch && <td>{r.location}</td>}
                      <td className="dr-num">{r.visitors || '—'}</td>
                      <td className="dr-num">{r.deliveries || '—'}</td>
                      <td className="dr-num">{r.pickups || '—'}</td>
                      <td className="dr-num">{r.transferSlabs || '—'}</td>
                      <td className="dr-num">{r.containerSlabs || '—'}</td>
                      <td className="dr-num">{r.payments ? money(r.payments) : '—'}</td>
                      <td>
                        <span className={`dr-status dr-status--${s.cls}`} title={r.submittedBy ? `by ${r.submittedBy}` : undefined}>
                          <s.Icon size={11} /> {s.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                <tr className="dr-total">
                  <td>Month to date</td>
                  {showBranch && <td />}
                  <td className="dr-num">{totals.visitors}</td>
                  <td className="dr-num">{totals.deliveries}</td>
                  <td className="dr-num">{totals.pickups}</td>
                  <td className="dr-num">{totals.transferSlabs}</td>
                  <td className="dr-num">{totals.containerSlabs}</td>
                  <td className="dr-num">{money(totals.payments)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonthView;
