import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getCachedData, setCachedData, isCacheValid } from '../utils/dataCache';
import { API_URL } from '../config/api';
import { viewerTimeZone } from '../utils/dateUtils';
import * as XLSX from 'xlsx';
import { Sun, Moon } from 'lucide-react';
import CheckInLogPanel from '../components/sales/CheckInLogPanel';
import { useAuth } from '../context/AuthContext';

const LIMIT = 20;


const CheckInLogPage = () => {
  const { logout } = useAuth();
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_theme');
      return saved === 'dark' ? 'dark' : 'light';
    } catch (e) {
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
      } catch (e) {}
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
  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [todayCount, setTodayCount] = useState(0);
  const [monthCount, setMonthCount] = useState(0);
  const [allTimeCount, setAllTimeCount] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Default to current month and year
  const currentDate = new Date();
  const [filterMonth, setFilterMonth] = useState(currentDate.getMonth() + 1); // 1-12, null = All Months
  const [filterYear, setFilterYear] = useState(currentDate.getFullYear()); // null = All Years
  const [filterLocation, setFilterLocation] = useState(null);

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

    socket.on('checkin_update', () => {
      refreshRef.current();
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const fetchStats = async () => {
    try {
      const params = new URLSearchParams({
        tz: viewerTimeZone,
        ...(filterLocation && { location: filterLocation })
      });
      const res = await fetch(`${API_URL}/api/checkin/stats?${params}`, { credentials: 'include' });
      if (res.status === 401) {
        logout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setTodayCount(data.todayCount || 0);
        setMonthCount(data.monthCount || 0);
        setAllTimeCount(data.allTimeCount || 0);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchCheckIns = async (silent = false) => {
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
        tz: viewerTimeZone,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(filterMonth && { month: filterMonth }),
        ...(filterYear && { year: filterYear }),
        ...(filterLocation && { location: filterLocation }),
      });
      const response = await fetch(`${API_URL}/api/checkin?${params}`, { credentials: 'include' });
      if (response.status === 401) {
        logout();
        return;
      }
      if (response.ok) {
        const data = await response.json();
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
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleExport = () => {
    const rows = checkIns.map((c) => ({
      Date: new Date(c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
      Time: new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      Name: c.name,
      Phone: c.phone,
      'Company/Contact Name': c.fabricatorCompany || '',
      'Fabricator Phone': c.fabricatorPhone || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Check-In Log');
    XLSX.writeFile(wb, `checkin-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
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
          onExport={handleExport}
          embedded={false}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </div>
    </div>
  );
};

export default CheckInLogPage;
