import type { Loose } from '../../types/records';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Filter, MoreHorizontal, Upload, FileSpreadsheet, Loader2, AlertTriangle, Phone, Mail } from 'lucide-react';
import * as XLSX from 'xlsx';
import Pagination from '../../components/shared/Pagination';
import { usePagination } from '../../components/shared/paginationConfig';
import { leadsMeta, listLeads, exportLeads, type Lead, type LeadsMeta, type LeadsPage } from '../../api/projectLeads';
import {
  LEAD_STATUSES, STATUS_LABELS, UPDATED_RANGES, MIN_VALUES, updatedFromFor, formatValue, formatDayShort, leadExportRows,
  contactName, reachable
} from '../../utils/projectLeads';
import LeadDetail from './LeadDetail';
import LeadImportModal from './LeadImportModal';
import './ProjectLeads.css';

const SORTS = [
  { id: 'updated_desc', label: 'Recently updated' },
  { id: 'value_desc', label: 'Value, high to low' },
  { id: 'value_asc', label: 'Value, low to high' },
  { id: 'title_asc', label: 'Name A–Z' }
];

/** Closes an open popover on a click/tap outside `ref` or Escape. */
function useDismiss(ref: React.RefObject<HTMLDivElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
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

/** The two people most worth a call on a project: the first owner or developer, the first architect or designer. */
const keyPeople = (lead: Lead) => {
  const pick = (groups: string[]) => lead.companies.find((c) => groups.includes(c.group) && reachable(c));
  return [pick(['owner']), pick(['architect', 'designer'])].filter((c): c is NonNullable<typeof c> => !!c);
};

/**
 * Sales · Project Leads: construction projects from a ConstructConnect export, with the companies on each
 * (owner, architect, designer, contractor) so sales can call or email them to onboard or send samples.
 * Rules in src/utils/projectLeads.ts; the server checks every permission again.
 */
export default function ProjectLeadsPage({ sidebarToggle = null, currentUser = null, onCreateCustomer = null }: {
  sidebarToggle?: React.ReactNode;
  currentUser?: Loose | null;
  onCreateCustomer?: ((values: Loose) => void) | null;
}) {
  const me: string = currentUser?.name || currentUser?.username || '';
  const [meta, setMeta] = useState<LeadsMeta | null>(null);
  const [data, setData] = useState<LeadsPage | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [city, setCity] = useState('');
  const [stage, setStage] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [minValue, setMinValue] = useState('');
  const [range, setRange] = useState('all');
  const [assigned, setAssigned] = useState('');
  const [onlyReachable, setOnlyReachable] = useState(false);
  const [sort, setSort] = useState('updated_desc');
  const [openId, setOpenId] = useState('');
  const [popover, setPopover] = useState('');
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const seq = useRef(0);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const closePopover = useCallback(() => setPopover(''), []);
  useDismiss(filterRef, popover === 'filter', closePopover);
  useDismiss(moreRef, popover === 'more', closePopover);
  const { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage } = usePagination();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    leadsMeta().then(setMeta).catch((err) => setError(err.message));
  }, [reloadKey]);

  // The state ticks decide which cities are offered.
  const cities = useMemo(() => {
    if (!meta) return [];
    const from = states.length ? states : Object.keys(meta.cities);
    return [...new Set(from.flatMap((s) => meta.cities[s] ?? []))].sort((a, b) => a.localeCompare(b));
  }, [meta, states]);
  const cityNow = city && !cities.includes(city) ? '' : city;

  const filters = useMemo(() => ({
    q: debounced, states: states.join(','), city: cityNow, stage, subcategory, minValue, updatedFrom: updatedFromFor(range),
    assignedTo: assigned === 'me' ? me : assigned === 'none' ? 'none' : '', reachable: onlyReachable ? '1' : '', sort
  }), [debounced, states, cityNow, stage, subcategory, minValue, range, assigned, me, onlyReachable, sort]);
  const query = useMemo(() => ({ ...filters, status }), [filters, status]);

  // Any new view goes back to page 1.
  const filterKey = JSON.stringify(query);
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) { setLastKey(filterKey); resetPage(); }

  useEffect(() => {
    const n = ++seq.current;
    listLeads({ ...query, page: currentPage, limit: rowsPerPage })
      .then((r) => { if (n === seq.current) { setData(r); setError(''); } })
      .catch((err) => { if (n === seq.current) setError(err.message); });
  }, [query, currentPage, rowsPerPage, reloadKey]);

  const items = data?.items ?? [];
  const counts = data?.counts ?? {};
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const open = items.find((l) => l.id === openId) ?? null;
  const filtersSet = !!(states.length || cityNow || stage || subcategory || minValue || range !== 'all' || assigned || onlyReachable || sort !== 'updated_desc');
  const clearFilters = () => { setStates([]); setCity(''); setStage(''); setSubcategory(''); setMinValue(''); setRange('all'); setAssigned(''); setOnlyReachable(false); setSort('updated_desc'); };
  const toggleState = (s: string) => setStates((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const changed = (lead: Lead) => {
    setData((d) => (d ? { ...d, items: d.items.map((l) => (l.id === lead.id ? lead : l)) } : d));
    // Counts per status move with it.
    setReloadKey((k) => k + 1);
  };

  const download = async () => {
    setPopover('');
    setBusy(true);
    setNotice('');
    try {
      const r = await exportLeads(query);
      const ws = XLSX.utils.json_to_sheet(leadExportRows(r.items));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Project Leads');
      XLSX.writeFile(wb, `Project Leads ${new Date().toISOString().slice(0, 10)}.xlsx`);
      if (r.total > r.items.length) setNotice(`Excel holds the first ${r.items.length.toLocaleString()} of ${r.total.toLocaleString()} projects — narrow the filters for the rest.`);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const lastImport = meta?.lastImport;

  return (
    <div className="prj">
      <div className="prj-page">
        <div className="prj-head">
          {sidebarToggle}
          <h1 className="prj-title">Project Leads</h1>
          <span className="prj-grow" />
          <label className="prj-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Project, address, company or contact"
              aria-label="Search project leads" />
            {search ? <button type="button" className="prj-x" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button> : null}
          </label>
          <div className="prj-tools">
            <div className="prj-pop-wrap" ref={filterRef}>
              <button type="button" className={`prj-icon-btn${filtersSet ? ' on' : ''}`} aria-label={filtersSet ? 'Filters (some set)' : 'Filters'} title="Filters"
                aria-haspopup="dialog" aria-expanded={popover === 'filter'} onClick={() => setPopover(popover === 'filter' ? '' : 'filter')}>
                <Filter size={17} aria-hidden="true" />
                {filtersSet ? <span className="prj-dot" aria-hidden="true" /> : null}
              </button>
              {popover === 'filter' && meta ? (
                <div className="prj-pop prj-filters" role="dialog" aria-label="Filters">
                  <div className="prj-field">
                    <span>State{states.length ? ` · ${states.length}` : ''}</span>
                    <div className="prj-states">
                      {meta.states.map((s) => (
                        <label key={s.name} className="prj-check">
                          <input type="checkbox" checked={states.includes(s.name)} onChange={() => toggleState(s.name)} />
                          <span>{s.name}</span><span className="prj-muted">{s.count}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="prj-field"><span>City</span>
                    <select className="prj-select" value={cityNow} onChange={(e) => setCity(e.target.value)}>
                      <option value="">All cities</option>
                      {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="prj-field"><span>Stage</span>
                    <select className="prj-select" value={stage} onChange={(e) => setStage(e.target.value)}>
                      <option value="">Any stage</option>
                      {meta.stages.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="prj-field"><span>Type</span>
                    <select className="prj-select" value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
                      <option value="">Any type</option>
                      {meta.subcategories.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                  </label>
                  <label className="prj-field"><span>Project value</span>
                    <select className="prj-select" value={minValue} onChange={(e) => setMinValue(e.target.value)}>
                      {MIN_VALUES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </label>
                  <label className="prj-field"><span>Updated</span>
                    <select className="prj-select" value={range} onChange={(e) => setRange(e.target.value)}>
                      {UPDATED_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </label>
                  <label className="prj-field"><span>Lead is with</span>
                    <select className="prj-select" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
                      <option value="">Anyone</option>
                      {me ? <option value="me">Me</option> : null}
                      <option value="none">Nobody</option>
                    </select>
                  </label>
                  <label className="prj-check prj-check-row">
                    <input type="checkbox" checked={onlyReachable} onChange={(e) => setOnlyReachable(e.target.checked)} />
                    <span>Only projects with an owner, architect, designer or contractor I can phone or email</span>
                  </label>
                  <label className="prj-field"><span>Sort</span>
                    <select className="prj-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                      {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </label>
                  <div className="prj-pop-foot">
                    <button type="button" className="prj-btn sm" onClick={clearFilters} disabled={!filtersSet}>Clear</button>
                    <button type="button" className="prj-btn sm prj-primary" onClick={closePopover}>Done</button>
                  </div>
                </div>
              ) : null}
            </div>
            {meta && (meta.canImport || meta.canExport) ? (
              <div className="prj-pop-wrap" ref={moreRef}>
                <button type="button" className="prj-icon-btn" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={popover === 'more'}
                  onClick={() => setPopover(popover === 'more' ? '' : 'more')}>
                  {busy ? <Loader2 size={17} className="prj-spin" aria-hidden="true" /> : <MoreHorizontal size={18} aria-hidden="true" />}
                </button>
                {popover === 'more' ? (
                  <div className="prj-pop prj-menu" role="menu" aria-label="More">
                    {meta.canExport ? (
                      <button type="button" role="menuitem" className="prj-menu-item" onClick={download} disabled={busy || !data?.total}>
                        <FileSpreadsheet size={16} aria-hidden="true" />Download as Excel
                      </button>
                    ) : null}
                    {meta.canImport ? (
                      <button type="button" role="menuitem" className="prj-menu-item" onClick={() => { setPopover(''); setImporting(true); }}>
                        <Upload size={16} aria-hidden="true" />Import ConstructConnect file
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {lastImport ? (
          <p className="prj-sub">
            {meta?.total.toLocaleString()} projects · last import {formatDayShort(lastImport.importedAt.slice(0, 10))} ({lastImport.fileName || 'file'})
          </p>
        ) : null}
        {notice ? <div className="prj-notice" role="status">{notice}</div> : null}

        <div className="prj-tabs" role="tablist" aria-label="Leads by status">
          <button type="button" role="tab" className="prj-tab" aria-selected={!status} onClick={() => setStatus('')}>All<span className="prj-cnt">{allCount}</span></button>
          {LEAD_STATUSES.map((s) => (
            <button key={s} type="button" role="tab" className="prj-tab" aria-selected={status === s} onClick={() => setStatus(s)}>
              {STATUS_LABELS[s]}<span className="prj-cnt">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>

        {error ? (
          <div className="prj-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span className="prj-grow">{error}</span>
            <button type="button" className="prj-btn sm" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
          </div>
        ) : null}

        <div className="prj-card">
          {!data && !error ? <div className="prj-loading"><Loader2 size={28} className="prj-spin" aria-label="Loading" /></div> : null}
          {data && !items.length ? (
            <div className="prj-empty">
              <h3>{meta?.total ? 'No projects match' : 'No project leads yet'}</h3>
              {meta?.total ? 'Try another search or loosen a filter.' : meta?.canImport ? 'Use ⋯ → Import ConstructConnect file to add the first projects.' : 'An admin needs to import a ConstructConnect file.'}
            </div>
          ) : null}
          {items.length ? (
            <ul className="prj-list">
              {items.map((l) => {
                const people = keyPeople(l);
                return (
                  <li key={l.id}>
                    <button type="button" className={`prj-row${openId === l.id ? ' open' : ''}`} onClick={() => setOpenId(l.id)}>
                      <span className="prj-row-main">
                        <span className="prj-name">{l.title}</span>
                        <span className="prj-sub">{[l.address, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</span>
                        <span className="prj-sub">{[l.subcategory, l.units ? `${l.units} units` : '', l.stage].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="prj-row-who">
                        {people.length ? people.map((c) => (
                          <span key={`${c.companyId}-${c.role}`} className="prj-who">
                            <span className="prj-who-name">{c.name}</span>
                            <span className="prj-sub">{contactName(c) || '—'} {c.phone ? <Phone size={11} aria-label="phone" /> : null} {c.email ? <Mail size={11} aria-label="email" /> : null}</span>
                          </span>
                        )) : <span className="prj-muted">No phone or email listed</span>}
                      </span>
                      <span className="prj-row-end">
                        <span className="prj-value">{formatValue(l.value)}</span>
                        <span className={`prj-pill ${l.status}`}>{STATUS_LABELS[l.status]}</span>
                        <span className="prj-sub">{l.assignedTo ? `With ${l.assignedTo}` : formatDayShort(l.updatedOn)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        {data && data.total > 0 ? (
          <div className="prj-pager">
            <Pagination currentPage={currentPage} totalPages={Math.max(1, Math.ceil(data.total / rowsPerPage))} onPageChange={setCurrentPage}
              rowsPerPage={rowsPerPage} onRowsPerPageChange={setRowsPerPage} totalCount={data.total} />
          </div>
        ) : null}
      </div>

      {open ? <LeadDetail lead={open} me={me} canEdit={!!meta?.canEdit} onChanged={changed} onClose={() => setOpenId('')} onCreateCustomer={onCreateCustomer} /> : null}
      {importing ? <LeadImportModal onClose={() => setImporting(false)} onDone={() => setReloadKey((k) => k + 1)} /> : null}
    </div>
  );
}
