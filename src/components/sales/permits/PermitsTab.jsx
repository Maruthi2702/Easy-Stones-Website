import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, AlertTriangle, Loader2, RefreshCw, ChevronDown, CheckCircle2, Filter, MoreHorizontal, Eye, FileText, FileSpreadsheet, ListChecks } from 'lucide-react';
import * as XLSX from 'xlsx';
import Pagination from '../../shared/Pagination';
import { usePagination } from '../../shared/paginationConfig';
import { API_URL } from '../../../config/api';
import { permitsMeta, listPermits, exportPermits, refreshPermits } from '../../../api/permits';
import { SOURCES, CATEGORIES, categoryLabel, pacificNow } from '../../../permits/permitRules';
import {
  DATE_RANGES, DEFAULT_RANGE, rangeFrom, formatDay, formatMoney, sizeLine, sourceStatus, splitChecks, checksAttention,
  permitExportRows, SORT_OPTIONS, DEFAULT_SORT, placeGroups, placeQuery,
  permitPdfUrl, permitFileName
} from '../../../utils/permitView';
import { SortHeader, LeadCell, PermitDetail } from './PermitParts';
import ChecksDialog from './ChecksDialog';
import './Permits.css';

const STATUS_ICON = { ok: CheckCircle2, warn: AlertTriangle, none: AlertTriangle, busy: Loader2 };

