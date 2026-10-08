import React, { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import { getCachedData, setCachedData, isCacheValid, expireCacheKeys } from '../utils/dataCache';
import { API_URL } from '../config/api';
import { authFetch } from '../api/authFetch';
import { getAuthToken } from '../api/authToken';
import { Sun, Moon } from 'lucide-react';
import CheckInLogPanel from '../components/sales/CheckInLogPanel';
import { exportCheckInLog, truncatedExportNote } from '../components/sales/exportCheckInLog';
import { useAuth } from '../context/AuthContext';
import { usePagination } from '../components/shared/paginationConfig';
import { useLocationFilter } from '../components/shared/useLocationFilter';
import { accessibleLocations } from '../utils/locationFilter';


const CheckInLogPage = () => {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_theme');
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      localStorage.setItem('checkin_theme', nextTheme);
      window.dispatchEvent(new Event('checkin_theme_changed'));
    } catch (err) {
      console.error('Failed to save check-in theme:', err);
    }
  };

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const saved = localStorage.getItem('checkin_theme');
        setTheme(saved === 'dark' ? 'dark' : 'light');
      } catch { /* not fatal — carry on */ }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('checkin_theme_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('checkin_theme_changed', handleStorageChange);
    };
  }, []);

  const [checkIns, setCheckIns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { currentPage, setCurrentPage, rowsPerPage: limit, setRowsPerPage: setLimit } = usePagination();
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [todayCount, setTodayCount] = useState(0);
  const [monthCount, setMonthCount] = useState(0);
  const [allTimeCount, setAllTimeCount] = useState(0);
  const [refreshTrigger] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  // Real branch list for the location filter dropdown — without this it falls
  // back to CheckInLogPanel's 3-branch default prop, silently hiding every
  // other real location from this standalone page (the embedded /sales
  // instance of this same panel already fetches and passes it correctly).
  const [locations, setLocations] = useState([]);
  useEffect(() => {
    authFetch(`${API_URL}/api/admin/locations`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setLocations(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Default to current month and year
  const currentDate = new Date();
  const [filterMonth, setFilterMonth] = useState(currentDate.getMonth() + 1); // 1-12, null = All Months
  const [filterYear, setFilterYear] = useState(currentDate.getFullYear()); // null = All Years
  // null = every branch they're assigned; opens on their home location.
  // Shares its remembered pick with the Check-In Log tab inside /sales.
  const locationOptions = useMemo(() => accessibleLocations(user, locations), [user, locations]);
  const [locationPick, setLocationPick] = useLocationFilter('checkInLog', user, locationOptions);
  const filterLocation = locationPick || null;
  const setFilterLocation = (val) => setLocationPick(val || '');

  // The input stays instant, but only settled input reaches the API — typing a
  // name used to fire one list request and one stats request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 350);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    fetchCheckIns();
    fetchStats();
  }, [currentPage, debouncedSearch, limit, filterMonth, filterYear, filterLocation, refreshTrigger]);

  // The socket is set up once, but the fetchers close over the current page and
  // filters. Routing through a ref keeps a live update refreshing the view the
  // user is actually on — previously it always refetched first-render state,
  // snapping the table back to page 1 with the filters cleared.
  const refreshRef = useRef(() => {});
  refreshRef.current = () => {
    fetchCheckIns(true);
    fetchStats();
  };

  useEffect(() => {
    const socket = io(API_URL || window.location.origin, {
      transports: ['websocket', 'polling'],
      withCredentials: true
    });

    // checkin_update is now scoped to the viewer's own assigned location(s)
    // (mirrors how join_delivery_rooms works for delivery_update) rather
    // than broadcast to every connected socket — this proves who the socket
    // is so the server knows which room(s) to put it in. Re-sent on every
    // reconnect, since a fresh connection joins no rooms until this fires.
    socket.on('connect', () => {
      const token = getAuthToken();
      if (token) socket.emit('join_checkin_rooms', { token });
    });

    socket.on('checkin_update', () => {
      expireCacheKeys('page_checkins_');
      refreshRef.current();
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Each request is numbered; a response that comes back after a newer one
  // was sent (filters or page changed meanwhile) is dropped, so a slow old
  // answer can't replace the rows or counts for what's selected now.
  const listSeq = useRef(0);
  const statsSeq = useRef(0);

  const fetchStats = async () => {
    const seq = ++statsSeq.current;
    try {
      const params = new URLSearchParams({
        ...(filterLocation && { location: filterLocation })
      });
      const res = await authFetch(`${API_URL}/api/checkin/stats?${params}`);
      if (res.status === 401) {
        logout();
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
      console.error('Error fetching stats:', err);
    }
  };

  const fetchCheckIns = async (silent = false) => {
    const seq = ++listSeq.current;
    const cacheKey = `page_checkins_${currentPage}_${limit}_${debouncedSearch}_${filterMonth}_${filterYear}_${filterLocation}`;
    const cached = getCachedData(cacheKey);

    if (cached && !silent) {
      setCheckIns(cached.checkIns);
      setTotalPages(cached.totalPages);
      setTotalCount(cached.totalCount);
      setLoading(false);
      if (isCacheValid(cacheKey, 120000)) return;
    } else if (!cached && !silent) {
      setLoading(true);
    } else if (silent) {
      setRefreshing(true);
    }

    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: limit,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(filterMonth && { month: filterMonth }),
        ...(filterYear && { year: filterYear }),
        ...(filterLocation && { location: filterLocation }),
      });
      const response = await authFetch(`${API_URL}/api/checkin?${params}`);
      if (response.status === 401) {
        logout();
        return;
      }
      if (response.ok) {
        const data = await response.json();
        if (seq !== listSeq.current) return;
        let list = [];
        let tPages = 1;
        let tCount = 0;
        if (Array.isArray(data)) {
          list = data;
          tCount = data.length;
        } else {
          list = data.checkIns || data.data || [];
          tPages = data.totalPages || 1;
          tCount = data.total || 0;
        }
        setCheckIns(list);
        setTotalPages(tPages);
        setTotalCount(tCount);
        setLastUpdated(new Date());
        setCachedData(cacheKey, { checkIns: list, totalPages: tPages, totalCount: tCount });
      }
    } catch (err) {
      console.error('Error fetching check-ins:', err);
    } finally {
      // A newer request owns the spinner now.
      if (seq === listSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  // Every row matching the table's filters, not just the page on screen —
  // see exportCheckInLog (shared with the Check-In Log tab). A failed page
  // stops the export with a message instead of writing a partial file.
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportCheckInLog({
        search: debouncedSearch, month: filterMonth, year: filterYear, location: filterLocation
      });
      if (result.truncated) alert(truncatedExportNote(result));
    } catch (err) {
      console.error('Error exporting check-ins:', err);
      if (err.code === 'auth') logout();
      else alert(err.message || 'Couldn’t export the check-ins. Try again.');
    } finally {
      setIsExporting(false);
    }
  };
  return (
    <div className={`checkin-log-page-wrapper ${theme}-theme`} style={{ minHeight: '100vh', transition: 'background-color 0.2s ease-in-out', position: 'relative', background: theme === 'light' ? '#f8fafc' : 'var(--bg-primary)' }}>
      <div>
        <CheckInLogPanel
          checkIns={checkIns}
          loading={loading}
          refreshing={refreshing}
          onRefresh={() => { fetchCheckIns(true); fetchStats(); }}
          searchTerm={searchTerm}
          onSearchChange={(val) => { setSearchTerm(val); setCurrentPage(1); }}
          lastUpdated={lastUpdated}
          totalCount={totalCount}
          todayCount={todayCount}
          monthCount={monthCount}
          allTimeCount={allTimeCount}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          rowsPerPage={limit}
          onRowsPerPageChange={(val) => { setLimit(val); setCurrentPage(1); }}
          filterMonth={filterMonth}
          filterYear={filterYear}
          onFilterMonthChange={(val) => { setFilterMonth(val); setCurrentPage(1); }}
          onFilterYearChange={(val) => { setFilterYear(val); setCurrentPage(1); }}
          filterLocation={filterLocation}
          onFilterLocationChange={(val) => { setFilterLocation(val); setCurrentPage(1); }}
          locations={locations}
          onExport={handleExport}
          isExporting={isExporting}
          exportFilters={{ search: debouncedSearch, month: filterMonth, year: filterYear, location: filterLocation }}
          embedded={false}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </div>
    </div>
  );
};

export default CheckInLogPage;
