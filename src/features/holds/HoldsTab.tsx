import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import HoldsToolbar from './list/HoldsToolbar';
import Pagination from '../../components/shared/Pagination';
import { HOLD_TABS } from '../../utils/holdView';
import type { CurrentUser } from '../../types/records';
import { useHoldLink } from './holdLink';
import { useHoldsList } from './useHoldsList';
import HoldsResults from './list/HoldsResults';
import HoldPage from './hold/HoldPage';
import './Holds.css';

export type HoldsTabProps = { currentUser: CurrentUser | null; sidebarToggle?: ReactNode };

/**
 * Sales · Holds: every hold the person may see (mine / my branches / all, set
 * per role under Users & Roles), by status, and — with ?hold= in the URL — one
 * hold's page. Built from the "Sales · Holds" canvas; rules in
 * src/utils/holdView.ts and src/holds/. The server checks everything again.
 * The list's data is useHoldsList; its header HoldsToolbar, its rows HoldsResults.
 */
export default function HoldsTab({ currentUser, sidebarToggle = null }: HoldsTabProps) {
  const user = currentUser;
  const [openId, openHold, closeHold] = useHoldLink();
  const {
    tab, setTab, shownScope, scopes, pickScope, branch, setBranch, branchOptions, search, setSearch, debounced,
    currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, data, error, retry
  } = useHoldsList(user, openId);

  if (openId) {
    return (
      <div className="hl">
        <HoldPage id={openId} user={user} sidebarToggle={sidebarToggle} onBack={closeHold} />
      </div>
    );
  }

  const counts: Record<string, number> = data?.counts || {};
  const filtered = Boolean(debounced || branch);

  return (
    <div className="hl">
      <div className="hl-page">
        <HoldsToolbar user={user} sidebarToggle={sidebarToggle} scopes={scopes} shownScope={shownScope} onPickScope={pickScope}
          search={search} onSearch={setSearch} branchOptions={branchOptions} branch={branch} onBranch={setBranch} />

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
            <button type="button" className="hl-btn sm" onClick={retry}>Retry</button>
          </div>
        ) : null}

        <HoldsResults data={data} error={error} tab={tab} filtered={filtered} shownScope={shownScope} onOpen={openHold} />

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
