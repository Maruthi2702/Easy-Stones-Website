import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Users, Truck, ArrowLeftRight, ArrowDownToLine, ArrowUpFromLine, Package, Wallet, ClipboardList,
  ChevronLeft, ChevronRight, ChevronDown, Plus, X, Check, Lock, Unlock,
  MapPin, AlertCircle, Loader2, FileText, Mail, FileSpreadsheet
} from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { branchCode } from '../../../config/branches.js';
import ReportSection from './ReportSection';
import { ReportCell, MoneyCell } from './ReportCell';
import { money } from './summaryFigures';
import { groupContainers, groupSlabs } from '../../../utils/dailyReportContainers';
import MonthView from './MonthView';
import AllBranchesDay from './AllBranchesDay';
import DaySummary from './DaySummary';
import EmailReportDialog from './EmailReportDialog';
import ExportMenu from './ExportMenu';
import './DailyReport.css';

/**
 * Daily Work Report — the spreadsheet the branches filled in every evening.
 *
 * Half of it the system already knows: the visitor count comes from the
 * check-in log and the assigned deliveries and pick-ups from the schedule.
 * Those arrive filled in and marked, and stay editable — if someone walked in
 * without signing the kiosk, the person on shift is right and the system isn't.
 */

/** The branch selector's every-branch option — never a real branch name. */
const ALL = 'all';

// Resend has no verified domain to send transactional mail from yet, so its
// default onboarding@resend.dev sender only delivers to the account's own
// signup address — every other recipient bounces. Sending falls through to
// the Gmail SMTP account instead (see emailService.js) until a domain is set
// up as RESEND_FROM_EMAIL.
const EMAIL_EXPORT_ENABLED = true;

const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const todayISO = () => isoOf(new Date());

const monthOf = (iso) => iso.slice(0, 7);

const shiftDay = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoOf(d);
};

/**
 * One date carries both views, so moving a month keeps the day number where it
 * can — clamped, because 31 January a month back is the 28th, not the 3rd of
 * March, which is what Date's own rollover would have given.
 */
const shiftMonth = (iso, months) => {
  const [y, m, d] = iso.split('-').map(Number);
  const lastOfTarget = new Date(y, m + months, 0).getDate();
  return isoOf(new Date(y, m - 1 + months, Math.min(d, lastOfTarget)));
};

const withMonth = (iso, ym) => {
  const [y, m] = ym.split('-').map(Number);
  const lastOfTarget = new Date(y, m, 0).getDate();
  return `${ym}-${String(Math.min(Number(iso.slice(8, 10)), lastOfTarget)).padStart(2, '0')}`;
};

const longDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

/** null is "unsaid" — it contributes nothing to a total rather than a zero. */
const n = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const said = (...values) => values.some(v => v !== null && v !== undefined && v !== '');

/** A total is only a dash when nothing underneath it has been said at all. */
const total = (value, ...sources) => (said(...sources) ? value : '—');

/**
 * A transfer's route is stored as one opaque string ('SEA — SLC') — the
 * format the server already produces for auto rows and matches lines
 * against across saves (see lineKey in dailyReports.js) — so splitting it
 * into two dropdowns is purely a frontend input concern; nothing downstream
 * (the model, the PDF/CSV export, ticket matching) needs to know it's really
 * two branch codes. A free-typed legacy value that doesn't split cleanly
 * (a stray hyphen, no separator at all) just starts both dropdowns blank
 * until re-picked, rather than guessing at what was meant.
 */
const splitFromTo = (fromTo) => {
  const [from, to] = String(fromTo || '').split('—').map(s => s.trim());
  return [from || '', to || ''];
};

const composeFromTo = (from, to) => (from || to) ? `${from} — ${to}` : '';

