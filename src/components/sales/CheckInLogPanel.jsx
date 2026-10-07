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
 *  isExporting     – boolean  (disables the Export button and shows progress)
 *  sidebarToggle   – ReactNode | null  (sidebar menu button for CRM mode)
 *  embedded        – bool  (true = CRM panel mode, false = full-page mode)
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Download, Loader2, Calendar,
  Users, Building2, Phone, UserCheck, X, Eye, Edit2, Trash2, ClipboardList,
  Printer, Filter, Scan, Plus, MapPin,
  QrCode, Copy, Check, Smartphone, Settings, MoreHorizontal
} from 'lucide-react';
import { formatInstantTime } from '../../utils/dateUtils';
import { checkInMoment } from '../../utils/checkInClock';
import Pagination from '../shared/Pagination';
import { DEFAULT_ROWS_PER_PAGE } from '../shared/paginationConfig';
import { LocationField } from '../shared/LocationFilter';
import { accessibleLocations } from '../../utils/locationFilter';
import { useAuth } from '../../context/AuthContext';
import SelectionSheetForm, { SHEET_DRAFT_KEY } from './selectionSheet/SelectionSheetForm';
import './CheckInLogPanel.css';

/* ── helpers ──────────────────────────────────── */
// A check-in's date, time and "Today" are read on its own branch's clock
// (checkInMoment, src/utils/checkInClock.js) — the same day the list's month
// filter, the counts and the Daily Report put it on. A time from a branch in
// another zone than the viewer's carries its zone ("12:30 AM EDT").
const momentOf = (c) => checkInMoment(c.createdAt || c.date, c.location);
const timeLabel = (m) => (m.zone ? `${m.time} ${m.zone}` : m.time);

const formatLastUpdated = (d) =>
  d ? formatInstantTime(d, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

const getInitials = (name) =>
  name ? name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) : '?';

