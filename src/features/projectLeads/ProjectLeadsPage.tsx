import type { Loose } from '../../types/records';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Filter, MoreHorizontal, Upload, FileSpreadsheet, Loader2, AlertTriangle, Phone, Mail, Undo2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import Pagination from '../../components/shared/Pagination';
import { usePagination } from '../../components/shared/paginationConfig';
import { leadsMeta, listLeads, exportLeads, listCompanies, exportCompanies, getLead, type Lead, type LeadsMeta, type LeadsPage } from '../../api/projectLeads';
import {
  COMPANY_ROLES, COMPANY_ROLE_TABS, COMPANY_SORTS, companyExportRows, type CompaniesPage, type CompanyItem, type CompanyDetail as CompanyDetailData
} from '../../utils/projectLeadCompanies';
import {
  LEAD_STATUSES, STATUS_LABELS, UPDATED_RANGES, MIN_VALUES, updatedFromFor, formatValue, formatDayShort, leadExportRows,
  contactName, reachable
} from '../../utils/projectLeads';
import useIsPhone from '../../components/shared/form/useIsPhone';
import FilterSheet from './FilterSheet';
import StatePicker from './StatePicker';
import LeadDetail from './LeadDetail';
import CompanyRows from './CompanyRows';
import CompanyDetail from './CompanyDetail';
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
 * Sales · Multifamily Leads: construction projects from a ConstructConnect export, with the companies on each
 * (owner, architect, designer, contractor) so sales can call or email them to onboard or send samples.
 * Rules in src/utils/projectLeads.ts; the server checks every permission again.
 */
