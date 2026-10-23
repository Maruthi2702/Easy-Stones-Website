import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { DEFAULT_ROWS_PER_PAGE } from '../../components/shared/paginationConfig';
import { useLocationFilter } from '../../components/shared/useLocationFilter';
import { accessibleLocations } from '../../utils/locationFilter';
import { getCachedData, setCachedData, isCacheValid } from '../../utils/dataCache';
import type { Loose } from '../../types/records';
import { fetchCheckInStatsFor, fetchCheckInPage, deleteCheckIn, saveCheckInDetails } from './checkInApi';

/** The visitor details the Edit Check-In form changes. */
export type CheckInForm = {
  name: string;
  phone: string;
  email: string;
  fabricatorCompany: string;
  fabricatorName: string;
  fabricatorPhone: string;
  location: string;
};

const EMPTY_FORM: CheckInForm = {
  name: '', phone: '', email: '', fabricatorCompany: '', fabricatorName: '', fabricatorPhone: '', location: 'Seattle'
};

/**
 * The Sales page's Check-In Log tab: the list (paged, searched, filtered by
 * month / year / branch), its counts, the export, and the view / edit / delete
 * of one check-in. Held by the page so filters and the page number survive
 * switching tabs, as before the move. `active` is whether the tab is on screen
 * (it loads then); `onUnauthorized` signs out on a 401.
 */
