import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocationFilter } from '../../components/shared/useLocationFilter';
import { usePagination } from '../../components/shared/paginationConfig';
import { accessibleLocations } from '../../utils/locationFilter';
import * as api from './freightApi';
import type { Loose } from '../../types/records';
import type { Carrier, FreightCharge, FreightUser } from './types';

/**
 * The list's data: the tab, search, branch and carrier filters, the page, the
 * charges and their summary, and the carriers — reloaded whenever `refresh()`
 * is called (after any save). A new view (tab, search, branch, carrier) goes
 * back to page 1 and calls `onNewView` (the page clears its selection).
 */
export function useFreightData(user: FreightUser, locationsList: Loose[], onNewView: () => void) {
  const [tab, setTab] = useState('to_approve');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const branchOptions = useMemo(() => accessibleLocations(user, locationsList), [user, locationsList]);
  const [location, setLocation] = useLocationFilter('freight', user, branchOptions);
  const [carrierId, setCarrierId] = useState('');
  const { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage } = usePagination();

  const [data, setData] = useState<Loose | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const seq = useRef(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // Typing settles before it reaches the server.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // A new view: back to page 1, nothing selected.
  const filterKey = `${tab}|${debounced}|${location}|${carrierId}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    onNewView();
    resetPage();
  }

  useEffect(() => {
    const n = ++seq.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- as it was before the split (the rule now sees it)
    setLoading(true);
    api.listCharges({ status: tab, search: debounced, location, carrierId, page: currentPage, limit: rowsPerPage })
      .then((r) => { if (n === seq.current) { setData(r); setError(''); } })
      .catch((err: Error) => { if (n === seq.current) setError(err.message); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [tab, debounced, location, carrierId, currentPage, rowsPerPage, reloadKey]);

  useEffect(() => {
    api.listCarriers().then(setCarriers).catch(() => {});
  }, [reloadKey]);

  const items = useMemo((): FreightCharge[] => data?.items || [], [data]);
  const summary: Loose = data?.summary || {};

  return {
    tab, setTab, search, setSearch, debounced, branchOptions, location, setLocation, carrierId, setCarrierId,
    currentPage, setCurrentPage, rowsPerPage, setRowsPerPage,
    data, items, summary, loading, error, setError, carriers, reloadKey, refresh
  };
}

export type FreightData = ReturnType<typeof useFreightData>;
