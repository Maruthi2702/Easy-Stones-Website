import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, AlertTriangle, Loader2 } from 'lucide-react';
import LocationFilter, { LocationField } from '../../shared/LocationFilter';
import Pagination from '../../shared/Pagination';
import { usePagination } from '../../shared/paginationConfig';
import { accessibleLocations } from '../../../utils/locationFilter';
import { BRANCH_NAMES } from '../../../config/branches';
import { listHolds } from '../../../api/holds';
import { formatMoney, formatSf } from '../../../holds/holdRules';
import { HOLD_TABS, SCOPE_LABELS, productSummary, expiryLine, longDate, dayMonth, dateOf, slabCount } from '../../../utils/holdView';
import { useCart } from './cartStore';
import { useHoldLink } from './holdLink';
import HoldPage from './HoldPage';
import './Holds.css';

const EMPTY = {
  active: ['No active holds', 'Tick slabs on the Inventory screen, then hold them from the cart.'],
  expiring: ['Nothing expiring soon', 'Holds that end in the next 3 days show here.'],
  expired: ['No expired holds', 'An expired hold keeps its slabs for 7 more days, then lets them go.'],
  released: ['Nothing released', 'Released holds stay here, with who released them and why.'],
  all: ['No holds yet', 'Tick slabs on the Inventory screen, then hold them from the cart.']
};

/** A hold's total, or what's priced so far when some slabs have no price. */
function TotalCell({ totals }) {
  if (totals.totalCents !== null) return <b>{formatMoney(totals.totalCents)}</b>;
  if (totals.missingPrices === totals.slabs) return <span className="hl-miss">No prices yet</span>;
  return (
    <span>
      <b>{formatMoney(totals.pricedCents)}</b>
      <span className="hl-sub hl-miss">{totals.missingPrices} without a price</span>
    </span>
  );
}

/**
 * Sales · Holds: every hold the person may see (mine / my branches / all, set
 * per role under Users & Roles), by status, and — with ?hold= in the URL — one
 * hold's page. Built from the "Sales · Holds" canvas; rules in
 * src/utils/holdView.js and src/holds/. The server checks everything again.
 */
