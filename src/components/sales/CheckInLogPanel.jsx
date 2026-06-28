/**
 * CheckInLogPanel — Shared UI component
 *
 * Used by:
 *  - /checkin-log  (standalone protected page)
 *  - /sales?tab=checkin  (embedded CRM panel)
 *
 * Props:
 *  checkIns        – array of check-in objects
 *  loading         – boolean (initial load spinner)
 *  refreshing      – boolean (silent refresh spinner)
 *  onRefresh       – () => void
 *  searchTerm      – string
 *  onSearchChange  – (value: string) => void
 *  lastUpdated     – Date | null
 *  totalCount      – number  (used in standalone header subtitle)
 *  currentPage     – number
 *  totalPages      – number
 *  onPageChange    – (page: number) => void
 *  onExport        – () => void  (if provided, shows Export button)
 *  sidebarToggle   – ReactNode | null  (sidebar menu button for CRM mode)
 *  embedded        – bool  (true = CRM panel mode, false = full-page mode)
 */
import React from 'react';
import {
  Clock, Search, Download, Loader2, Calendar,
  ChevronLeft, ChevronRight, RefreshCw,
  Users, Building2, Phone, Mail, UserCheck, X
} from 'lucide-react';
import './CheckInLogPanel.css';

/* ── helpers ──────────────────────────────────── */
const formatDate = (ts) =>
  new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

const formatTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatLastUpdated = (d) =>
  d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

const isToday = (ts) => {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
};

const getInitials = (name) =>
  name ? name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) : '?';

const AVATAR_COLORS = ['#d4af37', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];
const getAvatarColor = (name) => {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

/* ── component ────────────────────────────────── */
const CheckInLogPanel = ({
  checkIns = [],
  loading = false,
  refreshing = false,
  onRefresh,
  searchTerm = '',
  onSearchChange,
  lastUpdated = null,
  totalCount = 0,
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  onExport,
  sidebarToggle = null,
  embedded = false,
}) => {
  const todayCount = checkIns.filter((c) => isToday(c.createdAt)).length;
  const withCompanyCount = checkIns.filter((c) => c.fabricatorCompany).length;

  const filtered = checkIns.filter((c) => {
    const s = searchTerm.toLowerCase();
    return (
      (c.name || '').toLowerCase().includes(s) ||
      (c.phone || '').toLowerCase().includes(s) ||
      (c.fabricatorCompany || '').toLowerCase().includes(s) ||
      (c.fabricatorName || '').toLowerCase().includes(s)
    );
  });

  return (
    <div className={`clp-root ${embedded ? 'clp-embedded' : 'clp-page'}`}>

      {/* ── Hero / Header ── */}
      {!embedded && <div className="clp-hero-bg" />}

      <div className={embedded ? 'clp-panel-header' : 'clp-page-header'}>
        <div className="clp-header-left">
          {sidebarToggle}
          <div className="clp-icon-wrap">
            <Clock size={embedded ? 18 : 22} />
          </div>
          <div>
            <h1 className="clp-title">Visitor Check-In Log</h1>
            <p className="clp-subtitle">
              Live tracking of clients and fabricators visiting the office
              {lastUpdated && (
                <span className="clp-updated"> · Updated {formatLastUpdated(lastUpdated)}</span>
              )}
            </p>
          </div>
        </div>

        <div className="clp-header-actions">
          <div className="clp-search-wrap">
            <Search size={14} className="clp-search-icon" />
            <input
              type="text"
              className="clp-search"
              placeholder="Search by name, phone..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            {searchTerm && (
              <button className="clp-search-clear" onClick={() => onSearchChange('')}>
                <X size={13} />
              </button>
            )}
          </div>
          {onExport && (
            <button className="clp-export-btn" onClick={onExport}>
              <Download size={14} />
              Export
            </button>
          )}
          <button
            className="clp-refresh-btn"
            onClick={onRefresh}
            disabled={refreshing || loading}
          >
            <RefreshCw size={14} className={refreshing ? 'clp-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div className="clp-stats">
        <div className="clp-stat">
          <div className="clp-stat-icon clp-stat-gold">
            <Users size={16} />
          </div>
          <div>
            <div className="clp-stat-val">{embedded ? checkIns.length : totalCount}</div>
            <div className="clp-stat-lbl">Total Visitors</div>
          </div>
        </div>
        <div className="clp-stat">
          <div className="clp-stat-icon clp-stat-green">
            <UserCheck size={16} />
          </div>
          <div>
            <div className="clp-stat-val">{todayCount}</div>
            <div className="clp-stat-lbl">Today's Visitors</div>
          </div>
        </div>
        <div className="clp-stat">
          <div className="clp-stat-icon clp-stat-blue">
            <Building2 size={16} />
          </div>
          <div>
            <div className="clp-stat-val">{withCompanyCount}</div>
            <div className="clp-stat-lbl">With Company</div>
          </div>
        </div>
      </div>

      {/* ── Table Card ── */}
      <div className="clp-table-card">
        {loading ? (
          <div className="clp-state-center">
            <Loader2 size={36} className="clp-spin clp-gold" />
            <p>Loading visitors...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="clp-state-center">
            <Calendar size={44} className="clp-empty-icon" />
            <h3>No visitors found</h3>
            <p>{searchTerm ? 'Try adjusting your search.' : 'No check-ins recorded yet.'}</p>
          </div>
        ) : (
          <div className="clp-table-scroll">
            <table className="clp-table">
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
                  <tr key={c._id} className={isToday(c.createdAt) ? 'clp-row-today' : ''}>
                    <td className="clp-td-time">
                      <div className="clp-date">{formatDate(c.createdAt)}</div>
                      <div className="clp-time">{formatTime(c.createdAt)}</div>
                      {isToday(c.createdAt) && <span className="clp-badge clp-badge-today">Today</span>}
                    </td>
                    <td>
                      <div className="clp-visitor-row">
                        <div
                          className="clp-avatar"
                          style={{
                            background: `linear-gradient(135deg, ${getAvatarColor(c.name)}, ${getAvatarColor(c.name)}99)`,
                          }}
                        >
                          {getInitials(c.name)}
                        </div>
                        <span className="clp-visitor-name">{c.name}</span>
                      </div>
                    </td>
                    <td>
                      {c.phone ? (
                        <div className="clp-icon-text">
                          <Phone size={12} /> {c.phone}
                        </div>
                      ) : (
                        <span className="clp-dash">—</span>
                      )}
                    </td>
                    <td>
                      {c.email ? (
                        <div className="clp-icon-text">
                          <Mail size={12} /> {c.email}
                        </div>
                      ) : (
                        <span className="clp-dash">—</span>
                      )}
                    </td>
                    <td>
                      {c.fabricatorCompany ? (
                        <span className="clp-badge clp-badge-company">{c.fabricatorCompany}</span>
                      ) : (
                        <span className="clp-dash">—</span>
                      )}
                    </td>
                    <td>
                      {c.fabricatorName ? (
                        <span className="clp-badge clp-badge-staff">{c.fabricatorName}</span>
                      ) : (
                        <span className="clp-badge clp-badge-none">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination (standalone only) ── */}
      {!embedded && totalPages > 1 && (
        <div className="clp-pagination">
          <button
            className="clp-page-btn"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft size={15} /> Prev
          </button>
          <span className="clp-page-info">
            Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
          </span>
          <button
            className="clp-page-btn"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
};

export default CheckInLogPanel;
