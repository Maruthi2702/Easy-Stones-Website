import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Users, Truck, ArrowLeftRight, Package, Wallet, ClipboardList,
  ChevronLeft, ChevronRight, Plus, X, Check, Lock, Unlock,
  Download, CalendarDays, MapPin, AlertCircle, Loader2
} from 'lucide-react';
import { API_URL } from '../../../config/api';
import ReportSection from './ReportSection';
import { ReportCell, MoneyCell } from './ReportCell';
import MonthView from './MonthView';
import './DailyReport.css';

/**
 * Daily Work Report — the spreadsheet the branches filled in every evening.
 *
 * Half of it the system already knows: the visitor count comes from the
 * check-in log and the assigned deliveries and pick-ups from the schedule.
 * Those arrive filled in and marked, and stay editable — if someone walked in
 * without signing the kiosk, the person on shift is right and the system isn't.
 */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const monthOf = (iso) => iso.slice(0, 7);

const shiftDay = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const longDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const emptyReport = (date, location) => ({
  date,
  location,
  status: 'draft',
  visitors: { homeowners: 0, fabricators: 0, designers: 0 },
  deliveries: { assigned: 0, capacity: 0 },
  pickups: { assigned: 0, capacity: 0 },
  returns: 0,
  sinks: 0,
  transfers: [],
  containers: [],
  payments: { cash: { count: 0, amount: 0 }, card: { count: 0, amount: 0 }, check: { count: 0, amount: 0 } },
  notes: ''
});