export default function HoldsTab({ currentUser, sidebarToggle = null }) {
  const user = currentUser;
  const [openId, openHold, closeHold] = useHoldLink();
  const [tab, setTab] = useState('active');
  const [scope, setScope] = useState(''); // '' = the server's default for this person
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage } = usePagination();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const { reservationsTick } = useCart();
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const shownScope = scope || data?.scope || '';
  const scopes = data?.scopes || [];
  const branchOptions = useMemo(
    () => (shownScope === 'all' ? BRANCH_NAMES : shownScope === 'branch' ? accessibleLocations(user, BRANCH_NAMES) : []),
    [shownScope, user]
  );

  // A new view goes back to page 1.
  const filterKey = `${tab}|${scope}|${branch}|${debounced}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    resetPage();
  }

  // The list reloads when it comes back into view, and when anyone holds or releases slabs.
  useEffect(() => {
    if (openId) return;
    const n = ++seq.current;
    listHolds({ status: tab, scope: scope || undefined, branch, search: debounced, page: currentPage, limit: rowsPerPage })
      .then((r) => { if (n === seq.current) { setData(r); setError(''); } })
      .catch((err) => { if (n === seq.current) setError(err.message); });
  }, [openId, tab, scope, branch, debounced, currentPage, rowsPerPage, reloadKey, reservationsTick]);

  const pickScope = (s) => { setScope(s); setBranch(''); };

  if (openId) {
    return (
      <div className="hl">
        <HoldPage id={openId} user={user} sidebarToggle={sidebarToggle} onBack={closeHold} />
      </div>
    );
  }

  const items = data?.items || [];
  const counts = data?.counts || {};
  const filtered = Boolean(debounced || branch);
  const now = new Date();

  return (
    <div className="hl">
      <div className="hl-page">
        <div className="hl-head">
          {sidebarToggle}
          <h1 className="hl-title">Holds</h1>
          <span className="hl-grow" />
          {scopes.length > 1 ? (
            <div className="hl-seg" role="group" aria-label="Whose holds">
              {scopes.map((s) => (
                <button key={s} type="button" className={shownScope === s ? 'on' : ''} aria-pressed={shownScope === s} onClick={() => pickScope(s)}>
                  {SCOPE_LABELS[s]}
                </button>
              ))}
            </div>
          ) : null}
          <label className="hl-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hold #, customer, job, serial #" aria-label="Search holds" />
            {search ? <button type="button" className="hl-x" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button> : null}
          </label>
          {branchOptions.length > 1 ? (
            <LocationFilter options={[]} value="" onChange={() => {}} user={user} active={Boolean(branch)} onClear={() => setBranch('')}>
              <LocationField options={branchOptions} value={branch} onChange={(v) => setBranch(v || '')} user={user} />
            </LocationFilter>
          ) : null}
        </div>

        <div className="hl-tabs" role="tablist" aria-label="Holds by status">
          {HOLD_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className={`hl-tab${t.id === 'expiring' && counts.expiring ? ' warn' : ''}`} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              <span className="hl-cnt">{counts[t.id] ?? 0}</span>
            </button>
          ))}
        </div>

        {error ? (
          <div className="hl-note error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span className="hl-grow">{error}</span>
            <button type="button" className="hl-btn sm" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
          </div>
        ) : null}

        <div className={`hl-card${items.length ? ' has-cards' : ''}`}>
          {!data && !error ? <div className="hl-loading"><Loader2 size={28} className="hl-spin" aria-label="Loading" /></div> : null}
          {data && !items.length ? (
            <div className="hl-empty">
              <h3>{filtered ? 'No holds match' : EMPTY[tab][0]}</h3>
              {filtered ? 'Try another search or branch.' : EMPTY[tab][1]}
            </div>
          ) : null}
          {items.length ? (
            <>
              <div className="hl-table-wrap">
                <table className="hl-table">
                  <thead>
                    <tr>
                      <th>Hold #</th><th>Held</th><th>Customer / job</th><th>Branch · rep</th><th>Slabs</th><th className="r">Total</th><th>Hold until</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((h) => {
                      const exp = expiryLine(h, now);
                      return (
                        <tr key={h._id} className="hl-row" tabIndex={0} onClick={() => openHold(String(h._id))}
                          onKeyDown={(e) => { if (e.key === 'Enter') openHold(String(h._id)); }}>
                          <td className="hl-num">#{h.number}</td>
                          <td>{dateOf(h.createdAt)}</td>
                          <td className="hl-cust">
                            <span className="hl-name">{h.customer?.name || '—'}</span>
                            <span className="hl-sub">{h.job || productSummary(h.products)}</span>
                          </td>
                          <td>{h.branch}<span className="hl-sub">{h.createdBy?.name || ''}</span></td>
                          <td>{slabCount(h.totals.slabs)}<span className="hl-sub">{formatSf(h.totals.sfHundredths)}</span></td>
                          <td className="r"><TotalCell totals={h.totals} /></td>
                          <td>{longDate(h.expiresOn)}<span className={`hl-sub hl-exp ${exp.tone}`}>{exp.text}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="hl-cards">
                {items.map((h) => {
                  const exp = expiryLine(h, now);
                  return (
                    <button key={h._id} type="button" className="hl-ccard" onClick={() => openHold(String(h._id))}>
                      <span className="hl-ccard-top">
                        <b>Hold #{h.number}</b>
                        <span className={`hl-exp-chip ${exp.tone}`}>{exp.tone === 'ok' ? dayMonth(h.expiresOn) : exp.text}</span>
                        <span className="hl-grow" />
                        <TotalCell totals={h.totals} />
                      </span>
                      <span className="hl-ccard-name">{h.customer?.name || '—'}</span>
                      <span className="hl-ccard-meta">
                        {[slabCount(h.totals.slabs), formatSf(h.totals.sfHundredths), h.createdBy?.name, shownScope !== 'mine' ? h.branch : null].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        {data && data.total > 0 ? (
          <div className="hl-pager">
            <Pagination currentPage={currentPage} totalPages={Math.max(1, Math.ceil(data.total / rowsPerPage))} onPageChange={setCurrentPage}
              rowsPerPage={rowsPerPage} onRowsPerPageChange={setRowsPerPage} totalCount={data.total} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