export default function ProjectLeadsPage({ sidebarToggle = null, currentUser = null, onCreateCustomer = null }: {
  sidebarToggle?: React.ReactNode;
  currentUser?: Loose | null;
  onCreateCustomer?: ((values: Loose) => void) | null;
}) {
  const me: string = currentUser?.name || currentUser?.username || '';
  const isPhone = useIsPhone();
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
  // Companies (one row per company across its projects) is the first view; Projects is the list by project.
  const [view, setView] = useState<'companies' | 'projects'>('companies');
  const [role, setRole] = useState('');
  const [cdata, setCdata] = useState<CompaniesPage | null>(null);
  const [openKey, setOpenKey] = useState('');
  const [fromCompany, setFromCompany] = useState<Lead | null>(null);
  const [openId, setOpenId] = useState('');
  const [popover, setPopover] = useState('');
  const [importing, setImporting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const seq = useRef(0);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const closePopover = useCallback(() => setPopover(''), []);
  // On a phone Filters is a bottom sheet (FilterSheet) that closes itself.
  useDismiss(filterRef, popover === 'filter' && !isPhone, closePopover);
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
  const query = useMemo(() => ({ ...filters, status, ...(view === 'companies' && role ? { role } : {}) }), [filters, status, view, role]);

  // Any new view goes back to page 1.
  const filterKey = JSON.stringify({ view, ...query });
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) { setLastKey(filterKey); resetPage(); }

  useEffect(() => {
    const n = ++seq.current;
    if (view === 'companies') {
      listCompanies({ ...query, page: currentPage, limit: rowsPerPage })
        .then((r) => { if (n === seq.current) { setCdata(r); setError(''); } })
        .catch((err) => { if (n === seq.current) setError(err.message); });
    } else {
      listLeads({ ...query, page: currentPage, limit: rowsPerPage })
        .then((r) => { if (n === seq.current) { setData(r); setError(''); } })
        .catch((err) => { if (n === seq.current) setError(err.message); });
    }
  }, [view, query, currentPage, rowsPerPage, reloadKey]);

  const companies = view === 'companies';
  const shown = companies ? cdata : data;
  const items = data?.items ?? [];
  const companyItems = cdata?.items ?? [];
  const counts = (companies ? cdata?.counts : data?.counts) ?? {};
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const openCompany = companyItems.find((c) => c.key === openKey) ?? null;
  const switchView = (next: 'companies' | 'projects') => {
    if (next === view) return;
    setView(next);
    setOpenKey('');
    setOpenId('');
    setError('');
    if (!(next === 'companies' ? COMPANY_SORTS : SORTS).some((o) => o.id === sort)) setSort('updated_desc');
  };
  const open = items.find((l) => l.id === openId) ?? null;
  const filtersSet = !!(states.length || cityNow || stage || subcategory || minValue || range !== 'all' || assigned || onlyReachable || sort !== 'updated_desc');
  const clearFilters = () => { setStates([]); setCity(''); setStage(''); setSubcategory(''); setMinValue(''); setRange('all'); setAssigned(''); setOnlyReachable(false); setSort('updated_desc'); };

  const companyChanged = (c: CompanyDetailData) => {
    setCdata((d) => (d ? { ...d, items: d.items.map((x) => (x.key === c.key ? { ...x, ...c } as CompanyItem : x)) } : d));
    setReloadKey((k) => k + 1);
  };
  const openProject = async (id: string) => {
    try { setFromCompany(await getLead(id)); } catch (err) { setNotice((err as Error).message); }
  };

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
      const r = companies ? await exportCompanies(query) : await exportLeads(query);
      const rows = companies ? companyExportRows((r as CompaniesPage).items) : leadExportRows((r as LeadsPage).items);
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Multifamily Leads');
      XLSX.writeFile(wb, `Multifamily ${companies ? 'Companies' : 'Leads'} ${new Date().toISOString().slice(0, 10)}.xlsx`);
      if (r.total > r.items.length) setNotice(`Excel holds the first ${r.items.length.toLocaleString()} of ${r.total.toLocaleString()} ${companies ? 'companies' : 'projects'} — narrow the filters for the rest.`);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const lastImport = meta?.lastImport;

  // The same fields in the desktop panel and the phone sheet.
  const filterFields = meta ? (
    <>
                  <StatePicker states={meta.states} value={states} onChange={setStates} />
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
                    <span>{companies ? 'Only companies I can phone or email' : 'Only projects with an owner, architect, designer or contractor I can phone or email'}</span>
                  </label>
                  <label className="prj-field"><span>Sort</span>
                    <select className="prj-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                      {(companies ? COMPANY_SORTS : SORTS).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </label>
    </>
  ) : null;

  return (
    <div className="prj">
      <div className="prj-page">
        <div className="prj-head">
          {sidebarToggle}
          <h1 className="prj-title">Multifamily Leads</h1>
          <span className="prj-grow" />
          <label className="prj-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={companies ? 'Company, contact, phone, email or project' : 'Project, address, company or contact'}
              aria-label="Search multifamily leads" />
            {search ? <button type="button" className="prj-x" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button> : null}
          </label>
          <div className="prj-tools">
            <div className="prj-pop-wrap" ref={filterRef}>
              <button type="button" className={`prj-icon-btn${filtersSet ? ' on' : ''}`} aria-label={filtersSet ? 'Filters (some set)' : 'Filters'} title="Filters"
                aria-haspopup="dialog" aria-expanded={popover === 'filter'} onClick={() => setPopover(popover === 'filter' ? '' : 'filter')}>
                <Filter size={17} aria-hidden="true" />
                {filtersSet ? <span className="prj-dot" aria-hidden="true" /> : null}
              </button>
              {popover === 'filter' && meta && !isPhone ? (
                <div className="prj-pop prj-filters" role="dialog" aria-label="Filters">
                  {filterFields}
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
                      <button type="button" role="menuitem" className="prj-menu-item" onClick={download} disabled={busy || !shown?.total}>
                        <FileSpreadsheet size={16} aria-hidden="true" />Download as Excel
                      </button>
                    ) : null}
                    {meta.canImport ? (
                      <button type="button" role="menuitem" className="prj-menu-item" onClick={() => { setPopover(''); setImporting(true); }}>
                        <Upload size={16} aria-hidden="true" />Import ConstructConnect file
                      </button>
                    ) : null}
                    {meta.canImport && meta.lastImport?.canUndo ? (
                      <button type="button" role="menuitem" className="prj-menu-item" onClick={() => { setPopover(''); setUndoing(true); }}>
                        <Undo2 size={16} aria-hidden="true" />Undo last import
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

        <div className="prj-views" role="tablist" aria-label="List by">
          <button type="button" role="tab" className="prj-view" aria-selected={companies} onClick={() => switchView('companies')}>Companies</button>
          <button type="button" role="tab" className="prj-view" aria-selected={!companies} onClick={() => switchView('projects')}>Projects</button>
        </div>

        {companies ? (
          <div className="prj-tabs prj-roles" role="tablist" aria-label="Companies by role">
            <button type="button" role="tab" className="prj-tab" aria-selected={!role} onClick={() => setRole('')}>All<span className="prj-cnt">{cdata?.roleCounts.all ?? 0}</span></button>
            {COMPANY_ROLES.map((r) => (
              <button key={r} type="button" role="tab" className="prj-tab" aria-selected={role === r} onClick={() => setRole(r)}>
                {COMPANY_ROLE_TABS[r]}<span className="prj-cnt">{cdata?.roleCounts[r] ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}

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
          {!shown && !error ? <div className="prj-loading"><Loader2 size={28} className="prj-spin" aria-label="Loading" /></div> : null}
          {shown && !(companies ? companyItems : items).length ? (
            <div className="prj-empty">
              <h3>{meta?.total ? (companies ? 'No companies match' : 'No projects match') : 'No multifamily leads yet'}</h3>
              {meta?.total ? 'Try another search or loosen a filter.' : meta?.canImport ? 'Use ⋯ → Import ConstructConnect file to add the first projects.' : 'An admin needs to import a ConstructConnect file.'}
            </div>
          ) : null}
          {companies && companyItems.length ? <CompanyRows items={companyItems} openKey={openKey} onOpen={setOpenKey} /> : null}
          {!companies && items.length ? (
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

        {shown && shown.total > 0 ? (
          <div className="prj-pager">
            <Pagination currentPage={currentPage} totalPages={Math.max(1, Math.ceil(shown.total / rowsPerPage))} onPageChange={setCurrentPage}
              rowsPerPage={rowsPerPage} onRowsPerPageChange={setRowsPerPage} totalCount={shown.total} />
          </div>
        ) : null}
      </div>

      {popover === 'filter' && meta && isPhone ? (
        <FilterSheet count={shown?.total ?? null} noun={companies ? 'compan' : 'project'} canClear={filtersSet} onClear={clearFilters} onClose={closePopover}>{filterFields}</FilterSheet>
      ) : null}
      {companies && openCompany ? (
        <CompanyDetail item={openCompany} canEdit={!!meta?.canEdit} onChanged={companyChanged} onClose={() => setOpenKey('')}
          onCreateCustomer={onCreateCustomer} onOpenProject={openProject} />
      ) : null}
      {fromCompany ? <LeadDetail lead={fromCompany} canEdit={!!meta?.canEdit} onChanged={setFromCompany} onClose={() => setFromCompany(null)} onCreateCustomer={onCreateCustomer} /> : null}
      {!companies && open ? <LeadDetail lead={open} canEdit={!!meta?.canEdit} onChanged={changed} onClose={() => setOpenId('')} onCreateCustomer={onCreateCustomer} /> : null}
      {importing ? <LeadImportModal onClose={() => setImporting(false)} onDone={() => setReloadKey((k) => k + 1)} /> : null}
      {undoing && meta?.lastImport ? <LeadImportModal undoOf={meta.lastImport} onClose={() => setUndoing(false)} onDone={() => setReloadKey((k) => k + 1)} /> : null}
    </div>
  );
}
