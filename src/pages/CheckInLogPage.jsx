import React, { useState, useEffect } from 'react';
import { Clock, Search, Download, Loader2, Calendar, ChevronLeft, ChevronRight, RefreshCw, Users, Building2, Phone, Mail, UserCheck } from 'lucide-react';
import { API_URL } from '../config/api';
import * as XLSX from 'xlsx';
import './CheckInLogPage.css';

const CheckInLogPage = () => {
  const [checkIns, setCheckIns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const LIMIT = 20;

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

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleExport = () => {
    const rows = checkIns.map(c => ({
      Date: formatDate(c.createdAt),
      Time: formatTime(c.createdAt),
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

  const formatDate = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatLastUpdated = (d) => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

  const isToday = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  };

  const todayCount = checkIns.filter(c => isToday(c.createdAt)).length;
  const fabricatorCount = checkIns.filter(c => c.fabricatorCompany).length;

  const filtered = checkIns.filter(c => {
    const s = searchTerm.toLowerCase();
    return (
      (c.name || '').toLowerCase().includes(s) ||
      (c.phone || '').toLowerCase().includes(s) ||
      (c.fabricatorCompany || '').toLowerCase().includes(s) ||
      (c.fabricatorName || '').toLowerCase().includes(s)
    );
  });

  const getInitials = (name) => name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';
  const getAvatarColor = (name) => {
    const colors = ['#d4af37', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="checkin-log-page">
      {/* Hero Header */}
      <div className="checkin-log-hero">
        <div className="checkin-log-hero-bg" />
        <div className="checkin-log-hero-content">
          <div className="checkin-log-hero-left">
            <div className="checkin-log-icon-wrap">
              <Clock size={22} />
            </div>
            <div>
              <h1 className="checkin-log-title">Visitor Check-In Log</h1>
              <p className="checkin-log-subtitle">
                Live tracking of clients and fabricators visiting the office
                {lastUpdated && <span className="checkin-log-updated"> · Updated {formatLastUpdated(lastUpdated)}</span>}
              </p>
            </div>
          </div>
          <button
            className="checkin-log-refresh-btn"
            onClick={() => fetchCheckIns(true)}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="checkin-log-body">

        {/* Stats Row */}
        <div className="checkin-log-stats">
          <div className="checkin-stat-card">
            <div className="checkin-stat-icon" style={{ background: 'rgba(212,175,55,0.15)', color: '#d4af37' }}>
              <Users size={18} />
            </div>
            <div>
              <div className="checkin-stat-value">{totalCount}</div>
              <div className="checkin-stat-label">Total Visitors</div>
            </div>
          </div>
          <div className="checkin-stat-card">
            <div className="checkin-stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
              <UserCheck size={18} />
            </div>
            <div>
              <div className="checkin-stat-value">{todayCount}</div>
              <div className="checkin-stat-label">Today's Visitors</div>
            </div>
          </div>
          <div className="checkin-stat-card">
            <div className="checkin-stat-icon" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>
              <Building2 size={18} />
            </div>
            <div>
              <div className="checkin-stat-value">{fabricatorCount}</div>
              <div className="checkin-stat-label">With Company</div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="checkin-log-controls">
          <div className="checkin-log-search-wrap">
            <Search size={15} className="checkin-search-icon" />
            <input
              type="text"
              placeholder="Search by name, phone, or company..."
              value={searchTerm}
              onChange={handleSearch}
              className="checkin-log-search"
            />
          </div>
          <button className="checkin-log-export-btn" onClick={handleExport}>
            <Download size={15} />
            Export Excel
          </button>
        </div>

        {/* Table Card */}
        <div className="checkin-log-table-card">
          {loading ? (
            <div className="checkin-log-loading">
              <Loader2 size={36} className="spin" />
              <p>Loading visitors...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="checkin-log-empty">
              <Calendar size={48} />
              <h3>No visitors found</h3>
              <p>{searchTerm ? 'Try adjusting your search term.' : 'No check-ins recorded yet.'}</p>
            </div>
          ) : (
            <div className="checkin-log-table-wrap">
              <table className="checkin-log-table">
                <thead>
                  <tr>
                    <th>CHECK-IN TIME</th>
                    <th>VISITOR NAME</th>
                    <th>PHONE NUMBER</th>
                    <th>EMAIL</th>
                    <th>FABRICATOR / COMPANY</th>
                    <th>STAFF CONTACT</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c._id} className={isToday(c.createdAt) ? 'row-today' : ''}>
                      <td className="td-time">
                        <div className="time-date">{formatDate(c.createdAt)}</div>
                        <div className="time-clock">{formatTime(c.createdAt)}</div>
                        {isToday(c.createdAt) && <span className="badge-today">Today</span>}
                      </td>
                      <td className="td-name">
                        <div className="visitor-row">
                          <div
                            className="visitor-avatar"
                            style={{ background: `linear-gradient(135deg, ${getAvatarColor(c.name)}, ${getAvatarColor(c.name)}aa)` }}
                          >
                            {getInitials(c.name)}
                          </div>
                          <span className="visitor-name">{c.name}</span>
                        </div>
                      </td>
                      <td className="td-phone">
                        {c.phone ? (
                          <div className="phone-wrap">
                            <Phone size={13} />
                            {c.phone}
                          </div>
                        ) : <span className="td-empty">—</span>}
                      </td>
                      <td className="td-email">
                        {c.email ? (
                          <div className="email-wrap">
                            <Mail size={13} />
                            {c.email}
                          </div>
                        ) : <span className="td-empty">—</span>}
                      </td>
                      <td className="td-company">
                        {c.fabricatorCompany ? (
                          <span className="badge-company">{c.fabricatorCompany}</span>
                        ) : <span className="td-empty">—</span>}
                      </td>
                      <td className="td-staff">
                        {c.fabricatorName ? (
                          <span className="badge-staff">{c.fabricatorName}</span>
                        ) : <span className="badge-none">None</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="checkin-log-pagination">
            <button
              className="page-btn"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft size={16} /> Prev
            </button>
            <span className="page-info">Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong></span>
            <button
              className="page-btn"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckInLogPage;
