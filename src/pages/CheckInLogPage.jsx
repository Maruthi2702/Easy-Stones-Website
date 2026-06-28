import React, { useState, useEffect } from 'react';
import { API_URL } from '../config/api';
import * as XLSX from 'xlsx';
import CheckInLogPanel from '../components/sales/CheckInLogPanel';

const LIMIT = 20;

const CheckInLogPage = () => {
  const [checkIns, setCheckIns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    fetchCheckIns();
    const interval = setInterval(() => fetchCheckIns(true), 30000);
    return () => clearInterval(interval);
  }, [currentPage, searchTerm]);

  const fetchCheckIns = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: LIMIT,
        ...(searchTerm && { search: searchTerm }),
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
      Email: c.email || '',
      'Fabricator Company': c.fabricatorCompany || '',
      'Fabricator Name': c.fabricatorName || '',
      'Fabricator Phone': c.fabricatorPhone || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Check-In Log');
    XLSX.writeFile(wb, `checkin-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div style={{ paddingTop: '96px' }}>
      <CheckInLogPanel
        checkIns={checkIns}
        loading={loading}
        refreshing={refreshing}
        onRefresh={() => fetchCheckIns(true)}
        searchTerm={searchTerm}
        onSearchChange={(val) => { setSearchTerm(val); setCurrentPage(1); }}
        lastUpdated={lastUpdated}
        totalCount={totalCount}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        onExport={handleExport}
        embedded={false}
      />
    </div>
  );
};

export default CheckInLogPage;