export function useCheckInLog({ active, currentUser, locations, onUnauthorized }: {
  active: boolean;
  currentUser: Loose | null;
  locations: unknown[];
  onUnauthorized: () => void;
}) {
  const [checkIns, setCheckIns] = useState<Loose[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_ROWS_PER_PAGE);
  const [month, setMonth] = useState<number | null>(() => new Date().getMonth() + 1);
  const [year, setYear] = useState<number | null>(() => new Date().getFullYear());
  // '' = every branch they're assigned; opens on their home location.
  const locationOptions = useMemo(() => accessibleLocations(currentUser, locations), [currentUser, locations]);
  const [locationPick, setLocationPick] = useLocationFilter('checkInLog', currentUser as never, locationOptions);
  const location = locationPick || null;
  const [selected, setSelected] = useState<Loose | null>(null);
  const [mode, setMode] = useState<'view' | 'edit' | null>(null);
  const [form, setForm] = useState<CheckInForm>(EMPTY_FORM);
  const [todayCount, setTodayCount] = useState(0);
  const [monthCount, setMonthCount] = useState(0);
  const [allTimeCount, setAllTimeCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  // Each request is numbered; an answer that arrives after a newer one was
  // sent (the filters or page changed meanwhile) is dropped, so a slow old
  // answer can't replace the rows or counts for what's selected now.
  const listSeq = useRef(0);
  const statsSeq = useRef(0);

  const fetchStats = async () => {
    const seq = ++statsSeq.current;
    try {
      const res = await fetchCheckInStatsFor(location);
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (seq !== statsSeq.current) return;
        setTodayCount(data.todayCount || 0);
        setMonthCount(data.monthCount || 0);
        setAllTimeCount(data.allTimeCount || 0);
      }
    } catch (err) {
      console.error('Error fetching check-in stats:', err);
    }
  };

  const refresh = useCallback(async (silent = false) => {
    const seq = ++listSeq.current;
    const cacheKey = `checkins_${page}_${limit}_${search}_${month}_${year}_${location}`;
    const cached = getCachedData<{ checkIns: Loose[]; totalPages: number; totalCount: number }>(cacheKey);

    if (cached && !silent) {
      setCheckIns(cached.checkIns);
      setTotalPages(cached.totalPages);
      setTotalCount(cached.totalCount);
      setLoading(false);
      if (isCacheValid(cacheKey, 120000)) return;
    } else if (!cached && !silent) {
      setLoading(true);
    }

    try {
      fetchStats();
      const response = await fetchCheckInPage({ page, limit, search, month, year, location });
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (response.ok) {
        const data = await response.json();
        if (seq !== listSeq.current) return;
        let list: Loose[] = [];
        let pages = 1;
        let count = 0;
        if (Array.isArray(data)) {
          list = data;
          count = data.length;
        } else {
          list = data.checkIns || data.data || [];
          pages = data.totalPages || 1;
          count = data.total || 0;
        }
        setCheckIns(list);
        setTotalPages(pages);
        setTotalCount(count);
        setCachedData(cacheKey, { checkIns: list, totalPages: pages, totalCount: count });
      }
    } catch (error) {
      console.error('Error fetching check-ins:', error);
    } finally {
      // A newer request owns the spinner now.
      if (seq === listSeq.current) setLoading(false);
    }
    // fetchStats reads the same filters this list does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, search, month, year, location, onUnauthorized]);

  // Every row matching the filters, not just the page on screen — shared with
  // the /checkin-log page (exportCheckInLog). A failed page stops the export
  // with a message instead of writing a partial file.
  const exportAll = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Loaded on click, so xlsx stays out of the page bundle.
      const { exportCheckInLog, truncatedExportNote } = await import('./exportCheckInLog');
      const result = await exportCheckInLog({ search, month, year, location });
      if (result.truncated) alert(truncatedExportNote(result));
    } catch (err) {
      console.error('Error exporting check-ins:', err);
      if ((err as { code?: string }).code === 'auth') onUnauthorized();
      else alert((err as Error).message || 'Couldn’t export the check-ins. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const view = (checkIn: Loose) => {
    setSelected(checkIn);
    setMode('view');
  };

  const edit = (checkIn: Loose) => {
    setSelected(checkIn);
    setMode('edit');
    setForm({
      name: checkIn.name || '',
      phone: checkIn.phone || '',
      email: checkIn.email || '',
      fabricatorCompany: checkIn.fabricatorCompany || '',
      fabricatorName: checkIn.fabricatorName || '',
      fabricatorPhone: checkIn.fabricatorPhone || '',
      location: checkIn.location || 'Seattle'
    });
  };

  const remove = async (checkIn: Loose) => {
    if (window.confirm(`Are you sure you want to delete the check-in record for ${checkIn.name}?`)) {
      try {
        const response = await deleteCheckIn(checkIn._id);
        if (response.ok) {
          refresh();
        } else {
          const data = await response.json();
          alert(data.message || 'Failed to delete check-in');
        }
      } catch (err) {
        console.error(err);
        alert('Network error. Please try again.');
      }
    }
  };

  const save = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.fabricatorCompany || !form.fabricatorPhone) {
      alert('Name, Phone Number, Company Name, and Company Phone Number are mandatory');
      return;
    }
    try {
      const response = await saveCheckInDetails((selected as Loose)._id, form);
      if (response.ok) {
        setMode(null);
        setSelected(null);
        refresh();
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to save check-in');
      }
    } catch (err) {
      console.error(err);
      alert('Network error. Please try again.');
    }
  };

  const close = () => { setSelected(null); setMode(null); };

  useEffect(() => {
    if (active) refresh();
    // The same triggers as before the move: the tab opening and every filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, page, limit, search, month, year, location]);

  // Each filter change goes back to page 1.
  return {
    checkIns, loading, totalPages, totalCount, todayCount, monthCount, allTimeCount,
    search, page, limit, month, year, location, exporting,
    setSearch: (v: string) => { setSearch(v); setPage(1); },
    setPage,
    setLimit: (v: number) => { setLimit(v); setPage(1); },
    setMonth: (v: number | null) => { setMonth(v); setPage(1); },
    setYear: (v: number | null) => { setYear(v); setPage(1); },
    setLocation: (v: string | null) => { setLocationPick(v || ''); setPage(1); },
    refresh, exportAll,
    selected, mode, form, setForm, view, edit, remove, save, close
  };
}

export type CheckInLog = ReturnType<typeof useCheckInLog>;