const emptyReport = (date, location) => ({
  date,
  location,
  status: 'draft',
  visitors: { homeowners: 0, fabricators: null, designers: null },
  deliveries: { assigned: 0, capacity: null },
  pickups: { assigned: 0, capacity: null },
  returns: null,
  sinks: null,
  transfers: [],
  containers: [],
  payments: { cash: { count: null, amount: null }, card: { count: null, amount: null }, check: { count: null, amount: null } },
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
  // Every branch the company has, for the Transfer row's From/To pickers —
  // deliberately not scoped to `locations` above. Which branch's own report
  // this person may open is an access question; which branch a transfer can
  // go to isn't, so a Seattle-only user still needs Atlanta on this list.
  const [allLocations, setAllLocations] = useState([]);
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
  const [emailOpen, setEmailOpen] = useState(false);
  // What a slab count usually looks like for this branch — the server works it
  // out so the rule isn't reinvented here.
  const [slabRange, setSlabRange] = useState(null);

  const saveTimer = useRef(null);
  const skipAutosave = useRef(true);
  // Which of the system-derived slab figures this person has actually typed
  // into this session, as opposed to ones just sitting on screen because
  // deriveFromSystem filled them in. Reset on every load. Without this,
  // autosaving an unrelated edit (a visitor count, a payment) would write the
  // whole report — capacity and transfer slabs included — and freeze them at
  // whatever they happened to be at that moment, so a delivery added later in
  // the day would never make it into the total. See buildSavePayload below.
  const touchedCapacity = useRef(new Set());   // 'deliveries' | 'pickups'
  const touchedTransferSlabs = useRef(new Set()); // `${direction}:${fromTo}`

  // ── which branches this person may report on ──────────────────────────────
  useEffect(() => {
    let alive = true;
    authFetch(`${API_URL}/api/daily-reports/locations`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load your branches.')))
      .then(data => {
        if (!alive) return;
        const list = data.locations || [];
        setLocations(list);
        setAllLocations(data.allLocations || []);
        setCanExportAll(Boolean(data.canExportAll));
        setLocation(prev => prev || list[0] || '');
      })
      .catch(err => alive && setError(err.message));
    return () => { alive = false; };
  }, []);

  // ── load the day ──────────────────────────────────────────────────────────
  const loadDay = useCallback(async () => {
    // "All locations" is a reading of the day, not a sheet to fill in — it
    // fetches every branch itself rather than one report to edit.
    if (!location || location === ALL) return;
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
      touchedCapacity.current = new Set();
      touchedTransferSlabs.current = new Set();
      setReport({ ...emptyReport(date, location), ...data.report });
      setSlabRange(data.slabRange || null);
      setDirty(false);
    } catch (err) {
      setError(err.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [date, location]);

  useEffect(() => { if (view === 'day') loadDay(); }, [loadDay, view]);

  const allBranches = location === ALL;

  // Held in a ref so reloading after a lock doesn't change save's identity —
  // the autosave effect depends on it, and a new save on every date change
  // would schedule a write nobody asked for.
  const loadDayRef = useRef(loadDay);
  useEffect(() => { loadDayRef.current = loadDay; }, [loadDay]);

  /**
   * Strips the derived-but-never-typed figures back out of a save payload.
   *
   * `report` state already has capacity and auto transfer slabs filled in by
   * the server's last derive, so they display correctly — but that fill-in
   * isn't a human saying "this is right," and saving it verbatim would tell
   * the server otherwise. Blanking anything the user hasn't actually touched
   * keeps those figures live (re-derived from the schedule/tickets on every
   * load) until someone hand-corrects them, instead of freezing at whatever
   * they were the moment an unrelated field on the same report got edited.
   */
  const buildSavePayload = (r) => {
    const body = structuredClone(r);
    if (!touchedCapacity.current.has('deliveries')) body.deliveries.capacity = null;
    if (!touchedCapacity.current.has('pickups')) body.pickups.capacity = null;
    body.transfers = body.transfers.filter(t => {
      if (!t.auto) return true;
      return touchedTransferSlabs.current.has(`${t.direction || 'out'}:${t.fromTo}`);
    });
    return body;
  };

  // ── autosave the draft ────────────────────────────────────────────────────
  const save = useCallback(async (payload) => {
    if (!canEdit || payload.status === 'submitted') return;
    setSaving(true);
    try {
      const res = await authFetch(`${API_URL}/api/daily-reports/${payload.date}`, {
        method: 'PUT',
        body: JSON.stringify(buildSavePayload(payload))
      });
      // 409 means the day was locked under us — someone else submitted it, or
      // the clock reached 11:59 while this form was still open. Show it as it
      // now is rather than leaving edits going into a sheet that won't take
      // them.
      if (res.status === 409) {
        setError('This day has been submitted. Reopen it to make more changes.');
        setDirty(false);
        loadDayRef.current?.();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).message || 'Could not save.');
      setSavedAt(new Date());
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [canEdit]);

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

  /**
   * Enter on the last line of a repeating section adds another; backspace on an
   * empty line removes it. Deliberately unadvertised — it rewards the person who
   * fills this in every evening without cluttering the card for everyone else.
   */
  /**
   * Records a nil rather than leaving the section unsaid. Without it the only
   * way to state "no money came in" is to type six zeros, so nobody does, and
   * the day stays ambiguous forever.
   */
  const declareNoPayments = () => patch(r => {
    for (const k of ['cash', 'card', 'check']) r.payments[k] = { count: 0, amount: 0 };
    return r;
  });

  const paymentsUnsaid = report && !said(
    report.payments.cash.count, report.payments.cash.amount,
    report.payments.card.count, report.payments.card.amount,
    report.payments.check.count, report.payments.check.amount
  );

  /**
   * A line starts empty, not at zero. Pushing 0 would have every new row assert
   * "no slabs" the moment it appears, which is the same blank-reads-as-answered
   * confusion the dashes exist to remove. Wholly empty lines are dropped on save.
   */
  const addTransfer = () => patch(r => { r.transfers.push({ fromTo: '', count: null, slabs: null, auto: false }); return r; });
  const addContainer = () => patch(r => { r.containers.push({ poNumber: '', material: '', slabs: null }); return r; });

  /**
   * A slab count far outside what this branch usually sees. A question, never a
   * block — a genuine 520-slab container should still save.
   *
   * Checked per physical container, not per line: one PO split across a
   * couple of colors is a few small lines that are each "odd" on their own
   * but ordinary once added back together, so the threshold has to look at
   * the group's total, not any single line inside it.
   */
  const containerGroups = groupContainers(report?.containers || []);
  const oddContainerGroups = containerGroups.filter(g => outOfBandValue(groupSlabs(g)));
  const oddContainerLines = new Set(oddContainerGroups.flatMap(g => g.lines));

  function outOfBandValue(value) {
    if (!slabRange || value === null || value === undefined || value === '') return false;
    const x = Number(value);
    return Number.isFinite(x) && x > 0 && (x < slabRange.low || x > slabRange.high);
  }

  const outOfBand = outOfBandValue;

  const rowKeys = (listName, index, addRow, isEmpty) => (e) => {
    if (locked) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      const cells = [...(e.target.closest('tbody')?.querySelectorAll('.dr-cell:not(:disabled)') || [])];
      const here = cells.indexOf(e.target);
      const onLastRow = here >= cells.length - 1;
      if (onLastRow) addRow();
      else cells[here + 1]?.focus();
      return;
    }

    if (e.key === 'Backspace' && isEmpty && e.target.value === '') {
      e.preventDefault();
      patch(r => { r[listName].splice(index, 1); return r; });
    }
  };

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
      // Outbound only — matches what these figures have always meant, so the
      // day-glance tile's number doesn't quietly start including material
      // coming the other way. Incoming has its own subtotal in the section
      // below instead of being folded into this one.
      transferCount: report.transfers.filter(t => t.direction !== 'in').reduce((s, t) => s + n(t.count), 0),
      transferSlabs: report.transfers.filter(t => t.direction !== 'in').reduce((s, t) => s + n(t.slabs), 0),
      transferCountIn: report.transfers.filter(t => t.direction === 'in').reduce((s, t) => s + n(t.count), 0),
      transferSlabsIn: report.transfers.filter(t => t.direction === 'in').reduce((s, t) => s + n(t.slabs), 0),
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

  // The month PDF follows whichever branch the top bar is on; "all" is only
  // offered to someone assigned to every branch, same as the CSV.
  const pdfUrl = view === 'month'
    ? `${API_URL}/api/daily-reports/export/${monthOf(date)}/pdf?location=${encodeURIComponent(location)}`
    : `${API_URL}/api/daily-reports/${date}/pdf?location=${encodeURIComponent(location)}&tzOffset=${-new Date().getTimezoneOffset()}`;

  const downloadPdf = () => window.open(pdfUrl, '_blank', 'noopener');

  const emailReport = async ({ to, message }) => {
    const url = view === 'month'
      ? `${API_URL}/api/daily-reports/export/${monthOf(date)}/email`
      : `${API_URL}/api/daily-reports/${date}/email`;
    const res = await authFetch(url, {
      method: 'POST',
      body: JSON.stringify({ location, to, message })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not send the report.');
    return data;
  };

  const pdfName = view === 'month'
    ? `daily_report_${monthOf(date)}_${(location === 'all' ? 'All_branches' : location).replace(/\s+/g, '_')}.pdf`
    : `daily_report_${date}_${String(location).replace(/\s+/g, '_')}.pdf`;

  /**
   * Everything you can do with the report on screen, in one menu.
   *
   * A single day's sheet is per branch, so PDF and email are offered on the
   * month whatever the scope, and on a day only once a branch is chosen —
   * "All locations" for one day has no one sheet to be.
   */
  const monthLabel = new Date(`${monthOf(date)}-01T00:00:00`)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const scopeLabel = allBranches ? 'your branches' : location;

  const exportItems = [
    ...((view === 'month' || !allBranches) ? [
      {
        key: 'pdf',
        icon: FileText,
        label: 'Download PDF',
        hint: view === 'month' ? `${scopeLabel} · ${monthLabel}` : `${longDate(date)} · ${location}`,
        onSelect: downloadPdf
      },
      // Hidden until we have a domain to send from — see EMAIL_EXPORT_ENABLED.
      ...(EMAIL_EXPORT_ENABLED ? [{
        key: 'email',
        icon: Mail,
        label: 'Email as PDF…',
        hint: 'send it to one or more people',
        onSelect: () => setEmailOpen(true)
      }] : [])
    ] : []),
    {
      key: 'csv',
      icon: FileSpreadsheet,
      label: `Download CSV — ${allBranches ? 'your branches' : 'this branch'}`,
      hint: `${scopeLabel} · ${monthLabel}`,
      onSelect: () => exportCsv(allBranches ? 'all' : 'branch')
    },
    ...((canExportAll && !allBranches) ? [{
      key: 'csv-all',
      icon: FileSpreadsheet,
      label: 'Download CSV — every branch',
      hint: monthLabel,
      onSelect: () => exportCsv('all')
    }] : [])
  ];

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

        {view === 'day' ? (
          <div className="dr-datenav">
            <button onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
            {/* No leading icon: the native picker indicator inside the field is
                already a calendar, and two of them 130px apart is clutter. */}
            <label className="dr-datepick">
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
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
            <label className="dr-datepick">
              {/* Safari has no month picker and renders this as a text box, so
                  the value is checked rather than trusted. */}
              <input
                type="month"
                value={monthOf(date)}
                onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && setDate(withMonth(date, e.target.value))}
              />
            </label>
            <button onClick={() => setDate(shiftMonth(date, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
            {monthOf(date) !== monthOf(todayISO()) && (
              <button className="dr-today" onClick={() => setDate(todayISO())}>This month</button>
            )}
          </div>
        )}

        <label className="dr-locpick">
          <MapPin size={14} />
          <select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Branch">
            {/* Only the branches assigned to this person, and "all" means all
                of those — never every branch the company has. */}
            {locations.length > 1 && <option value={ALL}>All locations</option>}
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <ChevronDown size={13} className="dr-locpick-caret" />
        </label>

        <div className="dr-actions">
          <ExportMenu items={exportItems} />
          {view === 'day' && !allBranches && !submitted && canSubmit && (
            <button className="dr-btn dr-btn--gold" onClick={submitDay} disabled={loading || !report}>
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
          onOpenDay={(d, loc) => {
            setDate(d);
            if (loc) setLocation(loc);
            setView('day');
          }}
        />
      ) : allBranches ? (
        <AllBranchesDay
          date={date}
          authFetch={authFetch}
          onOpenBranch={(loc) => setLocation(loc)}
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
                {/* An automatic submission means the figures stand as they were
                    left at 11:59, not that anybody checked them — say which. */}
                <Lock size={11} /> {report.autoSubmitted
                  ? 'Submitted automatically'
                  : `Submitted${report.submittedBy ? ` by ${report.submittedBy}` : ''}`}
              </span>
            ) : (
              <span className="dr-badge">
                {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? `Draft · saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Draft'}
              </span>
            )}
            {!canEdit && <span className="dr-badge">Read only</span>}
          </div>

          <div className="dr-sheet">
          {/* The day summarised, above the form that produces it. */}
          <DaySummary
            report={report}
            totals={totals}
            canSubmit={canSubmit && !submitted}
            onSubmit={submitDay}
            submitting={saving}
          />

          <div className="dr-grid">

            {/* Three to a row, in the order asked for:
                Visitors · Payments · Containers
                Delivery · Transfers · Notes */}

                        {/* Two columns, so the pairs are deliberate:
                Visitors  · Delivery
                Transfers · Containers   — slabs out beside slabs in,
                Payments  · Notes          the same pairing as the tiles above. */}

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
                  <tr className="dr-total"><td>Total</td><td className="dr-num">{total(totals.visitors, report.visitors.fabricators, report.visitors.designers) === '—' && !totals.visitors ? '—' : totals.visitors}</td></tr>
                </tbody>
              </table>
            </ReportSection>

            {/* ── Delivery & Pick-Up ── */}
            <ReportSection
              title="Delivery & Pick-Up Summary"
              icon={Truck}
              source={{ kind: 'auto', label: 'counted from the schedule' }}
              footnote="The count comes from the schedule. Slabs is how many went out on them."
            >
              <table className="dr-table">
                <thead>
                  <tr><th /><th className="dr-num">Count</th><th className="dr-num">Slabs</th></tr>
                </thead>
                <tbody>
                  {[['Deliveries', 'deliveries'], ['Pick-ups', 'pickups']].map(([label, key]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className="dr-num">
                        <ReportCell value={report[key].assigned} derived disabled={locked}
                          ariaLabel={`${label} count`} onChange={(v) => setPath(`${key}.assigned`, v)} />
                      </td>
                      <td className="dr-num">
                        <ReportCell value={report[key].capacity} derived disabled={locked}
                          ariaLabel={`${label} slabs`}
                          onChange={(v) => { touchedCapacity.current.add(key); setPath(`${key}.capacity`, v); }} />
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
                <button className="dr-addrow-btn" onClick={addTransfer}><Plus size={12} /> Add</button>
              )}
            >
              <table className="dr-table">
                <thead>
                  <tr><th className="dr-route-th">From — To</th><th className="dr-num">Count</th><th className="dr-num">Slabs</th><th className="dr-x" /></tr>
                </thead>
                <tbody>
                  {report.transfers.length === 0 && (
                    <tr><td colSpan={4} className="dr-none">No transfers today.</td></tr>
                  )}
                  {report.transfers.map((t, i) => {
                    const [fromCode, toCode] = splitFromTo(t.fromTo);
                    return (
                    <tr key={i}>
                      <td className="dr-route-cell">
                        <span className="dr-direction" title={t.direction === 'in' ? 'Incoming' : 'Outgoing'}>
                          {t.direction === 'in' ? <ArrowDownToLine size={12} /> : <ArrowUpFromLine size={12} />}
                        </span>
                        <select className={`dr-cell dr-select ${t.auto ? 'is-derived' : ''}`}
                          value={fromCode} disabled={locked || t.auto} aria-label="Transfer from"
                          onChange={(e) => patch(r => { r.transfers[i].fromTo = composeFromTo(e.target.value, toCode); return r; })}>
                          <option value="">From</option>
                          {allLocations.map(l => <option key={l} value={branchCode(l)}>{l}</option>)}
                        </select>
                        <span className="dr-route-sep" aria-hidden="true">—</span>
                        <select className={`dr-cell dr-select ${t.auto ? 'is-derived' : ''}`}
                          value={toCode} disabled={locked || t.auto} aria-label="Transfer to"
                          onChange={(e) => patch(r => { r.transfers[i].fromTo = composeFromTo(fromCode, e.target.value); return r; })}>
                          <option value="">To</option>
                          {allLocations.map(l => <option key={l} value={branchCode(l)}>{l}</option>)}
                        </select>
                      </td>
                      <td className="dr-num">
                        <ReportCell value={t.count} derived={t.auto} disabled={locked} ariaLabel="Transfer count"
                          onChange={(v) => patch(r => { r.transfers[i].count = v; return r; })} />
                      </td>
                      <td className="dr-num">
                        <ReportCell value={t.slabs} disabled={locked} ariaLabel="Transfer slabs"
                          className={outOfBand(t.slabs) ? 'is-odd' : ''}
                          onKeyDown={rowKeys('transfers', i, addTransfer, !t.fromTo && !n(t.count) && !n(t.slabs))}
                          onChange={(v) => patch(r => {
                            touchedTransferSlabs.current.add(`${t.direction || 'out'}:${t.fromTo}`);
                            r.transfers[i].slabs = v;
                            return r;
                          })} />
                      </td>
                      <td className="dr-x">
                        {!locked && (
                          <button className="dr-rowdel" aria-label="Remove transfer"
                            onClick={() => patch(r => { r.transfers.splice(i, 1); return r; })}><X size={13} /></button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                  <tr className="dr-total">
                    <td>Outgoing</td>
                    <td className="dr-num">{totals.transferCount}</td>
                    <td className="dr-num">{totals.transferSlabs}</td>
                    <td className="dr-x" />
                  </tr>
                  <tr className="dr-total">
                    <td>Incoming</td>
                    <td className="dr-num">{totals.transferCountIn}</td>
                    <td className="dr-num">{totals.transferSlabsIn}</td>
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
              footnote={oddContainerGroups.length
                ? `${oddContainerGroups.map(groupSlabs).join(' and ')} ${oddContainerGroups.length === 1 ? 'is' : 'are'} well outside the usual ${slabRange.low}–${slabRange.high} slabs${slabRange.fromHistory ? ' for this branch' : ' for a container'}. Keep it if that's right.`
                : 'Leave the PO# blank to continue the one above.'}
              footnoteTone={oddContainerGroups.length ? 'warn' : undefined}
              action={!locked && (
                <button className="dr-addrow-btn" onClick={addContainer}><Plus size={12} /> Add</button>
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
                          placeholder="PO number" ariaLabel="PO number"
                          onChange={(v) => patch(r => { r.containers[i].poNumber = v; return r; })} />
                      </td>
                      <td>
                        <ReportCell value={c.material} type="text" align="left" disabled={locked}
                          placeholder="Material name" ariaLabel="Material"
                          onChange={(v) => patch(r => { r.containers[i].material = v; return r; })} />
                      </td>
                      <td className="dr-num">
                        <ReportCell value={c.slabs} disabled={locked} ariaLabel="Container slabs"
                          className={oddContainerLines.has(c) ? 'is-odd' : ''}
                          onKeyDown={rowKeys('containers', i, addContainer, !c.poNumber && !c.material && !n(c.slabs))}
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
              source={{ kind: 'typed', label: paymentsUnsaid ? 'nothing recorded yet' : 'entered here' }}
              action={!locked && paymentsUnsaid && (
                <button className="dr-addrow-btn" onClick={declareNoPayments} title="Record that no money was taken today">
                  Nothing taken today
                </button>
              )}
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
                    <td className="dr-num">{paymentsUnsaid ? '—' : totals.payCount}</td>
                    <td className="dr-num">{paymentsUnsaid ? '—' : money(totals.payAmount)}</td>
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
          </div>
        </>
      )}

      <EmailReportDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        onSend={emailReport}
        title={view === 'month' ? `Email the ${monthOf(date)} summary` : `Email ${longDate(date)}`}
        subtitle={view === 'month'
          ? `The month for ${location}.`
          : `${location}${report?.status === 'draft' ? ' — this day is still a draft and will be marked as one.' : '.'}`}
        filename={pdfName}
      />

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
