import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, AlertTriangle, Loader2, Download, RefreshCw, ChevronDown, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import Pagination from '../../shared/Pagination';
import { usePagination } from '../../shared/paginationConfig';
import { permitsMeta, listPermits, exportPermits, refreshPermits } from '../../../api/permits';
import { SOURCES, CATEGORIES, categoryLabel, pacificNow } from '../../../permits/permitRules';
import {
  DATE_RANGES, DEFAULT_RANGE, rangeFrom, formatDay, formatMoney, sizeLine, sourceStatus, checkStatus, splitChecks,
  permitExportRows, SORT_OPTIONS, DEFAULT_SORT
} from '../../../utils/permitView';
import { SortHeader, LeadCell, PermitDetail } from './PermitParts';
import './Permits.css';

const STATUS_ICON = { ok: CheckCircle2, warn: AlertTriangle, none: AlertTriangle, busy: Loader2 };

/**
 * Sales · Permits: building permits issued in Whatcom County (the county and
 * the City of Bellingham), pulled each morning, newest first. Rules in
 * src/permits/permitRules.js and src/utils/permitView.js; the server checks
 * every permission again.
 */
export default function PermitsTab({ sidebarToggle = null }) {
  const [meta, setMeta] = useState(null);
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage } = usePagination();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [showChecks, setShowChecks] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => ({
    source, category, city, q: debounced, from: rangeFrom(range), to: pacificNow().day, sort
  }), [source, category, city, debounced, range, sort]);

  // A new view goes back to page 1.
  const filterKey = JSON.stringify(query);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    resetPage();
  }

  useEffect(() => {
    permitsMeta().then(setMeta).catch((err) => setError(err.message));
  }, [reloadKey]);

  // While a pull runs — or before the first one has started (the server
  // begins it a minute after it boots) — look again every 20 seconds.
  useEffect(() => {
    const waiting = meta?.running || (meta?.sources || []).some((s) => !s.lastRun || !s.lastRun.finishedAt);
    if (!waiting) return undefined;
    const t = setTimeout(() => setReloadKey((k) => k + 1), 20000);
    return () => clearTimeout(t);
  }, [meta]);

  useEffect(() => {
    const n = ++seq.current;
    listPermits({ ...query, page: currentPage, limit: rowsPerPage })
      .then((r) => { if (n === seq.current) { setData(r); setError(''); } })
      .catch((err) => { if (n === seq.current) setError(err.message); });
  }, [query, currentPage, rowsPerPage, reloadKey]);

  const runNow = async () => {
    setBusy('refresh');
    setNotice('');
    try {
      const r = await refreshPermits();
      setNotice(r.started ? 'Pulling now — this page updates when it’s done (a few minutes).' : 'A pull is already running — this page updates when it’s done.');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy('');
    }
  };

  const download = async () => {
    setBusy('export');
    setNotice('');
    try {
      const r = await exportPermits(query);
      const ws = XLSX.utils.json_to_sheet(permitExportRows(r.items));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Permits');
      XLSX.writeFile(wb, `permits-${source || 'whatcom-bellingham'}-${query.from}-to-${query.to}.xlsx`);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy('');
    }
  };

  const items = data?.items || [];
  const counts = data?.counts || {};
  const now = new Date();
  const statuses = (meta?.sources || []).map((s) => ({ ...sourceStatus(s, now), id: s.id, unsorted: s.lastRun?.unsortedTypes || [] }));
  const { top: topChecks, rest: olderChecks } = splitChecks(meta?.checks || [], now);
  const filtered = Boolean(debounced || city || source);

  return (
    <div className="pm">
      <div className="pm-page">
        <div className="pm-head">
          {sidebarToggle}
          <h1 className="pm-title">Permits</h1>
          <span className="pm-grow" />
          <div className="pm-seg" role="group" aria-label="Who issued the permit">
            <button type="button" className={!source ? 'on' : ''} aria-pressed={!source} onClick={() => setSource('')}>All</button>
            {Object.values(SOURCES).map((s) => (
              <button key={s.id} type="button" className={source === s.id ? 'on' : ''} aria-pressed={source === s.id} onClick={() => setSource(s.id)}>{s.label}</button>
            ))}
          </div>
          <label className="pm-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Address, permit #, contractor" aria-label="Search permits" />
            {search ? <button type="button" className="pm-x" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button> : null}
          </label>
          <select className="pm-select" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Issued">
            {DATE_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <select className="pm-select pm-sort-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select className="pm-select" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
            <option value="">All cities</option>
            {(meta?.cities || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {meta?.canExport ? (
            <button type="button" className="pm-btn" onClick={download} disabled={busy === 'export' || !data?.total}>
              {busy === 'export' ? <Loader2 size={16} className="pm-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
              <span className="pm-btn-label">Export</span>
            </button>
          ) : null}
          {meta?.canRefresh ? (
            <button type="button" className="pm-btn" onClick={runNow} disabled={busy === 'refresh' || meta?.running} title="Run the morning pull now">
              <RefreshCw size={16} className={meta?.running ? 'pm-spin' : ''} aria-hidden="true" />
              <span className="pm-btn-label">{meta?.running ? 'Pulling…' : 'Refresh now'}</span>
            </button>
          ) : null}
        </div>

        {meta ? (
          <div className="pm-status">
            {statuses.map((s) => {
              const Icon = STATUS_ICON[s.tone] || AlertTriangle;
              return (
                <div key={s.id} className={`pm-status-line ${s.tone}`}>
                  <Icon size={15} className={s.tone === 'busy' ? 'pm-spin' : ''} aria-hidden="true" />
                  <span>{s.text}{s.through || ''}</span>
                  {s.unsorted.length ? (
                    <span className="pm-unsorted">New building types not sorted yet: {s.unsorted.map((u) => `${u.type} (${u.count})`).join(', ')}.</span>
                  ) : null}
                </div>
              );
            })}
            {topChecks.map((c, i) => {
              const s = checkStatus(c);
              return (
                <div key={`${c.source}-${c.month}-${c.method}`} className={`pm-status-line ${s.tone}`}>
                  {s.tone === 'ok' ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
                  <span>{s.text}</span>
                  {i === topChecks.length - 1 ? (
                    <button type="button" className="pm-link" onClick={() => setShowChecks((v) => !v)} aria-expanded={showChecks}>{showChecks ? 'Hide' : 'Details'}</button>
                  ) : null}
                </div>
              );
            })}
            {showChecks ? (
              <ul className="pm-checks">
                {[...topChecks.filter((c) => !c.ok), ...olderChecks].map((c) => {
                  const s = checkStatus(c);
                  const search = c.method === 'search';
                  return (
                    <li key={`${c.source}-${c.month}-${c.method}`} className={s.tone}>
                      <b>{s.text}</b>
                      {c.missingFromApp?.length ? <span>{search ? 'Found by the separate search but not here' : 'In the county’s report but not here'}: {c.missingFromApp.join(', ')}</span> : null}
                      {c.notFoundAgain?.length ? <span>Here but not found by the separate search: {c.notFoundAgain.join(', ')}</span> : null}
                      {c.notInReport?.length ? <span>Here but not in the county’s report: {c.notInReport.join(', ')}</span> : null}
                      {c.notInCountySearch?.length ? <span>In the report but missing from the county’s own search: {c.notInCountySearch.join(', ')}</span> : null}
                      {c.datesMoved?.length ? <span className="pm-muted">Re-issued by the county after the report (shown here under the new date): {c.datesMoved.join(', ')}</span> : null}
                      {c.notPublic?.length ? <span className="pm-muted">Not lead types, and hidden from the county’s public search: {c.notPublic.join(', ')}</span> : null}
                      {c.reportUrl ? <a href={c.reportUrl} target="_blank" rel="noreferrer">{c.reportTitle || 'The county’s report'}</a> : null}
                    </li>
                  );
                })}
                <li className="pm-muted">The month so far is checked each morning by finding every lead permit a second, separate way. Once a month is over, the county’s own monthly report replaces that check for Whatcom County. Bellingham doesn’t publish one; besides the separate query, every pull must read as many permits as the city says it has, or it fails.</li>
              </ul>
            ) : null}
          </div>
        ) : null}

        {notice ? <div className="pm-notice" role="status">{notice}</div> : null}

        <div className="pm-tabs" role="tablist" aria-label="Permits by kind of work">
          <button type="button" role="tab" className="pm-tab" aria-selected={!category} onClick={() => setCategory('')}>
            All<span className="pm-cnt">{counts.all ?? 0}</span>
          </button>
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" role="tab" className="pm-tab" aria-selected={category === c.id} onClick={() => setCategory(c.id)}>
              {c.label}<span className="pm-cnt">{counts[c.id] ?? 0}</span>
            </button>
          ))}
        </div>

        {error ? (
          <div className="pm-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span className="pm-grow">{error}</span>
            <button type="button" className="pm-btn sm" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
          </div>
        ) : null}

        <div className={`pm-card${items.length ? ' has-cards' : ''}`}>
          {!data && !error ? <div className="pm-loading"><Loader2 size={28} className="pm-spin" aria-label="Loading" /></div> : null}
          {data && !items.length ? (
            <div className="pm-empty">
              <h3>{filtered || category ? 'No permits match' : 'No permits yet'}</h3>
              {filtered || category ? 'Try another search, city or date range.' : 'The first pull reads six months back — check again in a few minutes.'}
            </div>
          ) : null}
          {items.length ? (
            <>
              <div className="pm-table-wrap">
                <table className="pm-table">
                  <thead>
                    <tr>
                      <SortHeader column="issued" label="Issued" sort={sort} onSort={setSort} />
                      <th>Permit</th><th>Address</th><th>Work</th>
                      <SortHeader column="value" label="Value" sort={sort} onSort={setSort} className="r" />
                      <th>Contractor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => {
                      const open = openId === p._id;
                      const toggle = () => setOpenId(open ? '' : p._id);
                      return (
                        <React.Fragment key={p._id}>
                          <tr className={`pm-row${open ? ' open' : ''}`} tabIndex={0} aria-expanded={open} onClick={toggle}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
                            <td className="pm-nowrap">{formatDay(p.issuedOn)}</td>
                            <td className="pm-nowrap">
                              <span className="pm-num">{p.permitNumber}</span>
                              <span className={`pm-cat ${p.category}`}>{categoryLabel(p.category)}</span>
                            </td>
                            <td className="pm-addr">
                              <span className="pm-name">{p.address}</span>
                              <span className="pm-sub">{p.city}</span>
                              <span className={`pm-issuer ${p.source}`}>{SOURCES[p.source]?.issuer}</span>
                            </td>
                            <td className="pm-work">
                              <span className="pm-desc-clamp">{p.description || p.type}</span>
                              {p.finalOnly ? <span className="pm-note-chip">Final-only (finishing an older permit)</span> : null}
                              {sizeLine(p) ? <span className="pm-sub">{sizeLine(p)}</span> : null}
                            </td>
                            <td className="r">{formatMoney(p.valuation) || <span className="pm-muted">—</span>}</td>
                            <td className="pm-lead">
                              <LeadCell permit={p} />
                              <ChevronDown size={16} className="pm-chev" aria-hidden="true" />
                            </td>
                          </tr>
                          {open ? <tr className="pm-detail-row"><td colSpan={6}><PermitDetail permit={p} /></td></tr> : null}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pm-cards">
                {items.map((p) => {
                  const open = openId === p._id;
                  return (
                    <div key={p._id} className={`pm-ccard${open ? ' open' : ''}`}>
                      <button type="button" className="pm-ccard-btn" aria-expanded={open} onClick={() => setOpenId(open ? '' : p._id)}>
                        <span className="pm-ccard-top">
                          <span className={`pm-cat ${p.category}`}>{categoryLabel(p.category)}</span>
                          <span className="pm-grow" />
                          <span className="pm-sub">{formatDay(p.issuedOn)}</span>
                        </span>
                        <span className="pm-name">{p.address}</span>
                        <span className="pm-sub">{[p.city, p.permitNumber, formatMoney(p.valuation)].filter(Boolean).join(' · ')}</span>
                        <span className={`pm-issuer ${p.source}`}>{SOURCES[p.source]?.issuer}</span>
                        <span className="pm-desc-clamp">{p.description || p.type}</span>
                      </button>
                      <div className="pm-ccard-lead"><LeadCell permit={p} /></div>
                      {open ? <PermitDetail permit={p} /> : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        {data && data.total > 0 ? (
          <div className="pm-pager">
            <Pagination currentPage={currentPage} totalPages={Math.max(1, Math.ceil(data.total / rowsPerPage))} onPageChange={setCurrentPage}
              rowsPerPage={rowsPerPage} onRowsPerPageChange={setRowsPerPage} totalCount={data.total} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
