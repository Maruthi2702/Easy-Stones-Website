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
 *  onExport        – () => void  (if provided, shows the More menu: View as PDF,
 *                    Download as PDF, Download as Excel — this is the Excel one)
 *  isExporting     – boolean  (the Excel download is being prepared)
 *  exportFilters   – { search, month, year, location } the PDFs are made for
 *  sidebarToggle   – ReactNode | null  (sidebar menu button for CRM mode)
 *  embedded        – bool  (true = CRM panel mode, false = full-page mode)
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Search, Loader2, Calendar, X, Plus } from 'lucide-react';
import Pagination from '../../../components/shared/Pagination';
import { DEFAULT_ROWS_PER_PAGE } from '../../../components/shared/paginationConfig';
import { accessibleLocations } from '../../../utils/locationFilter';
import { useAuth } from '../../../context/AuthContext';
import {
  canCheckIn, canSeeCheckInQr, canEditCheckInDetails, canDeleteCheckIn, canEditSelectionSheet, canEmailSelectionSheet
} from '../../../utils/checkInAccess.js';
import SelectionSheetForm, { SHEET_DRAFT_KEY } from '../selectionSheet/SelectionSheetForm';
import type { Loose } from '../../../types/records';
import { momentOf, formatLastUpdated } from './logFormat';
import CheckInFilters from './CheckInFilters';
import CheckInMoreMenu from './CheckInMoreMenu';
import CheckInStats from './CheckInStats';
import CheckInTable from './CheckInTable';
import CheckInCards from './CheckInCards';
import QrCodesModal from './QrCodesModal';
import { useQrCodes } from './useQrCodes';
import './CheckInLogPanel.css';

type RowHandler = ((checkIn: Loose) => void) | null;