const DailyReportTab = ({ currentUser = null, sidebarToggle = null }) => {
  const perms = currentUser?.permissions || [];
  const canEdit = perms.includes('edit_daily_report');
  const canSubmit = perms.includes('submit_daily_report');
  const canReopen = perms.includes('reopen_daily_report');

  const [view, setView] = useState('day');           // 'day' | 'month'
  const [date, setDate] = useState(todayISO);
  const [locations, setLocations] = useState([]);
  const [location, setLocation] = useState('');
  const [canExportAll, setCanExportAll] = useState(false);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const saveTimer = useRef(null);
  const skipAutosave = useRef(true);

  const token = () => localStorage.getItem('token') || localStorage.getItem('adminToken');
  const authFetch = useCallback((url, options = {}) => {
    const t = token();
    return fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
        ...(t ? { Authorization: `Bearer ${t}` } : {})
      }
    });
  }, []);

  // ── which branches this person may report on ──────────────────────────────
  useEffect(() => {
    let alive = true;
    authFetch(`${API_URL}/api/daily-reports/locations`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load your branches.')))
      .then(data => {
        if (!alive) return;
        const list = data.locations || [];
        setLocations(list);
        setCanExportAll(Boolean(data.canExportAll));
        setLocation(prev => prev || list[0] || '');
      })
      .catch(err => alive && setError(err.message));
    return () => { alive = false; };
  }, [authFetch]);

  // ── load the day ──────────────────────────────────────────────────────────
  const loadDay = useCallback(async () => {
    if (!location) return;
    setLoading(true);
    setError(null);
    try {
      const tzOffset = -new Date().getTimezoneOffset();
      const res = await authFetch(
        `${API_URL}/api/daily-reports/${date}?location=${encodeURIComponent(location)}&tzOffset=${tzOffset}`
      );
      if (!res.ok) throw new Error((await res.json()).message || 'Could not load that day.');
      const data = await res.json();
      skipAutosave.current = true;
      setReport({ ...emptyReport(date, location), ...data.report });
      setDirty(false);
    } catch (err) {
      setError(err.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [authFetch, date, location]);

  useEffect(() => { if (view === 'day') loadDay(); }, [loadDay, view]);

  // ── autosave the draft ────────────────────────────────────────────────────
  const save = useCallback(async (payload) => {
    if (!canEdit || payload.status === 'submitted') return;
    setSaving(true);
    try {
      const res = await authFetch(`${API_URL}/api/daily-reports/${payload.date}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Could not save.');
      setSavedAt(new Date());
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [authFetch, canEdit]);

  useEffect(() => {
    if (!report || !canEdit || report.status === 'submitted') return;
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    setDirty(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(report), 1200);
    return () => clearTimeout(saveTimer.current);
  }, [report, canEdit, save]);

  // ── editing helpers ───────────────────────────────────────────────────────
  const locked = !canEdit || report?.status === 'submitted';

  const patch = (fn) => setReport(prev => (prev ? fn(structuredClone(prev)) : prev));

  const setPath = (path, value) => patch(r => {
    const keys = path.split('.');
    let node = r;
    for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]];
    node[keys[keys.length - 1]] = value;
    return r;
  });

  // ── totals, computed and never typed ──────────────────────────────────────
  const totals = useMemo(() => {
    if (!report) return null;
    const v = report.visitors;
    return {
      visitors: n(v.homeowners) + n(v.fabricators) + n(v.designers),
      assigned: n(report.deliveries.assigned) + n(report.pickups.assigned),
      capacity: n(report.deliveries.capacity) + n(report.pickups.capacity),
      transferCount: report.transfers.reduce((s, t) => s + n(t.count), 0),
      transferSlabs: report.transfers.reduce((s, t) => s + n(t.slabs), 0),
      containerSlabs: report.containers.reduce((s, c) => s + n(c.slabs), 0),
      payCount: ['cash', 'card', 'check'].reduce((s, k) => s + n(report.payments[k].count), 0),
      payAmount: ['cash', 'card', 'check'].reduce((s, k) => s + n(report.payments[k].amount), 0)
    };
  }, [report]);

  const submitDay = async () => {
    clearTimeout(saveTimer.current);
    await save(report);
    const res = await authFetch(`${API_URL}/api/daily-reports/${date}/submit`, {
      method: 'POST',
      body: JSON.stringify({ location })
    });
    if (res.ok) { loadDay(); } else { setError((await res.json()).message); }
  };

  const reopenDay = async () => {
    const res = await authFetch(`${API_URL}/api/daily-reports/${date}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ location, reason: reopenReason })
    });
    if (res.ok) {
      setReopenOpen(false);
      setReopenReason('');
      loadDay();
    } else {
      setError((await res.json()).message);
    }
  };

  const exportCsv = (scope) => {
    const qs = scope === 'all' ? 'all' : encodeURIComponent(location);
    window.open(`${API_URL}/api/daily-reports/export/${monthOf(date)}?location=${qs}`, '_blank', 'noopener');
  };

  // ── render ────────────────────────────────────────────────────────────────
  if (!perms.includes('view_daily_report')) {
    return (
      <div className="dr-root">
        <div className="dr-empty">
          <AlertCircle size={34} />
          <p>You don't have access to the Daily Report.</p>
          <span>Ask an administrator for the <strong>View</strong> permission under Daily Report.</span>
        </div>
      </div>
    );
  }

  const submitted = report?.status === 'submitted';

  return (
    <div className="dr-root">
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

        {view === 'day' && (
          <div className="dr-datenav">
            <button onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
            <label className="dr-datepick">
              <CalendarDays size={14} />
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <button onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day"><ChevronRight size={16} /></button>
            {date !== todayISO() && (
              <button className="dr-today" onClick={() => setDate(todayISO())}>Today</button>
            )}
          </div>
        )}

        <label className="dr-locpick">
          <MapPin size={14} />
          <select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Branch">
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>

        <div className="dr-actions">
          <button className="dr-btn" onClick={() => exportCsv('branch')} title={`Export ${location} for ${monthOf(date)}`}>
            <Download size={14} /> Export {location || 'branch'}
          </button>
          {canExportAll && (
            <button className="dr-btn" onClick={() => exportCsv('all')} title={`Export every branch for ${monthOf(date)}`}>
              <Download size={14} /> All branches
            </button>
          )}
          {view === 'day' && !submitted && canSubmit && (
            <button className="dr-btn dr-btn--gold" onClick={submitDay} disabled={loading || !report}>
              <Check size={14} /> Submit day
            </button>
          )}
          {view === 'day' && submitted && canReopen && (
            <button className="dr-btn" onClick={() => setReopenOpen(true)}>
              <Unlock size={14} /> Reopen
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="dr-error" role="alert">
          <AlertCircle size={16} /> <span>{error}</span>
        </div>
      )}

      {view === 'month' ? (
        <MonthView
          month={monthOf(date)}
          location={location}
          locations={locations}
          authFetch={authFetch}
          onOpenDay={(d) => { setDate(d); setView('day'); }}
        />
      ) : loading ? (
        <div className="dr-empty"><Loader2 size={30} className="dr-spin" /><p>Loading {longDate(date)}…</p></div>
      ) : !report ? (
        <div className="dr-empty"><AlertCircle size={30} /><p>Nothing to show for this day.</p></div>
      ) : (
        <>
          <div className="dr-statusline">
            <span className="dr-daylabel">{longDate(date)} · {location}</span>
            {submitted ? (
              <span className="dr-badge dr-badge--done">
                <Lock size={11} /> Submitted{report.submittedBy ? ` by ${report.submittedBy}` : ''}
              </span>
            ) : (
              <span className="dr-badge">
                {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? `Draft · saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Draft'}
              </span>
            )}
            {!canEdit && <span className="dr-badge">Read only</span>}
          </div>

          <div className="dr-grid">

            {/* ── Visitors ── */}
            <ReportSection
              title="Visitors"
              icon={Users}
              source={{ kind: 'auto', label: `${n(report.visitors.homeowners)} from the check-in log` }}
              footnote="Homeowners counted from today's check-ins. Type over it if someone didn't sign in."
            >
              <table className="dr-table">
                <tbody>
                  {[
                    ['Homeowners', 'visitors.homeowners', true],
                    ['Fabricators', 'visitors.fabricators', false],
                    ['Designers', 'visitors.designers', false]
                  ].map(([label, path, derived]) => (
                    <tr key={path}>
                      <td>{label}</td>
                      <td className="dr-num">
                        <ReportCell
                          value={report.visitors[path.split('.')[1]]}
                          derived={derived}
                          disabled={locked}
                          ariaLabel={label}
                          onChange={(v) => setPath(path, v)}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr className="dr-total"><td>Total</td><td className="dr-num">{totals.visitors}</td></tr>
                </tbody>
              </table>
            </ReportSection>

            {/* ── Delivery & Pick-Up ── */}
            <ReportSection
              title="Delivery & Pick-Up Summary"
              icon={Truck}
              source={{ kind: 'auto', label: 'assigned, from the schedule' }}
              footnote="Capacity is what the drivers on shift could take."
            >
              <table className="dr-table">
                <thead>
                  <tr><th /><th className="dr-num">Assigned</th><th className="dr-num">Capacity</th></tr>
                </thead>
                <tbody>
                  {[['Deliveries', 'deliveries'], ['Pick-ups', 'pickups']].map(([label, key]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className="dr-num">
                        <ReportCell value={report[key].assigned} derived disabled={locked}
                          ariaLabel={`${label} assigned`} onChange={(v) => setPath(`${key}.assigned`, v)} />
                      </td>
                      <td className="dr-num">
                        <ReportCell value={report[key].capacity} disabled={locked}
                          ariaLabel={`${label} capacity`} onChange={(v) => setPath(`${key}.capacity`, v)} />
                      </td>
                    </tr>
                  ))}
                  <tr className="dr-total">
                    <td>Total</td>
                    <td className="dr-num">{totals.assigned}</td>
                    <td className="dr-num">{totals.capacity}</td>
                  </tr>
                  <tr>
                    <td>Returns</td>
                    <td className="dr-num">
                      <ReportCell value={report.returns} disabled={locked} ariaLabel="Returns"
                        onChange={(v) => setPath('returns', v)} />
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <td>Sinks</td>
                    <td className="dr-num">
                      <ReportCell value={report.sinks} disabled={locked} ariaLabel="Sinks"
                        onChange={(v) => setPath('sinks', v)} />
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </ReportSection>

            {/* ── Transfers ── */}
            <ReportSection
              title="Transfers"
              icon={ArrowLeftRight}
              source={{ kind: 'auto', label: 'from transfer tickets' }}
              action={!locked && (
                <button className="dr-addrow-btn" onClick={() => patch(r => {
                  r.transfers.push({ fromTo: '', count: 0, slabs: 0, auto: false });
                  return r;
                })}><Plus size={12} /> Add</button>
              )}
            >
              <table className="dr-table">
                <thead>
                  <tr><th>From — To</th><th className="dr-num">Count</th><th className="dr-num">Slabs</th><th className="dr-x" /></tr>
                </thead>
                <tbody>
                  {report.transfers.length === 0 && (
                    <tr><td colSpan={4} className="dr-none">No transfers today.</td></tr>
                  )}
                  {report.transfers.map((t, i) => (
                    <tr key={i}>
                      <td>
                        <ReportCell value={t.fromTo} type="text" align="left" width={150}
                          derived={t.auto} disabled={locked || t.auto} placeholder="SEA — SLC"
                          ariaLabel="Transfer route"
                          onChange={(v) => patch(r => { r.transfers[i].fromTo = v; return r; })} />
                      </td>
                      <td className="dr-num">
                        <ReportCell value={t.count} derived={t.auto} disabled={locked} ariaLabel="Transfer count"
                          onChange={(v) => patch(r => { r.transfers[i].count = v; return r; })} />
                      </td>
                      <td className="dr-num">
                        <ReportCell value={t.slabs} disabled={locked} ariaLabel="Transfer slabs"
                          onChange={(v) => patch(r => { r.transfers[i].slabs = v; return r; })} />
                      </td>
                      <td className="dr-x">
                        {!locked && !t.auto && (
                          <button className="dr-rowdel" aria-label="Remove transfer"
                            onClick={() => patch(r => { r.transfers.splice(i, 1); return r; })}><X size={13} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="dr-total">
                    <td>Total</td>
                    <td className="dr-num">{totals.transferCount}</td>
                    <td className="dr-num">{totals.transferSlabs}</td>
                    <td className="dr-x" />
                  </tr>
                </tbody>
              </table>
            </ReportSection>

            {/* ── Containers ── */}
            <ReportSection
              title="Containers"
              icon={Package}
              source={{ kind: 'typed', label: 'entered here' }}
              footnote="Leave the PO# blank to continue the one above."
              action={!locked && (
                <button className="dr-addrow-btn" onClick={() => patch(r => {
                  r.containers.push({ poNumber: '', material: '', slabs: 0 });
                  return r;
                })}><Plus size={12} /> Add</button>
              )}
            >
              <table className="dr-table">
                <thead>
                  <tr><th style={{ width: '22%' }}>PO#</th><th>Material</th><th className="dr-num">Slabs</th><th className="dr-x" /></tr>
                </thead>
                <tbody>
                  {report.containers.length === 0 && (
                    <tr><td colSpan={4} className="dr-none">No containers today.</td></tr>
                  )}
                  {report.containers.map((c, i) => (
                    <tr key={i}>
                      <td>
                        <ReportCell value={c.poNumber} type="text" align="left" width={100} disabled={locked}
                          placeholder="13540" ariaLabel="PO number"
                          onChange={(v) => patch(r => { r.containers[i].poNumber = v; return r; })} />
                      </td>
                      <td>
                        <ReportCell value={c.material} type="text" align="left" disabled={locked}
                          placeholder="Shadow SJ MQ 3CM" ariaLabel="Material"
                          onChange={(v) => patch(r => { r.containers[i].material = v; return r; })} />
                      </td>
                      <td className="dr-num">
                        <ReportCell value={c.slabs} disabled={locked} ariaLabel="Container slabs"
                          onChange={(v) => patch(r => { r.containers[i].slabs = v; return r; })} />
                      </td>
                      <td className="dr-x">
                        {!locked && (
                          <button className="dr-rowdel" aria-label="Remove container line"
                            onClick={() => patch(r => { r.containers.splice(i, 1); return r; })}><X size={13} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="dr-total">
                    <td>Total</td><td />
                    <td className="dr-num">{totals.containerSlabs}</td>
                    <td className="dr-x" />
                  </tr>
                </tbody>
              </table>
            </ReportSection>

            {/* ── Payments ── */}
            <ReportSection
              title="Payments"
              icon={Wallet}
              source={{ kind: 'typed', label: 'entered here' }}
            >
              <table className="dr-table">
                <thead>
                  <tr><th>Method</th><th className="dr-num">Transactions</th><th className="dr-num">Amount</th></tr>
                </thead>
                <tbody>
                  {[['Cash', 'cash'], ['Credit Card (CC)', 'card'], ['Check', 'check']].map(([label, key]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className="dr-num">
                        <ReportCell value={report.payments[key].count} disabled={locked}
                          ariaLabel={`${label} transactions`}
                          onChange={(v) => setPath(`payments.${key}.count`, v)} />
                      </td>
                      <td className="dr-num">
                        <MoneyCell value={report.payments[key].amount} disabled={locked}
                          ariaLabel={`${label} amount`}
                          onChange={(v) => setPath(`payments.${key}.amount`, v)} />
                      </td>
                    </tr>
                  ))}
                  <tr className="dr-total">
                    <td>Total</td>
                    <td className="dr-num">{totals.payCount}</td>
                    <td className="dr-num">${totals.payAmount.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </ReportSection>

            {/* ── Notes ── */}
            <ReportSection title="Notes" icon={ClipboardList} source={{ kind: 'typed', label: 'optional' }}>
              <textarea
                className="dr-notes no-capitalize"
                value={report.notes}
                disabled={locked}
                placeholder="Anything about the day worth keeping — a late truck, a closed branch, a container held at the port."
                onChange={(e) => setPath('notes', e.target.value)}
              />
            </ReportSection>
          </div>
        </>
      )}

      {/* Reopening a signed-off day states why, on the record. */}
      {reopenOpen && (
        <div className="dr-confirm-backdrop" onClick={() => setReopenOpen(false)}>
          <div className="dr-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="dr-confirm-badge"><Unlock size={20} /></div>
            <h4>Reopen {longDate(date)}?</h4>
            <p>The day goes back to draft and can be edited again. Your name and reason are kept on the report.</p>
            <label className="dr-confirm-label" htmlFor="dr-reopen-reason">Reason <span className="dr-req">*</span></label>
            <input
              id="dr-reopen-reason"
              className="dr-cell is-left no-capitalize"
              style={{ width: '100%' }}
              value={reopenReason}
              autoFocus
              placeholder="e.g. container slabs were counted twice"
              onChange={(e) => setReopenReason(e.target.value)}
            />
            <div className="dr-confirm-actions">
              <button className="dr-btn" onClick={() => setReopenOpen(false)}>Cancel</button>
              <button className="dr-btn dr-btn--gold" disabled={reopenReason.trim().length < 4} onClick={reopenDay}>
                Reopen day
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyReportTab;
