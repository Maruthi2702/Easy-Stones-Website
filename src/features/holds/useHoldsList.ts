import { useEffect, useMemo, useRef, useState } from 'react';
import { usePagination } from '../../components/shared/paginationConfig';
import { accessibleLocations } from '../../utils/locationFilter';
import { BRANCH_NAMES } from '../../config/branches';
import { listHolds } from '../../api/holds';
import type { CurrentUser } from '../../types/records';
import { useCart } from './cartStore';
import type { Hold } from './types';

/** GET /api/holds: one page of a status tab, with every tab's count. */
export type HoldList = { items: Hold[]; total: number; page: number; limit: number; scope: string; scopes: string[]; counts: Record<string, number> };

/**
 * The Holds list's data (moved out of HoldsTab, 2026-10-24): the status tab,
 * whose holds, branch, search (typed, then sent after a pause), the page, and
 * the list itself — fetched again when it comes back into view (no hold
 * open), when anyone holds or releases slabs, and on Retry. A new view goes
 * back to page 1; an answer to an older request is dropped.
 */
export function useHoldsList(user: CurrentUser | null, openId: string) {
  const [tab, setTab] = useState('active');
  const [scope, setScope] = useState(''); // '' = the server's default for this person
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage } = usePagination();
  const [data, setData] = useState<HoldList | null>(null);
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
      .then((r) => { if (n === seq.current) { setData(r as HoldList); setError(''); } })
      .catch((err) => { if (n === seq.current) setError(err.message); });
  }, [openId, tab, scope, branch, debounced, currentPage, rowsPerPage, reloadKey, reservationsTick]);

  const pickScope = (s: string) => { setScope(s); setBranch(''); };
  const retry = () => setReloadKey((k) => k + 1);

  return {
    tab, setTab, shownScope, scopes, pickScope, branch, setBranch, branchOptions, search, setSearch, debounced,
    currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, data, error, retry
  };
}