export type CheckInLogPanelProps = {
  checkIns?: Loose[];
  loading?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  searchTerm?: string;
  onSearchChange: (value: string) => void;
  lastUpdated?: Date | string | number | null;
  todayCount?: number | null;
  monthCount?: number;
  allTimeCount?: number;
  totalCount?: number;
  currentPage?: number;
  totalPages?: number;
  onPageChange: (page: number) => void;
  rowsPerPage?: number;
  onRowsPerPageChange?: (rows: number) => void;
  filterMonth?: number | null;
  filterYear?: number | null;
  onFilterMonthChange?: ((month: number | null) => void) | null;
  onFilterYearChange?: ((year: number | null) => void) | null;
  onExport?: (() => void) | null;
  isExporting?: boolean;
  exportFilters?: Record<string, unknown>;
  sidebarToggle?: React.ReactNode;
  embedded?: boolean;
  onView?: RowHandler;
  onEdit?: RowHandler;
  onDelete?: RowHandler;
  theme?: string | null;
  filterLocation?: string | null;
  onFilterLocationChange?: ((location: string | null) => void) | null;
  locations?: unknown[];
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
  exportFilters = {},
  sidebarToggle = null,
  embedded = false,
  onView = null,
  onEdit = null,
  onDelete = null,
  theme: themeProp = null,
  filterLocation = null,
  onFilterLocationChange = null,
  locations = [],
}: CheckInLogPanelProps) => {
  const { user } = useAuth();
  // Users & Roles → Check In (src/utils/checkInAccess.js), the same rules the API checks.
  const hasEditPermission = canEditCheckInDetails(user);
  const hasDeletePermission = canDeleteCheckIn(user);
  const canEditSheet = canEditSelectionSheet(user);
  const hasSendEmailPermission = canEmailSelectionSheet(user);
  const showCheckInButton = canCheckIn(user);
  const hasMultipleLocations = user && (user.assignedLocations?.includes('*') || (user.assignedLocations?.length ?? 0) > 1);
  // What the location filter offers: the branches this person is assigned
  // (every branch for '*') — the same set the check-in API scopes them to.
  const locationOptions = useMemo(() => accessibleLocations(user, locations), [user, locations]);
  // The Check-In button: locked to the branch being looked at; on "All" the
  // page opens on their home branch and still lets them switch. It used to
  // lock to their first assigned branch, which isn't always where they work.
  const checkInPageHref = filterLocation ? `/checkin?location=${encodeURIComponent(filterLocation)}` : '/checkin';
  const isAdmin = !user || user.role === 'admin' || user.role === 'Admin' || user.permissions?.includes('*') || user.permissions?.includes('admin');
  // The QR / NFC self check-in codes: a Users & Roles permission (2026-10-08),
  // and nothing else — the admin role holds it like any other switch.
  const canSeeQrCodes = canSeeCheckInQr(user);

  // Which desktop table row currently has its View/Edit/Delete icons expanded
  // (see the "⋯" toggle in the Actions column) — only one row open at a time.
  const [expandedActionsId, setExpandedActionsId] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const qr = useQrCodes(filterLocation);
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
  const [sheet, setSheet] = useState<{ checkIn: Loose; draft: Loose | null } | null>(null);
  const draftOwner = user?._id || user?.username || 'anonymous';
  // Checked once per signed-in person, during render (not in an effect) so
  // the sheet is open on the very first paint after a refresh.
  const [draftCheckedFor, setDraftCheckedFor] = useState<string | null>(null);
  if (draftCheckedFor !== draftOwner) {
    setDraftCheckedFor(draftOwner);
    try {
      const saved = JSON.parse(localStorage.getItem(SHEET_DRAFT_KEY) || 'null');
      if (saved?.checkIn && saved.values && saved.owner === draftOwner) setSheet({ checkIn: saved.checkIn, draft: saved });
    } catch { /* storage off or an old-format draft — start fresh */ }
  }
  const handleOpenSelectionModal = (checkIn: Loose) => setSheet({ checkIn, draft: null });
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

          {showCheckInButton && (
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
          )}
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
            <CheckInFilters
              filterMonth={filterMonth}
              filterYear={filterYear}
              filterLocation={filterLocation}
              onFilterMonthChange={onFilterMonthChange}
              onFilterYearChange={onFilterYearChange}
              onFilterLocationChange={onFilterLocationChange}
              locationOptions={locationOptions}
              user={user}
            />
          )}

          {showCheckInButton && (
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
          )}

          {(onExport || canSeeQrCodes) && (
            <CheckInMoreMenu
              onExport={onExport}
              isExporting={isExporting}
              exportFilters={exportFilters}
              canSeeQrCodes={canSeeQrCodes}
              onOpenQr={() => setShowQrModal(true)}
            />
          )}
        </div>
      </div>

      {/* ── Stats Row ── */}
      <CheckInStats todayCount={todayCount} monthCount={monthCount} allTimeCount={allTimeCount} />

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
            <CheckInTable
              rows={filtered}
              hasMultipleLocations={Boolean(hasMultipleLocations)}
              badgeTheme={internalTheme || themeProp}
              onOpenSheet={handleOpenSelectionModal}
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
              hasEditPermission={hasEditPermission}
              hasDeletePermission={hasDeletePermission}
              expandedActionsId={expandedActionsId}
              setExpandedActionsId={setExpandedActionsId}
            />

            {/* ── Mobile & iPad View: Cards Grid ── */}
            <CheckInCards
              rows={filtered}
              hasMultipleLocations={Boolean(hasMultipleLocations)}
              badgeTheme={internalTheme || themeProp}
              onOpenSheet={handleOpenSelectionModal}
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
              hasEditPermission={hasEditPermission}
              hasDeletePermission={hasDeletePermission}
            />
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
          canEdit={canEditSheet}
          canEmail={hasSendEmailPermission}
          onClose={closeSheet}
          onSaved={() => onRefresh?.()}
        />
      )}

      {/* ── QR Code & NFC Generator Modal ── */}
      {showQrModal && (
        <QrCodesModal qr={qr} locations={locations} user={user} isAdmin={Boolean(isAdmin)} onClose={() => setShowQrModal(false)} />
      )}
    </div>
  );
};

export default CheckInLogPanel;