/** Closes an open popover on a click/tap outside `ref` or Escape (focus goes back to its button). */
function useDismiss(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { close(); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}

/**
 * Sales · Permits: building permits issued in Whatcom County (the county and
 * the City of Bellingham), pulled each morning, newest first. Rules in
 * src/permits/permitRules.js and src/utils/permitView.js; the server checks
 * every permission again.
 */
export default function PermitsTab({ sidebarToggle = null }) {
  const [meta, setMeta] = useState(null);
  const [place, setPlace] = useState('');
  const [category, setCategory] = useState('');
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage } = usePagination();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const seq = useRef(0);
  const [popover, setPopover] = useState(''); // 'filter' | 'more' | ''
  const filterRef = useRef(null);
  const moreRef = useRef(null);
  const closePopover = useCallback(() => setPopover(''), []);
  useDismiss(filterRef, popover === 'filter', closePopover);
  useDismiss(moreRef, popover === 'more', closePopover);
  const togglePopover = (name) => setPopover((p) => (p === name ? '' : name));
  const [checksOpen, setChecksOpen] = useState(false);
  const openChecks = () => { setPopover(''); setChecksOpen(true); };
  const closeChecks = useCallback(() => {
    setChecksOpen(false);
    moreRef.current?.querySelector('button')?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => ({
    ...placeQuery(place), category, q: debounced, from: rangeFrom(range), to: pacificNow().day, sort
  }), [place, category, debounced, range, sort]);

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
    setPopover('');
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
    setPopover('');
    setBusy('export');
    setNotice('');
    try {
      const r = await exportPermits(query);
      const ws = XLSX.utils.json_to_sheet(permitExportRows(r.items));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Permits');
      XLSX.writeFile(wb, permitFileName(query));
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
  const attention = checksAttention(meta?.sources, meta?.checks, now);
  const needsLook = attention.some((a) => a.tone !== 'busy');
  const filtered = Boolean(debounced || place);
  const filtersSet = Boolean(place || range !== DEFAULT_RANGE || sort !== DEFAULT_SORT);
  const clearFilters = () => { setPlace(''); setRange(DEFAULT_RANGE); setSort(DEFAULT_SORT); };

  return (
    <div className="pm">
      <div className="pm-page">
        <div className="pm-head">
          {sidebarToggle}
          <h1 className="pm-title">Permits</h1>
          <span className="pm-grow" />
          <label className="pm-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Address, permit #, contractor" aria-label="Search permits" />
            {search ? <button type="button" className="pm-x" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button> : null}
          </label>
          <div className="pm-tools">
            <div className="pm-pop-wrap" ref={filterRef}>
              <button type="button" className={`pm-icon-btn${filtersSet ? ' on' : ''}`} aria-label={filtersSet ? 'Filters (some set)' : 'Filters'} title="Filters"
                aria-haspopup="dialog" aria-expanded={popover === 'filter'} onClick={() => togglePopover('filter')}>
                <Filter size={17} aria-hidden="true" />
                {filtersSet ? <span className="pm-dot" aria-hidden="true" /> : null}
              </button>
              {popover === 'filter' ? (
                <div className="pm-pop pm-filters" role="dialog" aria-label="Filters">
                  <label className="pm-field">
                    <span>Issued</span>
                    <select className="pm-select" value={range} onChange={(e) => setRange(e.target.value)}>
                      {DATE_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </label>
                  <label className="pm-field">
                    <span>City</span>
                    <select className="pm-select" value={place} onChange={(e) => setPlace(e.target.value)}>
                      <option value="">All cities</option>
                      {placeGroups(meta?.cities).map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label className="pm-field pm-sort-field">
                    <span>Sort</span>
                    <select className="pm-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                      {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </label>
                  <div className="pm-pop-foot">
                    <button type="button" className="pm-btn sm" onClick={clearFilters} disabled={!filtersSet}>Clear</button>
                    <button type="button" className="pm-btn sm pm-primary" onClick={closePopover}>Done</button>
                  </div>
                </div>
              ) : null}
            </div>
            {meta ? (
              <div className="pm-pop-wrap" ref={moreRef}>
                <button type="button" className="pm-icon-btn" aria-label={needsLook ? 'More (a check needs a look)' : 'More'} title="More"
                  aria-haspopup="menu" aria-expanded={popover === 'more'} onClick={() => togglePopover('more')}>
                  {busy ? <Loader2 size={17} className="pm-spin" aria-hidden="true" /> : <MoreHorizontal size={18} aria-hidden="true" />}
                  {needsLook ? <span className="pm-dot warn" aria-hidden="true" /> : null}
                </button>
                {popover === 'more' ? (
                  <div className="pm-pop pm-menu" role="menu" aria-label="More">
                    {meta?.canExport ? (<>
                      <a role="menuitem" className="pm-menu-item" href={permitPdfUrl(API_URL, query)} target="_blank" rel="noopener noreferrer" onClick={closePopover}>
                        <Eye size={16} aria-hidden="true" />View as PDF
                      </a>
                      <a role="menuitem" className="pm-menu-item" href={permitPdfUrl(API_URL, query, { download: true })} onClick={closePopover}>
                        <FileText size={16} aria-hidden="true" />Download as PDF
                      </a>
                      <button type="button" role="menuitem" className="pm-menu-item" onClick={download} disabled={busy === 'export' || !data?.total}>
                        <FileSpreadsheet size={16} aria-hidden="true" />{busy === 'export' ? 'Preparing Excel…' : 'Download as Excel'}
                      </button>
                    </>) : null}
                    {meta?.canExport && meta?.canRefresh ? <div className="pm-menu-sep" role="separator" /> : null}
                    {meta?.canRefresh ? (
                      <button type="button" role="menuitem" className="pm-menu-item" onClick={runNow} disabled={busy === 'refresh' || meta?.running}>
                        <RefreshCw size={16} className={meta?.running ? 'pm-spin' : ''} aria-hidden="true" />{meta?.running ? 'Pulling…' : 'Refresh now'}
                      </button>
                    ) : null}
                    {meta?.canExport || meta?.canRefresh ? <div className="pm-menu-sep" role="separator" /> : null}
                    <button type="button" role="menuitem" className="pm-menu-item" onClick={openChecks}>
                      <ListChecks size={16} aria-hidden="true" />Detailed Checks
                      {needsLook ? <span className="pm-menu-flag">Needs a look</span> : null}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Everything fine → nothing here; the full picture is under More → Detailed Checks. */}
        {attention.length ? (
          <div className="pm-status">
            {attention.map((a, i) => {
              const Icon = STATUS_ICON[a.tone] || AlertTriangle;
              return (
                <div key={a.id} className={`pm-status-line ${a.tone}`}>
                  <Icon size={15} className={a.tone === 'busy' ? 'pm-spin' : ''} aria-hidden="true" />
                  <span>{a.text}</span>
                  {i === attention.length - 1 ? <button type="button" className="pm-link" onClick={openChecks}>Detailed Checks</button> : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {checksOpen ? <ChecksDialog statuses={statuses} topChecks={topChecks} olderChecks={olderChecks} onClose={closeChecks} /> : null}

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
