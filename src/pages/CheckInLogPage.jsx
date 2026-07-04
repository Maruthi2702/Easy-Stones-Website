import React, { useState, useEffect } from 'react';
import { API_URL } from '../config/api';
import * as XLSX from 'xlsx';
import { Sun, Moon } from 'lucide-react';
import CheckInLogPanel from '../components/sales/CheckInLogPanel';

const LIMIT = 20;

const CheckInLogPage = () => {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
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
        setTheme(saved === 'light' ? 'light' : 'dark');
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
  const [limit, setLimit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [todayCount, setTodayCount] = useState(0);
  const [monthCount, setMonthCount] = useState(0);

  // Default to current month and year
  const currentDate = new Date();
  const [filterMonth, setFilterMonth] = useState(currentDate.getMonth() + 1); // 1-12, null = All Months
  const [filterYear, setFilterYear] = useState(currentDate.getFullYear()); // null = All Years

  useEffect(() => {
    fetchCheckIns();
    fetchStats();
    const interval = setInterval(() => { fetchCheckIns(true); fetchStats(); }, 30000);
    return () => clearInterval(interval);
  }, [currentPage, searchTerm, limit, filterMonth, filterYear]);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_URL}/api/checkin/stats`);
      if (res.ok) {
        const data = await res.json();
        setTodayCount(data.todayCount || 0);
        setMonthCount(data.monthCount || 0);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchCheckIns = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: limit,
        ...(searchTerm && { search: searchTerm }),
        ...(filterMonth && { month: filterMonth }),
        ...(filterYear && { year: filterYear }),
      });
      const response = await fetch(`${API_URL}/api/checkin?${params}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          setCheckIns(data);
          setTotalPages(1);
          setTotalCount(data.length);
        } else {
          setCheckIns(data.checkIns || data.data || []);
          setTotalPages(data.totalPages || 1);
          setTotalCount(data.total || 0);
        }
        setLastUpdated(new Date());
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
    <div className={`checkin-log-page-wrapper ${theme}-theme`} style={{ minHeight: '100vh', transition: 'background-color 0.2s ease-in-out', position: 'relative', background: 'var(--bg-primary)' }}>
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
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          rowsPerPage={limit}
          onRowsPerPageChange={(val) => { setLimit(val); setCurrentPage(1); }}
          filterMonth={filterMonth}
          filterYear={filterYear}
          onFilterMonthChange={(val) => { setFilterMonth(val); setCurrentPage(1); }}
          onFilterYearChange={(val) => { setFilterYear(val); setCurrentPage(1); }}
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