const AVATAR_COLORS = ['#d4af37', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];
const getAvatarColor = (name) => {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_SHORT_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const getLocationBadgeStyle = (location, theme) => {
  const loc = (location || '').toLowerCase();
  const isDark = theme === 'dark';
  
  if (loc.includes('seattle')) {
    return { color: isDark ? '#2dd4bf' : '#0f766e' };
  }
  if (loc.includes('spokane')) {
    return { color: isDark ? '#a78bfa' : '#6d28d9' };
  }
  if (loc.includes('salt lake') || loc.includes('slc') || loc.includes('lake')) {
    return { color: isDark ? '#fbbf24' : '#b45309' };
  }
  return { color: isDark ? '#94a3b8' : '#475569' };
};

/* ── component ────────────────────────────────── */
const CheckInLogPanel = ({
  checkIns = [],
  loading = false,
  onRefresh,
  searchTerm = '',
  onSearchChange,
  lastUpdated = null,
  todayCount: todayCountProp = null,
  monthCount = 0,
  allTimeCount = 0,
  totalCount,
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  rowsPerPage = DEFAULT_ROWS_PER_PAGE,
  onRowsPerPageChange = () => {},
  filterMonth = null,
  filterYear = null,
  onFilterMonthChange = () => {},
  onFilterYearChange = () => {},
  onExport,
  isExporting = false,
  sidebarToggle = null,
  embedded = false,
  onView = null,
  onEdit = null,
  onDelete = null,
  theme: themeProp = null,
  filterLocation = null,
  onFilterLocationChange = null,
  locations = [],
}) => {
  const { user } = useAuth();
  const hasEditPermission = !user || user.permissions?.includes('manage_checkins');
  const hasDeletePermission = !user || user.permissions?.includes('delete_checkins');
  const hasSendEmailPermission = !user || user.permissions?.includes('send_checkin_email');
  const hasMultipleLocations = user && (user.assignedLocations?.includes('*') || user.assignedLocations?.length > 1);
  // What the location filter offers: the branches this person is assigned
  // (every branch for '*') — the same set the check-in API scopes them to.
  const locationOptions = useMemo(() => accessibleLocations(user, locations), [user, locations]);
  // The Check-In button: locked to the branch being looked at; on "All" the
  // page opens on their home branch and still lets them switch. It used to
  // lock to their first assigned branch, which isn't always where they work.
  const checkInPageHref = filterLocation ? `/checkin?location=${encodeURIComponent(filterLocation)}` : '/checkin';
  const isAdmin = !user || user.role === 'admin' || user.role === 'Admin' || user.permissions?.includes('*') || user.permissions?.includes('admin');

  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  // Which desktop table row currently has its View/Edit/Delete icons expanded
  // (see the "⋯" toggle in the Actions column) — only one row open at a time.
  const [expandedActionsId, setExpandedActionsId] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrLocation, setQrLocation] = useState(filterLocation || 'Seattle');
  const [copiedNfcUrl, setCopiedNfcUrl] = useState(false);
  const [qrDomain, setQrDomain] = useState(() => (typeof window !== 'undefined' ? window.location.origin : ''));
  const [internalTheme, setInternalTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_theme');
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const theme = themeProp || internalTheme;

  

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const saved = localStorage.getItem('checkin_theme');
        setInternalTheme(saved === 'dark' ? 'dark' : 'light');
      } catch { /* not fatal — carry on */ }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('checkin_theme_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('checkin_theme_changed', handleStorageChange);
    };
  }, []);

  // ── Selection sheet (src/components/sales/selectionSheet/) ──
  // { checkIn, draft } while it's open. Unsaved work left by this same person
  // (they refreshed mid-edit) reopens on load; someone else's never does.
  const [sheet, setSheet] = useState(null);
  const draftOwner = user?._id || user?.username || 'anonymous';
  // Checked once per signed-in person, during render (not in an effect) so
  // the sheet is open on the very first paint after a refresh.
  const [draftCheckedFor, setDraftCheckedFor] = useState(null);
  if (draftCheckedFor !== draftOwner) {
    setDraftCheckedFor(draftOwner);
    try {
      const saved = JSON.parse(localStorage.getItem(SHEET_DRAFT_KEY) || 'null');
      if (saved?.checkIn && saved.values && saved.owner === draftOwner) setSheet({ checkIn: saved.checkIn, draft: saved });
    } catch { /* storage off or an old-format draft — start fresh */ }
  }
  const handleOpenSelectionModal = (checkIn) => setSheet({ checkIn, draft: null });
  const closeSheet = () => {
    setSheet(null);
    try { localStorage.removeItem(SHEET_DRAFT_KEY); } catch { /* not fatal */ }
  };

  // Use prop if provided (accurate from DB), else compute from loaded page
  const todayCount = useMemo(() => {
    if (todayCountProp !== null) return todayCountProp;
    return checkIns.filter((c) => momentOf(c).isToday).length;
  }, [checkIns, todayCountProp]);

  // Search is resolved server-side (across name, phone, fabricatorCompany and
  // fabricatorPhone) and already paginated. Re-filtering the page here used to
  // drop rows the server had legitimately matched — notably fabricatorPhone
  // hits, which this list never checked — leaving the result count disagreeing
  // with the visible rows.
  const filtered = checkIns;

  return (
    <div className={`clp-root ${embedded ? 'clp-embedded' : 'clp-page'} ${theme}-theme`}>

      {/* ── Hero / Header ── */}
      {!embedded && <div className="clp-hero-bg" />}

      <div className={embedded ? 'clp-panel-header' : 'clp-page-header'}>
        <div className="clp-header-left">
          <div className="clp-header-brand">
            {sidebarToggle}
            <div className="clp-title-wrap">
              <h1 className="clp-title">Visitor Check-In Log</h1>
              <p className="clp-subtitle">
                Live tracking of clients and fabricators visiting the office
                {lastUpdated && (
                  <span className="clp-updated"> · Updated {formatLastUpdated(lastUpdated)}</span>
                )}
              </p>
            </div>
          </div>

          <a
            href={
              checkInPageHref
            }
            target="_blank"
            rel="noopener noreferrer"
            className="clp-checkin-btn clp-mobile-tablet-checkin"
          >
            <Plus size={14} />
            <span>Check-In</span>
          </a>
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

          {/* Location, Year & Month Filters */}
          {onFilterMonthChange && onFilterYearChange && (
            <div className="clp-filter-container">
              <button
                type="button"
                className={`clp-filter-btn ${(filterMonth || filterYear || filterLocation) ? 'clp-filter-active' : ''}`}
                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                title={filterMonth && filterYear ? `Filters — ${MONTH_NAMES[filterMonth - 1]} ${filterYear}` : 'Filter Check-ins'}
                aria-label={filterMonth && filterYear ? `Filters, currently ${MONTH_NAMES[filterMonth - 1]} ${filterYear}` : 'Filter check-ins'}
              >
                <Filter size={14} />
                <span className="clp-filter-label">
                  {filterMonth && filterYear
                    ? `${MONTH_NAMES[filterMonth - 1]} ${filterYear}`
                    : 'Filters'}
                </span>
                {(filterMonth || filterYear || filterLocation) && (
                  <span className="clp-filter-dot" />
                )}
              </button>

              {showFilterDropdown && (
                <div className="clp-filter-popover">
                  <div className="clp-filter-popover-header">
                    <span>Filter Check-ins</span>
                    <button 
                      type="button" 
                      className="clp-filter-popover-close"
                      onClick={() => setShowFilterDropdown(false)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="clp-filter-popover-body">
                    {/* The shared location field (LocationFilter.jsx), offered
                        only when there's more than one branch to choose. */}
                    {onFilterLocationChange && locationOptions.length > 1 && (
                      <LocationField
                        options={locationOptions}
                        value={filterLocation || ''}
                        onChange={(val) => onFilterLocationChange(val || null)}
                        user={user}
                      />
                    )}

                    <div className="filter-select-group">
                      <label>Year</label>
                      <select
                        value={filterYear || ''}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : null;
                          onFilterYearChange(val);
                        }}
                        className="filter-dropdown-select"
                      >
                        {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>

                    <div className="filter-select-group">
                      <label>Month</label>
                      <div className="filter-months-grid">
                        {MONTH_SHORT_NAMES.map((m, idx) => {
                          const monthVal = idx + 1;
                          const isActive = filterMonth === monthVal;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                onFilterMonthChange(isActive ? null : monthVal);
                                // If activating a month but year is null, default to current year
                                if (!isActive && !filterYear) {
                                  onFilterYearChange(new Date().getFullYear());
                                }
                              }}
                              className={`filter-month-cell ${isActive ? 'active' : ''}`}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="clp-filter-popover-footer">
                    <button
                      type="button"
                      onClick={() => {
                        onFilterMonthChange(null);
                        onFilterYearChange(null);
                        if (onFilterLocationChange) onFilterLocationChange(null);
                        setShowFilterDropdown(false);
                      }}
                      className="filter-btn-clear"
                    >
                      Clear Filter
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFilterDropdown(false)}
                      className="filter-btn-apply"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="clp-qr-btn clp-desktop-checkin"
            onClick={() => setShowQrModal(true)}
            title="QR Code & NFC Self Check-In"
            aria-label="QR Code & NFC Self Check-In"
          >
            <QrCode size={14} />
            <span className="clp-qr-btn-label">QR / NFC Code</span>
          </button>

          <a
            href={
              checkInPageHref
            }
            target="_blank"
            rel="noopener noreferrer"
            className="clp-checkin-btn clp-desktop-checkin"
          >
            <Plus size={14} />
            <span>Check-In</span>
          </a>

          {onExport && (
            <button className="clp-export-btn" onClick={onExport} disabled={isExporting}>
              <Download size={14} />
              {isExporting ? 'Exporting…' : 'Export'}
            </button>
          )}
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div className="clp-stats">
        <div className="clp-stat">
          <div className="clp-stat-icon clp-stat-green">
            <UserCheck size={16} />
          </div>
          <div>
            <div className="clp-stat-val">{todayCount}</div>
            <div className="clp-stat-lbl">Today's Visitors</div>
          </div>
        </div>
        <div className="clp-stat-divider" />
        <div className="clp-stat">
          <div className="clp-stat-icon clp-stat-blue">
            <Calendar size={16} />
          </div>
          <div>
            <div className="clp-stat-val">{monthCount}</div>
            <div className="clp-stat-lbl">{new Date().toLocaleString('default', { month: 'long' })} Visitors</div>
          </div>
        </div>
        <div className="clp-stat-divider" />
        <div className="clp-stat">
          <div className="clp-stat-icon clp-stat-gold">
            <Users size={16} />
          </div>
          <div>
            <div className="clp-stat-val">{allTimeCount}</div>
            <div className="clp-stat-lbl">All-Time Visitors</div>
          </div>
        </div>
      </div>

      {/* ── Table Card ── (scrolling body + pager footer) */}
      <div className="clp-table-card">
        <div className="clp-table-body">
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
          <>
            {/* ── Laptop / Desktop View: Table ── */}
            <div className="clp-table-scroll clp-desktop-only">
              <table className="clp-table">
                <thead>
                  <tr>
                    <th className="clp-th">CHECK-IN TIME</th>
                    <th className="clp-th">VISITOR NAME</th>
                    <th className="clp-th clp-th-group-end">PHONE NUMBER</th>
                    <th className="clp-th">COMPANY/CONTACT NAME</th>
                    <th className="clp-th clp-th-group-end">CUSTOMER PHONE</th>
                    {hasMultipleLocations && <th className="clp-th clp-th-group-end">LOCATION</th>}
                    <th className="clp-th" style={{ textAlign: 'center' }}>
                      <span className="clp-th-actions">
                        <Settings size={13} />
                        ACTIONS
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const moment = momentOf(c);
                    const entryIsToday = moment.isToday;
                    return (
                      <tr key={c._id} className={entryIsToday ? 'clp-row-today' : ''}>
                        <td className="clp-td-time">
                          <div className="clp-date">{moment.date || '-'}</div>
                          <div className="clp-time">{timeLabel(moment)}</div>
                          {entryIsToday && <span className="clp-badge clp-badge-today">Today</span>}
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
                            <a href={`tel:${c.phone}`} className="clp-icon-text clp-phone-link">
                              <Phone size={12} /> {c.phone}
                            </a>
                          ) : (
                            <span className="clp-dash">—</span>
                          )}
                        </td>
                        <td>
                          {c.fabricatorCompany ? (
                            <div className="clp-company-row">
                              <div className="clp-company-icon">
                                <Building2 size={13} />
                              </div>
                              <span className="clp-company-name">{c.fabricatorCompany}</span>
                            </div>
                          ) : (
                            <span className="clp-dash">—</span>
                          )}
                        </td>
                        <td>
                          {c.fabricatorPhone ? (
                            <a href={`tel:${c.fabricatorPhone}`} className="clp-icon-text clp-phone-link">
                              <Phone size={12} /> {c.fabricatorPhone}
                            </a>
                          ) : (
                            <span className="clp-dash">—</span>
                          )}
                        </td>
                        {hasMultipleLocations && (
                          <td>
                            {c.location ? (
                              <span style={{
                                ...getLocationBadgeStyle(c.location, internalTheme || themeProp),
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '4px 10px',
                                borderRadius: '12px',
                                fontSize: '0.72rem',
                                fontWeight: '600',
                                letterSpacing: '0.02em',
                                textTransform: 'uppercase'
                              }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
                                {c.location}
                              </span>
                            ) : (
                              <span className="clp-dash">—</span>
                            )}
                          </td>
                        )}

                        <td>
                          <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', justifyContent: 'center' }}>
                            <button
                              onClick={() => handleOpenSelectionModal(c)}
                              title="Selection sheet"
                              style={{ background: 'transparent', border: 'none', color: '#10b981', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}
                            >
                              <ClipboardList size={15} />
                              {c.selections && c.selections.length > 0 && (
                                <span className="clp-csc-count-chip">{c.selections.length}</span>
                              )}
                            </button>
                            {(onView || (onEdit && hasEditPermission) || (onDelete && hasDeletePermission)) && (
                              expandedActionsId === c._id ? (
                                <>
                                  <span className="clp-actions-divider" />
                                  {onView && (
                                    <button
                                      onClick={() => { onView(c); setExpandedActionsId(null); }}
                                      title="View details"
                                      style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                                    >
                                      <Eye size={15} />
                                    </button>
                                  )}
                                  {onEdit && hasEditPermission && (
                                    <button
                                      onClick={() => { onEdit(c); setExpandedActionsId(null); }}
                                      title="Edit check-in"
                                      style={{ background: 'transparent', border: 'none', color: '#d4af37', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                                    >
                                      <Edit2 size={15} />
                                    </button>
                                  )}
                                  {onDelete && hasDeletePermission && (
                                    <button
                                      onClick={() => { onDelete(c); setExpandedActionsId(null); }}
                                      title="Delete check-in"
                                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setExpandedActionsId(null)}
                                    title="Collapse"
                                    aria-label="Collapse actions"
                                    className="clp-actions-collapse-btn"
                                  >
                                    <X size={13} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => setExpandedActionsId(c._id)}
                                  title="More actions"
                                  aria-label="More actions"
                                  className="clp-actions-toggle-btn"
                                >
                                  <MoreHorizontal size={15} />
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Mobile & iPad View: Cards Grid ── */}
            <div className="clp-cards-grid clp-mobile-only">
              {filtered.map((c) => {
                const moment = momentOf(c);
                const entryIsToday = moment.isToday;
                return (
                  <div key={c._id} className={`clp-customer-style-card ${entryIsToday ? 'clp-row-today' : ''}`}>
                    {/* Top Row: Visitor Name & Phone (Left) + Status Date Pill & Location (Right) */}
                    <div className="clp-csc-top-row">
                      <div className="clp-csc-left-info">
                        <h3 className="clp-csc-title">{c.name}</h3>
                        {c.phone && (
                          <a href={`tel:${c.phone}`} className="clp-csc-badge-pill gold-outline">
                            <Phone size={11} /> {c.phone}
                          </a>
                        )}
                      </div>
                      <div className="clp-csc-right-meta">
                        <span className={`clp-csc-status-badge ${entryIsToday ? 'today' : ''}`}>
                          {entryIsToday && <span className="clp-live-pulse-dot" />}
                          {entryIsToday ? `TODAY • ${timeLabel(moment)}` : (moment.date || '-')}
                        </span>
                        {hasMultipleLocations && c.location && (
                          <span className="clp-csc-badge-pill location-pill" style={getLocationBadgeStyle(c.location, internalTheme || themeProp)}>
                            <MapPin size={11} /> {c.location}
                          </span>
                        )}
                      </div>
                    </div>

                  {/* Dashed Separator */}
                  <div className="clp-csc-dashed-divider" />

                  {/* Key-Value Details Block */}
                  <div className="clp-csc-details-grid">
                    <div className="clp-csc-detail-row">
                      <span className="clp-csc-label">Contact / Company:</span>
                      <span className="clp-csc-value bold-white">{c.fabricatorCompany || '—'}</span>
                    </div>
                    <div className="clp-csc-detail-row">
                      <span className="clp-csc-label">Customer Phone:</span>
                      <span className="clp-csc-value">
                        {c.fabricatorPhone ? (
                          <a href={`tel:${c.fabricatorPhone}`} className="clp-csc-phone-link">
                            {c.fabricatorPhone}
                          </a>
                        ) : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Solid Separator */}
                  <div className="clp-csc-solid-divider" />

                  {/* Bottom Action Row */}
                  <div className="clp-csc-actions-row">
                    <div className="clp-csc-actions-left">
                      <button
                        onClick={() => handleOpenSelectionModal(c)}
                        className="clp-csc-btn btn-selection"
                        title="Selection sheet"
                      >
                        <ClipboardList size={14} />
                        <span>Selection Sheet</span>
                        {c.selections && c.selections.length > 0 && (
                          <span className="clp-csc-count-chip">{c.selections.length}</span>
                        )}
                      </button>
                    </div>
                    <div className="clp-csc-actions-right">
                      {onView && (
                        <button
                          onClick={() => onView(c)}
                          className="clp-csc-btn icon-only btn-view"
                          title="View details"
                        >
                          <Eye size={14} />
                        </button>
                      )}
                      {onEdit && hasEditPermission && (
                        <button
                          onClick={() => onEdit(c)}
                          className="clp-csc-btn icon-only btn-edit"
                          title="Edit check-in"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                      {onDelete && hasDeletePermission && (
                        <button
                          onClick={() => onDelete(c)}
                          className="clp-csc-btn icon-only btn-delete"
                          title="Delete check-in"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}
        </div>

        {/* ── Pagination ── the table card's footer, the way the Customer
            List's pager sits at the foot of its table; outside the scrolling
            body so it stays in view. */}
        {totalPages >= 1 && (
          <div className="clp-pag-bar">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={onPageChange}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={onRowsPerPageChange}
              totalCount={totalCount}
            />
          </div>
        )}
      </div>

      {sheet && (
        <SelectionSheetForm
          key={sheet.checkIn._id}
          checkIn={sheet.checkIn}
          draft={sheet.draft}
          owner={draftOwner}
          locations={locations}
          canEdit={hasEditPermission}
          canEmail={hasSendEmailPermission}
          onClose={closeSheet}
          onSaved={() => onRefresh?.()}
        />
      )}

      {/* ── QR Code & NFC Generator Modal ── */}
      {showQrModal && (
        <div className="selection-modal-overlay" onClick={() => setShowQrModal(false)}>
          <div className="selection-modal-container clp-qr-modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="selection-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <QrCode size={20} style={{ color: '#d4af37' }} />
                <h2 className="selection-modal-header-title">QR Code & NFC Showroom Check-In</h2>
              </div>
              <button className="selection-modal-close" onClick={() => setShowQrModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="selection-modal-form clp-qr-modal-body">
              {/* Branch Office Location & Domain Selector */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="clp-qr-location-selector">
                  <label className="clp-qr-label">
                    Showroom Branch Location:
                  </label>
                  <select
                    value={qrLocation}
                    onChange={(e) => setQrLocation(e.target.value)}
                    className="clp-qr-select"
                  >
                    {locations.length > 0 ? (
                      locations.map(loc => (
                        <option key={loc._id || loc.name} value={loc.name}>📍 {loc.name} Office</option>
                      ))
                    ) : (
                      <>
                        <option value="Seattle">📍 Seattle Office</option>
                        <option value="Spokane">📍 Spokane Office</option>
                        <option value="Salt Lake City">📍 Salt Lake City Office</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="clp-qr-location-selector">
                  <label className="clp-qr-label">
                    Target Domain URL {!isAdmin && <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic' }}>(Admin only)</span>}:
                  </label>
                  <input
                    type="text"
                    value={qrDomain}
                    onChange={(e) => isAdmin && setQrDomain(e.target.value)}
                    readOnly={!isAdmin}
                    disabled={!isAdmin}
                    placeholder={window.location.origin}
                    className="clp-qr-select"
                    style={!isAdmin ? { opacity: 0.75, cursor: 'not-allowed' } : {}}
                  />
                </div>
              </div>

              {/* Dynamic QR Code Display */}
              <div className="clp-qr-preview-card">
                <a
                  href={`/self-checkin?location=${encodeURIComponent(qrLocation)}&mode=qr`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="clp-qr-code-wrapper"
                  title="Click to open and test self check-in for this location"
                >
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`${qrDomain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qrLocation)}&mode=qr`)}`}
                    alt={`QR Code for ${qrLocation}`}
                    className="clp-qr-image"
                  />
                </a>
                <div className="clp-qr-info">
                  <h4>{qrLocation} Showroom Self Check-In</h4>
                  <p>Customers can scan this QR code or tap an NFC tag to open the check-in form directly on their mobile phones.</p>
                  <p style={{ marginTop: '8px', fontSize: '0.78rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span>🔗 URL: <code>{`${qrDomain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qrLocation)}`}</code></span>
                    <a
                      href={`/self-checkin?location=${encodeURIComponent(qrLocation)}&mode=qr`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textDecoration: 'underline', color: '#d4af37', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      [ Test Link ↗ ]
                    </a>
                  </p>
                </div>
              </div>

              {/* NFC Link Section */}
              <div className="clp-nfc-card">
                <div className="clp-nfc-header">
                  <Smartphone size={16} style={{ color: '#10b981' }} />
                  <strong>NFC Tag URL (1-Click Copy for Tag Writer):</strong>
                </div>
                <div className="clp-nfc-url-row">
                  <input
                    type="text"
                    readOnly
                    value={`${qrDomain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qrLocation)}&mode=nfc`}
                    className="clp-nfc-input"
                  />
                  <button
                    type="button"
                    className="clp-nfc-copy-btn"
                    onClick={() => {
                      const url = `${qrDomain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qrLocation)}&mode=nfc`;
                      navigator.clipboard.writeText(url);
                      setCopiedNfcUrl(true);
                      setTimeout(() => setCopiedNfcUrl(false), 2000);
                    }}
                  >
                    {copiedNfcUrl ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedNfcUrl ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
                <p className="clp-nfc-hint">
                  💡 Tip: Use any free app like <strong>NFC Tools</strong> on iPhone/Android to write this URL to a $0.50 NFC NTAG215 sticker for instant tap-to-check-in on front desk counters.
                </p>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="selection-modal-actions" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="clp-qr-btn-print"
                onClick={() => {
                  const printUrl = `${qrDomain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qrLocation)}&mode=qr`;
                  const printWin = window.open('', '_blank');
                  printWin.document.write(`
                    <html>
                      <head>
                        <title>Easy Stones Check-In Poster - ${qrLocation}</title>
                        <style>
                          body { font-family: system-ui, sans-serif; text-align: center; padding: 40px; color: #0f172a; }
                          .poster { max-width: 500px; margin: 0 auto; border: 2px solid #d4af37; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
                          h1 { color: #b48a1c; font-size: 28px; margin-bottom: 5px; }
                          h2 { color: #334155; font-size: 20px; font-weight: 500; margin-top: 0; }
                          .qr-img { width: 220px; height: 220px; margin: 20px 0; border: 4px solid #f1f5f9; padding: 10px; border-radius: 12px; }
                          .instructions { font-size: 16px; color: #475569; margin-top: 15px; }
                          .badge { display: inline-block; background: #fef3c7; color: #b48a1c; padding: 6px 16px; border-radius: 20px; font-weight: 700; margin-bottom: 20px; }
                        </style>
                      </head>
                      <body>
                        <div class="poster">
                          <div class="badge">EASY STONES • ${qrLocation.toUpperCase()} SHOWROOM</div>
                          <h1>Welcome! Visitor Check-In</h1>
                          <h2>Please Scan QR Code or Tap NFC to Check In</h2>
                          <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(printUrl)}" class="qr-img" />
                          <p class="instructions">📱 Open Phone Camera to Scan<br>⚡ Or Tap Phone Here for NFC Check-In</p>
                        </div>
                        <script>window.onload = () => { window.print(); };</script>
                      </body>
                    </html>
                  `);
                  printWin.document.close();
                }}
              >
                <Printer size={15} /> Print Showroom Poster
              </button>
              <button type="button" className="clp-qr-btn-close" onClick={() => setShowQrModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CheckInLogPanel;
