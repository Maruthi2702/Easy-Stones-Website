import React, { useState, useEffect } from 'react';
import { Clock, Search, Download, Loader2, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { API_URL } from '../config/api';
import * as XLSX from 'xlsx';
import './CheckInPage.css';

const CheckInLogPage = () => {
  const [checkIns, setCheckIns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const LIMIT = 20;

  useEffect(() => {
    fetchCheckIns();
    const interval = setInterval(fetchCheckIns, 30000);
    return () => clearInterval(interval);
  }, [currentPage, searchTerm]);

  const fetchCheckIns = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: LIMIT,
        ...(searchTerm && { search: searchTerm }),
      });
      const response = await fetch(`${API_URL}/api/checkin?${params}`);
      if (response.ok) {
        const data = await response.json();
        // Support both paginated and flat array responses
        if (Array.isArray(data)) {
          setCheckIns(data);
          setTotalPages(1);
          setTotalCount(data.length);
        } else {
          setCheckIns(data.checkIns || data.data || []);
          setTotalPages(data.totalPages || 1);
          setTotalCount(data.total || 0);
        }
      }
    } catch (err) {
      console.error('Error fetching check-ins:', err);
    } finally {
      setLoading(false);
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

  const filtered = checkIns.filter(c => {
    const s = searchTerm.toLowerCase();
    return (
      (c.name || '').toLowerCase().includes(s) ||
      (c.phone || '').toLowerCase().includes(s) ||
      (c.fabricatorCompany || '').toLowerCase().includes(s) ||
      (c.fabricatorName || '').toLowerCase().includes(s)
    );
  });

  return (
    <div style={{ paddingTop: '96px', minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Clock size={24} color="var(--accent-primary, #d4af37)" />
            <div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Visitor Check-In Log</h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
                {totalCount > 0 ? `${totalCount} total entries` : 'Live tracking of all visitors'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input
                type="text"
                placeholder="Search visitors..."
                value={searchTerm}
                onChange={handleSearch}
                style={{
                  paddingLeft: '34px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.875rem', width: '220px'
                }}
              />
            </div>
            <button
              onClick={handleExport}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: 'var(--accent-primary, #d4af37)', color: '#000',
                border: 'none', borderRadius: '8px', padding: '8px 16px',
                fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer'
              }}
            >
              <Download size={16} /> Export Excel
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <Calendar size={40} style={{ marginBottom: '1rem', opacity: 0.4 }} />
              <p>No visitors found.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {['Date & Time', 'Name', 'Phone', 'Email', 'Fabricator Company', 'Fabricator Name'].map(h => (
                      <th key={h} style={{ padding: '0.875rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={c._id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 500 }}>{formatDate(c.createdAt)}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{formatTime(c.createdAt)}</div>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{c.name}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{c.phone || '—'}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{c.email || '—'}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {c.fabricatorCompany ? (
                          <span style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 500 }}>
                            {c.fabricatorCompany}
                          </span>
                        ) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{c.fabricatorName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px 12px', color: 'var(--text-primary)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.4 : 1 }}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Page {currentPage} of {totalPages}</span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px 12px', color: 'var(--text-primary)', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.4 : 1 }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckInLogPage;
