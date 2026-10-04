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
  Clock, Search, Download, Loader2, Calendar,
  Users, Building2, Phone, Mail, UserCheck, X, Eye, Edit2, Trash2, ClipboardList,
  Save, AlertTriangle, Printer, Sun, Moon, Filter, Scan, Plus, MapPin,
  QrCode, Copy, Check, Smartphone, Settings, MoreHorizontal
} from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { formatTitleCase } from '../../utils/textUtils';
import { formatInstant, formatInstantTime } from '../../utils/dateUtils';
import Pagination from '../shared/Pagination';
import { DEFAULT_ROWS_PER_PAGE } from '../shared/paginationConfig';
import { LocationField } from '../shared/LocationFilter';
import { accessibleLocations } from '../../utils/locationFilter';
import { useAuth } from '../../context/AuthContext';
import {
  ORIENTATIONS, readStoneLabel, resolveLabelRead, scoreLabelRead, isUsableRead, isConfidentRead,
} from '../../utils/stoneLabel';
import './CheckInLogPanel.css';

/* ── helpers ──────────────────────────────────── */
// Every date shown here is a check-in's createdAt — a real moment, not a calendar
// date — so these read through the shared instant helpers and render in the
// viewer's own zone. This panel used to carry its own copies of them.
const formatDate = (ts) => formatInstant(ts);

const formatTime = (ts) => formatInstantTime(ts);

const formatLastUpdated = (d) =>
  d ? formatInstantTime(d, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

const isToday = (ts) => {
  if (!ts) return false;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return false;
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

const preprocessImage = (file, degrees = 0) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Resize: cap at 1600px for speed and phone memory. The crop starts on
        // the whole photo, so a smaller cap shrinks tag text below what OCR reads.
        const MAX_DIM = 1600;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        // Adjust dimensions based on rotation angle
        if (degrees === 90 || degrees === 270) {
          canvas.width = height;
          canvas.height = width;
        } else {
          canvas.width = width;
          canvas.height = height;
        }

        // Apply rotation matrix
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(img, -width / 2, -height / 2, width, height);

        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.9);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getCroppedImageBlob = (file, cropXPercent, cropYPercent, cropWidthPercent, cropHeightPercent) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const origWidth = img.width;
        const origHeight = img.height;

        const left = Math.round((cropXPercent / 100) * origWidth);
        const top = Math.round((cropYPercent / 100) * origHeight);
        const width = Math.round((cropWidthPercent / 100) * origWidth);
        const height = Math.round((cropHeightPercent / 100) * origHeight);

        const safeLeft = Math.max(0, Math.min(left, origWidth - 1));
        const safeTop = Math.max(0, Math.min(top, origHeight - 1));
        const safeWidth = Math.max(1, Math.min(width, origWidth - safeLeft));
        const safeHeight = Math.max(1, Math.min(height, origHeight - safeTop));

        canvas.width = safeWidth;
        canvas.height = safeHeight;

        ctx.drawImage(img, safeLeft, safeTop, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);

        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.95);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/* ── selection sheet helpers ──────────────────── */
const SHEET_ROWS = 12;
const ROW_FIELDS = ['material', 'lot', 'details', 'size'];
const emptyRow = () => ({ material: '', details: '', size: '', lot: '' });
// A row is kept on save if *any* field is filled — saving used to drop every
// row without a material, taking a typed lot or slab numbers with it.
const rowHasData = (row) => ROW_FIELDS.some((k) => String(row?.[k] || '').trim());

// The print window is written with document.write in our own origin, and the
// customer name/company come from the public self-check-in kiosk — unescaped,
// a crafted name ran as script in the staff member's logged-in session.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// What a save would send, normalized so two snapshots compare field by field.
const sheetValues = ({ builderName, builderPhone, salesRep, selections, specialNotes }) => ({
  builderName: builderName || '',
  builderPhone: builderPhone || '',
  salesRep: salesRep || '',
  specialNotes: specialNotes || '',
  rows: selections.filter(rowHasData).map((r) => ROW_FIELDS.map((k) => String(r[k] || '').trim())),
});

// How many fields differ — the number the unsaved-changes check reports.
const countSheetChanges = (a, b) => {
  if (!a || !b) return 0;
  let n = ['builderName', 'builderPhone', 'salesRep', 'specialNotes'].filter((k) => a[k] !== b[k]).length;
  for (let i = 0; i < Math.max(a.rows.length, b.rows.length); i++) {
    n += ROW_FIELDS.filter((_, f) => (a.rows[i]?.[f] || '') !== (b.rows[i]?.[f] || '')).length;
  }
  return n;
};

const DRAFT_KEY = 'active_selection_sheet';

// Result of the last tag scan, under the row it filled.
const ScanNotice = ({ notice, onDismiss }) => (
  <div className={`sel-scan-notice sel-scan-notice-${notice.tone}`} role="status">
    {notice.tone === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />}
    <div className="sel-scan-notice-text">
      {notice.lines.map((line) => <div key={line}>{line}</div>)}
    </div>
    <button type="button" className="sel-scan-notice-close" onClick={onDismiss} title="Dismiss">
      <X size={12} />
    </button>
  </div>
);

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

  // ── Selection Sheet State ──
  const [selectedCheckIn, setSelectedCheckIn] = useState(null);
  const [builderName, setBuilderName] = useState('');
  const [builderPhone, setBuilderPhone] = useState('');
  const [salesRep, setSalesRep] = useState('');
  const [selections, setSelections] = useState(
    Array.from({ length: 6 }, () => ({ material: '', details: '', size: '', lot: '' }))
  );
  const [specialNotes, setSpecialNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [productList, setProductList] = useState([]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [salesReps, setSalesReps] = useState([]);
  const [salesRepEmail, setSalesRepEmail] = useState('');
  const [activeDropdownIndex, setActiveDropdownIndex] = useState(null);
  const [, setSelMobileTab] = useState('customer'); // 'customer' | 'selections' | 'notes'
  const [mobItemCount, setMobItemCount] = useState(2); // how many item cards to show on mobile (default 2)
  const [desktopRowCount, setDesktopRowCount] = useState(4); // how many table rows to show on desktop (default 4)
  const [showSalesRepDropdown, setShowSalesRepDropdown] = useState(false);

  // ── OCR Tag Scanning State ──
  const [scanningIndex, setScanningIndex] = useState(null);
  const [scanningProgress, setScanningProgress] = useState(0);
  // What the last scan did, shown under that row: { idx, tone: 'ok'|'warn'|'error', lines }
  const [scanNotice, setScanNotice] = useState(null);

  // ── Tag Cropper State ──
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState('');
  const [cropBox, setCropBox] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [cropTargetIndex, setCropTargetIndex] = useState(null);
  const [cropFile, setCropFile] = useState(null);

  // ── Unsaved-changes check ──
  // sheetBaseline is what was last loaded or saved; the sheet is "dirty" when
  // what's on screen differs from it.
  const [sheetBaseline, setSheetBaseline] = useState(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const currentSheetValues = useMemo(
    () => sheetValues({ builderName, builderPhone, salesRep, selections, specialNotes }),
    [builderName, builderPhone, salesRep, selections, specialNotes]
  );
  const sheetChangeCount = countSheetChanges(sheetBaseline, currentSheetValues);
  const sheetReadOnly = !hasEditPermission;

  // An open sheet survives a page refresh, but only for the person who had it
  // open — on a shared showroom computer it used to reopen for whoever logged
  // in next.
  const draftOwner = user?._id || user?.username || 'anonymous';
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!parsed?.checkIn || parsed.owner !== draftOwner) return;
      setSelectedCheckIn(parsed.checkIn);
      setBuilderName(parsed.builderName || '');
      setBuilderPhone(parsed.builderPhone || '');
      setSalesRep(parsed.salesRep || '');
      setSalesRepEmail(parsed.salesRepEmail || '');
      const rows = Array.isArray(parsed.selections) ? parsed.selections : [];
      setSelections(Array.from({ length: SHEET_ROWS }, (_, i) => ({ ...emptyRow(), ...rows[i] })));
      const filled = rows.filter(rowHasData).length;
      setDesktopRowCount(Math.max(4, Math.min(SHEET_ROWS, filled)));
      setMobItemCount(Math.max(2, Math.min(SHEET_ROWS, filled)));
      setSpecialNotes(parsed.specialNotes || '');
      setSheetBaseline(parsed.baseline || null);
    } catch (e) {
      console.error('Failed to load active selection sheet from localStorage:', e);
    }
  }, [draftOwner]);

  // Keep the open sheet's draft current. Cleared by closeSheet, not here — an
  // effect that cleared it whenever no sheet was open wiped the draft on the
  // first render, before the restore above had run.
  useEffect(() => {
    if (!selectedCheckIn) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        owner: draftOwner,
        checkIn: selectedCheckIn,
        builderName,
        builderPhone,
        salesRep,
        salesRepEmail,
        selections,
        specialNotes,
        baseline: sheetBaseline,
      }));
    } catch (e) {
      console.error('Failed to save active selection sheet state to localStorage:', e);
    }
  }, [draftOwner, selectedCheckIn, builderName, builderPhone, salesRep, salesRepEmail, selections, specialNotes, sheetBaseline]);

  // Product and sales-rep suggestions: loaded the first time a sheet opens,
  // not on every open — /api/products is the whole catalog with its bundles.
  const sheetOpen = Boolean(selectedCheckIn);
  useEffect(() => {
    if (!sheetOpen || productList.length) return;
    authFetch(`${API_URL}/api/products`)
      .then(res => res.json())
      .then(data => setProductList(Array.isArray(data) ? data : (data.data || [])))
      .catch(err => console.error('Error fetching products:', err));
  }, [sheetOpen, productList.length]);
  useEffect(() => {
    if (!sheetOpen || salesReps.length) return;
    authFetch(`${API_URL}/api/salesreps`)
      .then(res => res.json())
      .then(data => setSalesReps(data.success ? data.data : (Array.isArray(data) ? data : [])))
      .catch(err => console.error('Error fetching sales reps:', err));
  }, [sheetOpen, salesReps.length]);

  // Sales reps offered for this check-in's branch, filtered by what's typed.
  const salesRepSuggestions = useMemo(() => {
    const typed = salesRep.trim().toLowerCase();
    const branch = selectedCheckIn?.location;
    return salesReps.filter(rep => {
      const role = (rep.role || '').toLowerCase();
      if (rep.role && !['sales', 'manager', 'director', 'admin'].some(r => role.includes(r))) return false;
      if (branch && rep.location !== branch &&
          !rep.assignedLocations?.includes(branch) &&
          !rep.assignedLocations?.includes('*')) return false;
      if (!typed) return true;
      return (rep.name || '').toLowerCase().includes(typed) ||
             (rep.username || '').toLowerCase().includes(typed);
    }).slice(0, 10);
  }, [salesReps, salesRep, selectedCheckIn?.location]);

  const closeSheet = () => {
    setSelectedCheckIn(null);
    setSheetBaseline(null);
    setShowDiscardConfirm(false);
    setScanNotice(null);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* not fatal — carry on */ }
  };

  // ✕ / Esc: ask first if anything changed (FORM_TEMPLATE.md's unsaved-changes check).
  const requestCloseSheet = () => {
    if (!sheetReadOnly && sheetChangeCount > 0) setShowDiscardConfirm(true);
    else closeSheet();
  };

  // Esc closes the sheet (with the unsaved-changes check); inside the discard
  // prompt it means "Keep editing". Popups layered on top handle their own.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || cropperOpen || showEmailModal) return;
      if (showDiscardConfirm) setShowDiscardConfirm(false);
      else requestCloseSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Enter in an autocomplete field closes its list instead of submitting the
  // form — it used to save and close the whole sheet mid-typing.
  const handleAutocompleteKeyDown = (e, close) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      close();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  const handlePrintPDF = () => {
    if (!selectedCheckIn) return;

    const dateStr = formatDate(selectedCheckIn.createdAt);
    const validSelections = selections.filter(rowHasData);

    let selectionsRowsHtml = '';
    if (validSelections.length === 0) {
      selectionsRowsHtml = `
        <tr>
          <td colspan="5" style="padding: 12px 10px; text-align: center; color: #666; font-style: italic;">No selections registered.</td>
        </tr>
      `;
    } else {
      validSelections.forEach((sel, idx) => {
        selectionsRowsHtml += `
          <tr style="border-bottom: 1px solid #eaeaea;">
            <td style="padding: 10px; text-align: center; color: #d4af37; font-weight: bold;">${idx + 1}</td>
            <td style="padding: 10px; color: #222; font-weight: 500;">${escapeHtml(sel.material) || 'N/A'}</td>
            <td style="padding: 10px; color: #555;">${escapeHtml(sel.lot) || 'N/A'}</td>
            <td style="padding: 10px; color: #555;">${escapeHtml(sel.details) || 'N/A'}</td>
            <td style="padding: 10px; color: #555;">${escapeHtml(sel.size) || 'N/A'}</td>
          </tr>
        `;
      });
    }

    const printWindow = window.open('', '_blank', 'width=800,height=800');
    if (!printWindow) {
      alert('Your browser blocked the print window. Allow pop-ups for this site, then try again.');
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Selection Sheet - ${escapeHtml(selectedCheckIn.name)}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #333;
              margin: 40px;
              padding: 0;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid #d4af37;
              padding-bottom: 15px;
              margin-bottom: 30px;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
              font-weight: 800;
              letter-spacing: 1px;
            }
            .header p {
              margin: 5px 0 0 0;
              color: #666;
              font-size: 13px;
            }
            .title {
              text-align: center;
              font-size: 16px;
              font-weight: bold;
              letter-spacing: 1px;
              color: #d4af37;
              text-transform: uppercase;
              margin-bottom: 25px;
            }
            .details-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 15px;
              background: #fff;
              border: 1px solid #eaeaea;
              border-radius: 12px;
              padding: 20px;
              margin-bottom: 30px;
            }
            .detail-item {
              font-size: 14px;
            }
            .detail-label {
              font-weight: bold;
              color: #555;
            }
            .detail-value {
              color: #222;
            }
            .section-title {
              font-size: 14px;
              margin: 20px 0 12px 0;
              color: #111;
              border-left: 3px solid #d4af37;
              padding-left: 8px;
              text-transform: uppercase;
              font-weight: bold;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 30px;
              font-size: 13px;
            }
            th {
              background: #f1f5f9;
              border-bottom: 2px solid #e2e8f0;
              padding: 10px;
              text-align: left;
              color: #475569;
              font-weight: bold;
            }
            td {
              padding: 10px;
              border-bottom: 1px solid #eaeaea;
            }
            .notes {
              background: #fff;
              border: 1px solid #eaeaea;
              border-radius: 12px;
              padding: 15px;
              margin-bottom: 30px;
              font-size: 13px;
            }
            .notes h4 {
              margin: 0 0 8px 0;
              color: #475569;
            }
            .notes p {
              margin: 0;
              color: #334155;
              white-space: pre-wrap;
              line-height: 1.5;
            }
            .policy-box {
              background: #fef2f2;
              border: 1px dashed #fca5a5;
              border-radius: 12px;
              padding: 15px;
              margin-bottom: 40px;
              font-size: 12px;
              color: #ef4444;
              line-height: 1.5;
            }
            .footer {
              text-align: center;
              font-size: 11px;
              color: #888;
              margin-top: 30px;
            }
            @media print {
              body {
                margin: 20px;
              }
              .policy-box {
                background: #fff !important;
                border: 1px dashed #ef4444 !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>EASY STONES</h1>
            <p>6012 S 196th St, Kent, WA 98032</p>
          </div>
          
          <div class="title">Customer Visit / Stone Selection</div>
          
          <div class="details-grid">
            <div class="detail-item"><span class="detail-label">Date:</span> <span class="detail-value">${escapeHtml(dateStr)}</span></div>
            <div class="detail-item"><span class="detail-label">Customer Name:</span> <span class="detail-value">${escapeHtml(selectedCheckIn.name)}</span></div>
            <div class="detail-item"><span class="detail-label">Phone Number:</span> <span class="detail-value">${escapeHtml(selectedCheckIn.phone)}</span></div>
            <div class="detail-item"><span class="detail-label">Company Name:</span> <span class="detail-value">${escapeHtml(selectedCheckIn.fabricatorCompany) || 'N/A'}</span></div>
            <div class="detail-item"><span class="detail-label">Company Phone:</span> <span class="detail-value">${escapeHtml(selectedCheckIn.fabricatorPhone) || 'N/A'}</span></div>
            <div class="detail-item"><span class="detail-label">Sales Rep:</span> <span class="detail-value">${escapeHtml(salesRep) || 'N/A'}</span></div>
          </div>
          
          <div class="section-title">Material Selection(s)</div>
          <table>
            <thead>
              <tr>
                <th style="width: 5%; text-align: center;">#</th>
                <th>Material Name</th>
                <th>Lot/Bundle Number</th>
                <th>Slab Numbers</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              ${selectionsRowsHtml}
            </tbody>
          </table>
          
          ${specialNotes ? `
          <div class="notes">
            <h4>Special Notes:</h4>
            <p>${escapeHtml(specialNotes).replace(/\n/g, '<br>')}</p>
          </div>
          ` : ''}
          
          <div class="policy-box">
            <strong>Hold Policy Note:</strong> Items will not automatically be held. Once a final selection is made, you or your fabricator may choose to hold under the fabricator's account for 7 days. After 7 days, tags may be removed without notice to you or your fabricator.
          </div>
          
          <div class="footer">
            This is an automated selection record from the Easy Stones Check-In Portal.
          </div>
          
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleOpenSelectionModal = (checkIn) => {
    setSelectedCheckIn(checkIn);
    setBuilderName(checkIn.builderName || '');
    setBuilderPhone(checkIn.builderPhone || '');
    setSalesRep(checkIn.salesRep || '');
    setSalesRepEmail(checkIn.salesRepEmail || '');
    setShowEmailModal(false);
    setEmailAddress('');
    setIsSendingEmail(false);
    setEmailSuccess(false);
    setSelMobileTab('customer');
    setScanNotice(null);
    setShowDiscardConfirm(false);

    const savedSelections = checkIn.selections || [];
    const filledCount = savedSelections.filter(rowHasData).length;
    const initialDesktop = Math.max(4, Math.min(SHEET_ROWS, filledCount || savedSelections.length || 4));
    const initialMobile = Math.max(2, Math.min(SHEET_ROWS, filledCount || savedSelections.length || 2));

    setDesktopRowCount(initialDesktop);
    setMobItemCount(initialMobile);

    const formattedSelections = Array.from({ length: SHEET_ROWS }, (_, idx) => {
      const saved = savedSelections[idx];
      return saved ? {
        material: saved.material || '',
        details: saved.details || '',
        size: saved.size || '',
        lot: saved.lot || ''
      } : emptyRow();
    });
    setSelections(formattedSelections);
    setSpecialNotes(checkIn.specialNotes || '');
    setSaveSuccess(false);
    setSheetBaseline(sheetValues({
      builderName: checkIn.builderName,
      builderPhone: checkIn.builderPhone,
      salesRep: checkIn.salesRep,
      selections: formattedSelections,
      specialNotes: checkIn.specialNotes,
    }));
  };

  const handleAddMobItem = () => {
    setMobItemCount(prev => Math.min(12, prev + 1));
    setSelections(prev => {
      if (prev.length <= mobItemCount) {
        return [...prev, { material: '', details: '', size: '', lot: '' }];
      }
      return prev;
    });
  };

  const handleAddSelectionRow = () => {
    setDesktopRowCount(prev => Math.min(12, prev + 1));
    setSelections(prev => {
      if (prev.length <= desktopRowCount) {
        return [...prev, { material: '', details: '', size: '', lot: '' }];
      }
      return prev;
    });
  };

  // Shared by the mobile ✕ and the desktop trash button: blank the row, close
  // the gap so filled rows stay on top, and show one fewer slot.
  const handleRemoveSelectionRow = (idx) => {
    setSelections(prev => {
      const filled = prev.filter((item, i) => i !== idx && rowHasData(item));
      return [...filled, ...Array.from({ length: SHEET_ROWS - filled.length }, emptyRow)];
    });
    setDesktopRowCount(prev => Math.max(1, prev - 1));
    setMobItemCount(prev => Math.max(1, prev - 1));
    setScanNotice(null);
  };

  const handleSalesRepChange = (val) => {
    const formatted = formatTitleCase(val);
    setSalesRep(formatted);
    // Find matching sales rep in state list
    const matched = salesReps.find(r => 
      r.name.toLowerCase() === val.trim().toLowerCase() || 
      r.username.toLowerCase() === val.trim().toLowerCase()
    );
    if (matched) {
      setSalesRepEmail(matched.email || '');
    } else {
      setSalesRepEmail('');
    }
  };

  const handleTagImageUpload = (idx, event) => {
    const file = event.target.files[0];
    if (!file) return;

    setCropFile(file);
    setCropTargetIndex(idx);
    // Start on the whole photo: the old centred 40%-wide box cut the ends off
    // any tag nobody re-framed.
    setCropBox({ x: 0, y: 0, width: 100, height: 100 });

    const reader = new FileReader();
    reader.onload = (e) => {
      setCropImageSrc(e.target.result);
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    event.target.value = null;
  };

  const executeTagOcrScan = async (idx, croppedBlob) => {
    setCropperOpen(false);
    setScanningIndex(idx);
    setScanningProgress(0);
    setScanNotice(null);

    let worker = null;
    let pass = 0;
    try {
      const { createWorker } = await import('tesseract.js');
      // One worker for every rotation — Tesseract.recognize() used to start
      // (and download into) a fresh one per pass.
      worker = await createWorker('eng', undefined, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setScanningProgress(Math.floor(((pass + m.progress) / ORIENTATIONS.length) * 100));
          }
        },
      });

      // Tags on standing slabs are usually shot sideways, so try every
      // rotation and keep the best read — stopping early only on a confident,
      // complete one. readStoneLabel rejects garbage, so a wrong rotation can
      // no longer win just by coming first.
      let best = null;
      for (pass = 0; pass < ORIENTATIONS.length; pass++) {
        const processedBlob = await preprocessImage(croppedBlob, ORIENTATIONS[pass]);
        const { data } = await worker.recognize(processedBlob);
        const read = readStoneLabel(data.text, productList);
        const score = scoreLabelRead(read, data.confidence);
        if (!best || score > best.score) best = { read, score, confidence: data.confidence };
        if (isConfidentRead(read, data.confidence)) break;
      }

      if (!best || !isUsableRead(best.read, best.confidence)) {
        setScanNotice({
          idx,
          tone: 'error',
          lines: ["Couldn't read this tag. Try a closer, straight-on photo and fit the crop box around just the tag."],
        });
        return;
      }

      const row = resolveLabelRead(best.read, productList);
      setSelections(prev => prev.map((sel, i) => (i === idx ? {
        material: row.material || sel.material,
        lot: row.lot || sel.lot,
        details: row.details || sel.details,
        size: row.size || sel.size,
      } : sel)));
      setScanNotice({ idx, tone: row.notes.length ? 'warn' : 'ok', lines: ['Filled from the tag — check it before saving.', ...row.notes] });
    } catch (err) {
      console.error('OCR recognition error:', err);
      setScanNotice({ idx, tone: 'error', lines: [`Couldn't scan the tag: ${err.message}`] });
    } finally {
      if (worker) worker.terminate().catch(() => {});
      setScanningIndex(null);
      setScanningProgress(0);
    }
  };

  const handleSelectionChange = (idx, field, value) => {
    setSelections(prev => prev.map((sel, i) => {
      if (i === idx) {
        const val = field === 'material' ? value.toUpperCase() : value;
        // Clear _new flag once user starts editing
        const { _new, ...rest } = sel;
        return { ...rest, [field]: val };
      }
      return sel;
    }));
  };

  // PUT what's on screen. Throws with a message the person can act on.
  const persistSheet = async () => {
    const cleanSelections = selections
      .filter(rowHasData)
      .map(({ material, details, size, lot }) => ({ material, details, size, lot }));

    let response;
    try {
      response = await authFetch(`${API_URL}/api/checkin/${selectedCheckIn._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          builderName,
          builderPhone,
          selections: cleanSelections,
          specialNotes,
          salesRep,
          salesRepEmail
        })
      });
    } catch (err) {
      console.error('Error saving selection sheet:', err);
      throw new Error('Network error. Please try again.');
    }
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || 'Failed to save selections. Please try again.');
    }
    setSheetBaseline(currentSheetValues);
  };

  const handleSaveSelections = async (e) => {
    if (e) e.preventDefault();
    if (sheetReadOnly || isSaving) return;
    setIsSaving(true);
    try {
      await persistSheet();
      setSaveSuccess(true);
      setTimeout(() => {
        closeSheet();
        if (onRefresh) onRefresh();
      }, 1000);
    } catch (err) {
      alert(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendEmail = async (e) => {
    if (e) e.preventDefault();
    if (!emailAddress.trim()) return;
    setIsSendingEmail(true);
    try {
      // The email is built from the saved record, so save first — unsaved
      // edits used to be left out of the email without any warning.
      if (!sheetReadOnly && sheetChangeCount > 0) {
        try {
          await persistSheet();
          if (onRefresh) onRefresh();
        } catch (err) {
          alert(`The sheet couldn't be saved, so the email wasn't sent. ${err.message}`);
          return;
        }
      }
      const response = await authFetch(`${API_URL}/api/checkin/${selectedCheckIn._id}/send-email`, {
        method: 'POST',
        body: JSON.stringify({ email: emailAddress.trim() })
      });
      if (response.ok) {
        setEmailSuccess(true);
        setTimeout(() => {
          setShowEmailModal(false);
          setEmailAddress('');
          setEmailSuccess(false);
        }, 1500);
      } else {
        const errData = await response.json().catch(() => ({}));
        alert(errData.message || 'Failed to send email. Please try again.');
      }
    } catch (err) {
      console.error('Error sending selection sheet email:', err);
      alert('Network error. Please try again.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Use prop if provided (accurate from DB), else compute from loaded page
  const todayCount = useMemo(() => {
    if (todayCountProp !== null) return todayCountProp;
    return checkIns.filter((c) => isToday(c.createdAt)).length;
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
              filterLocation 
                ? `/checkin?location=${encodeURIComponent(filterLocation)}`
                : user?.assignedLocations?.find(l => l !== '*')
                  ? `/checkin?location=${encodeURIComponent(user.assignedLocations.find(l => l !== '*'))}`
                  : '/checkin'
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
              filterLocation 
                ? `/checkin?location=${encodeURIComponent(filterLocation)}`
                : user?.assignedLocations?.find(l => l !== '*')
                  ? `/checkin?location=${encodeURIComponent(user.assignedLocations.find(l => l !== '*'))}`
                  : '/checkin'
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
                    const entryDate = c.createdAt || c.date;
                    const entryIsToday = isToday(entryDate);
                    return (
                      <tr key={c._id} className={entryIsToday ? 'clp-row-today' : ''}>
                        <td className="clp-td-time">
                          <div className="clp-date">{formatDate(entryDate)}</div>
                          <div className="clp-time">{formatTime(entryDate)}</div>
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
                const entryDate = c.createdAt || c.date;
                const entryIsToday = isToday(entryDate);
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
                          {entryIsToday ? `TODAY • ${formatTime(entryDate)}` : formatDate(entryDate)}
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

      {/* ── Selection Sheet Modal ── */}
      {selectedCheckIn && (
        <div className="selection-modal-overlay">
          <div className="selection-modal-container">

            {/* ════════════════════════════════════════════
                MOBILE UI  (hidden on desktop via CSS)
                ════════════════════════════════════════════ */}
            <div className="sel-mobile-view">

              {/* Header: title + customer name & phone only */}
              <div className="sel-mob-header">
                <div className="sel-mob-header-text">
                  <h2 className="sel-mob-title">Stone Selection</h2>
                  <p className="sel-mob-subtitle">
                    {selectedCheckIn.name}
                    {selectedCheckIn.phone ? ` • ${selectedCheckIn.phone}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="sel-mob-close"
                  onClick={requestCloseSheet}
                  title="Close without saving"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Single-scroll form body */}
              <form onSubmit={handleSaveSelections} className="sel-mob-form">
                <div className="sel-mob-panel">

                  {/* Sales Rep */}
                  <div className="sel-mob-section" style={{ position: 'relative' }}>
                    <label className="sel-mob-section-label"><Users size={12} /> Sales Rep</label>
                    <input
                      type="text"
                      value={salesRep}
                      onChange={(e) => {
                        handleSalesRepChange(e.target.value);
                        setShowSalesRepDropdown(true);
                      }}
                      onFocus={() => setShowSalesRepDropdown(true)}
                      onBlur={() => setTimeout(() => setShowSalesRepDropdown(false), 200)}
                      onKeyDown={(e) => handleAutocompleteKeyDown(e, () => setShowSalesRepDropdown(false))}
                      placeholder="Enter or select sales rep name"
                      className="sel-mob-text-input"
                      autoComplete="off"
                      disabled={sheetReadOnly}
                    />
                    {showSalesRepDropdown && (
                      <div className="sel-mob-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, marginTop: '4px' }}>
                        {salesRepSuggestions.map((rep, i) => (
                          <div
                            key={rep.username || i}
                            className="sel-mob-dropdown-item"
                            onMouseDown={() => {
                              handleSalesRepChange(rep.name);
                              setShowSalesRepDropdown(false);
                            }}
                          >
                            <Users size={13} style={{ color: '#d4af37' }} />
                            <span>{rep.name}</span>
                          </div>
                        ))}
                        {salesRepSuggestions.length === 0 && (
                          <div className="sel-mob-dropdown-empty">Type custom sales rep name</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="sel-mob-divider">
                    <span>Material Selections</span>
                  </div>

                  {/* Selection Items */}
                  <div className="sel-mob-selections-list">
                    {selections.slice(0, mobItemCount).map((sel, idx) => (
                      <div key={idx} className="sel-mob-item-card">
                          <div className="sel-mob-item-header">
                            <span className="sel-mob-item-badge">ITEM {idx + 1}</span>
                            {!sheetReadOnly && (
                              <button
                                type="button"
                                className="sel-mob-item-remove"
                                onClick={() => handleRemoveSelectionRow(idx)}
                                title="Remove item"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>

                          {/* Material Search */}
                          <div className="sel-mob-material-wrapper">
                            <input
                              type="text"
                              value={sel.material}
                              onChange={(e) => {
                                handleSelectionChange(idx, 'material', e.target.value);
                                setActiveDropdownIndex(idx);
                              }}
                              onFocus={() => setActiveDropdownIndex(idx)}
                              onBlur={() => setTimeout(() => setActiveDropdownIndex(null), 200)}
                              onKeyDown={(e) => handleAutocompleteKeyDown(e, () => setActiveDropdownIndex(null))}
                              placeholder="Search material name..."
                              className="sel-mob-material-input"
                              disabled={sheetReadOnly}
                            />
                            {scanningIndex === idx ? (
                              <div className="sel-mob-scanning-badge">
                                <Loader2 size={12} className="animate-spin" />
                                <span>{scanningProgress}%</span>
                              </div>
                            ) : !sheetReadOnly && (
                              <label htmlFor={`mob-tag-${idx}`} className="sel-mob-scan-btn" title="Scan tag photo">
                                <Scan size={13} />
                                <input
                                  id={`mob-tag-${idx}`}
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => handleTagImageUpload(idx, e)}
                                  disabled={scanningIndex !== null}
                                  style={{ display: 'none' }}
                                />
                              </label>
                            )}
                          </div>

                          {scanNotice?.idx === idx && (
                            <ScanNotice notice={scanNotice} onDismiss={() => setScanNotice(null)} />
                          )}

                          {/* Autocomplete */}
                          {activeDropdownIndex === idx && (
                            <div className="sel-mob-dropdown">
                              {productList
                                .filter(p => !sel.material.trim() || p.name.toLowerCase().includes(sel.material.toLowerCase()))
                                .slice(0, 12)
                                .map(prod => (
                                  <div
                                    key={prod._id || prod.id}
                                    className="sel-mob-dropdown-item"
                                    onMouseDown={() => {
                                      handleSelectionChange(idx, 'material', prod.name);
                                      setActiveDropdownIndex(null);
                                    }}
                                  >
                                    <div className="sel-mob-dropdown-swatch" style={{ background: prod.color || '#3a3a3a' }} />
                                    <span>{prod.name}</span>
                                  </div>
                                ))}
                              {productList.filter(p => !sel.material.trim() || p.name.toLowerCase().includes(sel.material.toLowerCase())).length === 0 && (
                                <div className="sel-mob-dropdown-empty">No matching materials</div>
                              )}
                            </div>
                          )}

                          {/* Lot / Slabs / Size */}
                          <div className="sel-mob-fields-row">
                            <div className="sel-mob-field">
                              <label className="sel-mob-field-label">Lot #</label>
                              <input type="text" value={sel.lot} onChange={(e) => handleSelectionChange(idx, 'lot', e.target.value)} disabled={sheetReadOnly} placeholder="—" className="sel-mob-field-input" />
                            </div>
                            <div className="sel-mob-field">
                              <label className="sel-mob-field-label">Slabs</label>
                              <input type="text" value={sel.details} onChange={(e) => handleSelectionChange(idx, 'details', e.target.value)} disabled={sheetReadOnly} placeholder="1, 2" className="sel-mob-field-input" />
                            </div>
                            <div className="sel-mob-field">
                              <label className="sel-mob-field-label">Size</label>
                              <input type="text" value={sel.size} onChange={(e) => handleSelectionChange(idx, 'size', e.target.value)} disabled={sheetReadOnly} placeholder="120×60" className="sel-mob-field-input" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                  {/* Add Another Item */}
                  {!sheetReadOnly && mobItemCount < SHEET_ROWS && (
                    <button
                      type="button"
                      className="sel-mob-add-btn"
                      onClick={handleAddMobItem}
                    >
                      + Add Another Item
                    </button>
                  )}

                  {/* Notes */}
                  <label className="sel-mob-notes-label">Special Notes</label>
                  <textarea
                    value={specialNotes}
                    onChange={(e) => setSpecialNotes(e.target.value)}
                    placeholder="Enter any special requests, delivery notes, or details..."
                    rows="4"
                    className="sel-mob-notes-textarea"
                    disabled={sheetReadOnly}
                  />

                  {/* Warning / Disclaimer */}
                  <div className="sel-mob-disclaimer">
                    <AlertTriangle size={14} className="sel-mob-disclaimer-icon" />
                    <p>Items will not automatically be held. Once a final selection is made, you or your fabricator may choose to hold under the fabricator's account for 7 days. After 7 days, tags may be removed without notice.</p>
                  </div>

                </div>

                {/* Sticky Bottom Action Bar */}
                <div className="sel-mob-actions">
                  <div className="sel-mob-actions-row1">
                    {hasSendEmailPermission && (
                      <button type="button" onClick={() => setShowEmailModal(true)} className="sel-mob-btn-outline" disabled={isSaving}>
                        <Mail size={15} /> Email
                      </button>
                    )}
                    <button type="button" onClick={handlePrintPDF} className="sel-mob-btn-outline" disabled={isSaving}>
                      <Printer size={15} /> Print / PDF
                    </button>
                  </div>
                  {sheetReadOnly ? (
                    <p className="sel-view-only-note">View only — you don't have permission to edit selection sheets.</p>
                  ) : (
                    <button type="submit" className="sel-mob-btn-save" disabled={isSaving}>
                      {isSaving ? (<><Loader2 size={15} className="animate-spin" /> Saving...</>) : saveSuccess ? ('Saved ✓') : (<><Save size={15} /> Save Selection</>)}
                    </button>
                  )}
                </div>
              </form>
            </div>
            {/* END MOBILE UI */}


            {/* ════════════════════════════════════════════
                DESKTOP UI  (hidden on mobile via CSS)
                ════════════════════════════════════════════ */}
            <div className="sel-desktop-view">
              <div className="selection-modal-header">
                <h2 className="selection-modal-header-title">CUSTOMER VISIT / STONE SELECTION</h2>
                <button 
                  type="button" 
                  className="selection-modal-close" 
                  onClick={requestCloseSheet}
                  title="Close without saving"
                  autoFocus
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveSelections} className="selection-modal-form">

                 {/* Customer & Fabricator Details Grid */}
                <div className="selection-details-grid">
                  <div className="detail-item">
                    <span className="detail-label">
                      <Calendar size={12} className="detail-icon" /> Date:
                    </span>
                    <span className="detail-value">{formatDate(selectedCheckIn.createdAt)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">
                      <Users size={12} className="detail-icon" /> Customer Name:
                    </span>
                    <span className="detail-value">{selectedCheckIn.name}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">
                      <Phone size={12} className="detail-icon" /> Phone Number:
                    </span>
                    <span className="detail-value">{selectedCheckIn.phone}</span>
                  </div>

                  <div className="detail-item">
                    <span className="detail-label">
                      <Building2 size={12} className="detail-icon" /> Company Name:
                    </span>
                    <span className="detail-value">{selectedCheckIn.fabricatorCompany || 'N/A'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">
                      <Phone size={12} className="detail-icon" /> Company Phone Number:
                    </span>
                    <span className="detail-value">{selectedCheckIn.fabricatorPhone || 'N/A'}</span>
                  </div>
                  <div className="detail-item" style={{ position: 'relative' }}>
                    <span className="detail-label">
                      <Users size={12} className="detail-icon" /> Sales Rep:
                    </span>
                    <div className="selection-input-wrapper">
                      <UserCheck size={15} className="selection-input-icon" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#d4af37', pointerEvents: 'none', zIndex: 5 }} />
                      <input
                        type="text"
                        value={salesRep}
                        onChange={(e) => {
                          handleSalesRepChange(e.target.value);
                          setShowSalesRepDropdown(true);
                        }}
                        onFocus={() => setShowSalesRepDropdown(true)}
                        onBlur={() => setTimeout(() => setShowSalesRepDropdown(false), 200)}
                        onKeyDown={(e) => handleAutocompleteKeyDown(e, () => setShowSalesRepDropdown(false))}
                        placeholder="Select or enter sales rep..."
                        className="selection-input selection-input-with-icon"
                        style={{ paddingLeft: '2.6rem' }}
                        autoComplete="off"
                        disabled={sheetReadOnly}
                      />
                    </div>
                    {showSalesRepDropdown && (
                      <div className="custom-autocomplete-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, marginTop: '4px' }}>
                        {salesRepSuggestions
                          .map((rep, i) => (
                            <div
                              key={rep.username || i}
                              className="autocomplete-option"
                              onMouseDown={() => {
                                handleSalesRepChange(rep.name);
                                setShowSalesRepDropdown(false);
                              }}
                            >
                              {rep.name}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Selections Grid Table */}
                <div className="selections-table-wrapper">
                  <table className="selections-table">
                    <thead>
                      <tr>
                        <th style={{ width: '5%', textAlign: 'center' }}>#</th>
                        <th style={{ width: '35%' }}>Material Name</th>
                        <th style={{ width: '20%' }}>Lot/Bundle Number</th>
                        <th style={{ width: '19%' }}>Slab Numbers</th>
                        <th style={{ width: '15%' }}>Size</th>
                        <th style={{ width: '6%', textAlign: 'center' }} title="Remove Row">
                          <Trash2 size={13} style={{ opacity: 0.6 }} />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selections.slice(0, desktopRowCount).map((sel, idx) => (
                        <tr key={idx} className="selection-row-item">
                          <td className="selection-row-num">{idx + 1}</td>
                          <td style={{ position: 'relative', zIndex: activeDropdownIndex === idx ? 9999 : (selections.length - idx) }}>
                            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%' }}>
                              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                                <input
                                  type="text"
                                  value={sel.material}
                                  onChange={(e) => {
                                    handleSelectionChange(idx, 'material', e.target.value);
                                    setActiveDropdownIndex(idx);
                                  }}
                                  onFocus={() => setActiveDropdownIndex(idx)}
                                  onBlur={() => {
                                    // Small delay to allow onMouseDown on suggestions to fire first
                                    setTimeout(() => {
                                      setActiveDropdownIndex(null);
                                    }, 200);
                                  }}
                                  onKeyDown={(e) => handleAutocompleteKeyDown(e, () => setActiveDropdownIndex(null))}
                                  placeholder="Type material name..."
                                  className="selection-grid-input"
                                  style={{ paddingRight: '2.2rem' }}
                                  disabled={sheetReadOnly}
                                />
                                {scanningIndex === idx ? (
                                  <div style={{
                                    position: 'absolute',
                                    right: '6px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '0.65rem',
                                    color: '#d4af37',
                                    background: 'rgba(0, 0, 0, 0.65)',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(212, 175, 55, 0.3)',
                                    zIndex: 5
                                  }}>
                                    <Loader2 size={12} className="animate-spin" />
                                    <span style={{ fontWeight: 'bold' }}>{scanningProgress}%</span>
                                  </div>
                                ) : !sheetReadOnly && (
                                  <label
                                    htmlFor={`tag-upload-${idx}`}
                                    className="scan-tag-btn"
                                    title="Upload Slab Tag Photo"
                                    style={{
                                      position: 'absolute',
                                      right: '6px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      width: '24px',
                                      height: '24px',
                                      borderRadius: '6px',
                                      cursor: 'pointer',
                                      transition: 'all 0.2s',
                                      color: '#d4af37',
                                      backgroundColor: 'rgba(212, 175, 55, 0.08)',
                                      border: '1px solid rgba(212, 175, 55, 0.15)',
                                      pointerEvents: scanningIndex !== null ? 'none' : 'auto',
                                      opacity: scanningIndex !== null ? 0.5 : 1,
                                      zIndex: 5
                                    }}
                                  >
                                    <Scan size={12} />
                                    <input
                                      id={`tag-upload-${idx}`}
                                      type="file"
                                      accept="image/*"
                                      onChange={(e) => handleTagImageUpload(idx, e)}
                                      disabled={scanningIndex !== null}
                                      style={{ display: 'none' }}
                                    />
                                  </label>
                                )}
                              </div>
                              {scanNotice?.idx === idx && (
                                <ScanNotice notice={scanNotice} onDismiss={() => setScanNotice(null)} />
                              )}
                              {activeDropdownIndex === idx && (
                                <div className={`custom-autocomplete-dropdown ${(idx >= 2 && selections.length > 3) ? 'open-upward' : ''}`}>
                                  {productList
                                    .filter(p => {
                                      if (!sel.material.trim()) return true;
                                      return p.name.toLowerCase().includes(sel.material.toLowerCase());
                                    })
                                    .slice(0, 15)
                                    .map((prod) => (
                                      <div
                                        key={prod._id || prod.id}
                                        className="autocomplete-option"
                                        onMouseDown={() => {
                                          handleSelectionChange(idx, 'material', prod.name);
                                          setActiveDropdownIndex(null);
                                        }}
                                      >
                                        {prod.name}
                                      </div>
                                    ))
                                  }
                                  {productList.filter(p => {
                                    if (!sel.material.trim()) return true;
                                    return p.name.toLowerCase().includes(sel.material.toLowerCase());
                                  }).length === 0 && (
                                    <div className="autocomplete-no-options">
                                      No matching materials found
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={sel.lot}
                              onChange={(e) => handleSelectionChange(idx, 'lot', e.target.value)}
                              placeholder="Lot / Bundle #"
                              className="selection-grid-input"
                              disabled={sheetReadOnly}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={sel.details}
                              onChange={(e) => handleSelectionChange(idx, 'details', e.target.value)}
                              placeholder="1, 2"
                              className="selection-grid-input"
                              disabled={sheetReadOnly}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={sel.size}
                              onChange={(e) => handleSelectionChange(idx, 'size', e.target.value)}
                              placeholder="120 x 60"
                              className="selection-grid-input"
                              disabled={sheetReadOnly}
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {!sheetReadOnly && (
                              <button
                                type="button"
                                className="btn-remove-selection-row"
                                onClick={() => handleRemoveSelectionRow(idx)}
                                title="Remove Row"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add Row Button */}
                {!sheetReadOnly && desktopRowCount < SHEET_ROWS && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '1.25rem' }}>
                    <button
                      type="button"
                      className="btn-add-selection-row"
                      onClick={handleAddSelectionRow}
                    >
                      <div className="btn-add-icon-ring">
                        <Plus size={14} />
                      </div>
                      <span>Add Material Row</span>
                    </button>
                  </div>
                )}



                {/* Special Notes */}
                <div className="selection-notes-wrapper">
                  <label className="selection-notes-label">Special Notes:</label>
                  <textarea
                    value={specialNotes}
                    onChange={(e) => setSpecialNotes(e.target.value)}
                    placeholder="Enter any special requests, delivery notes, or details..."
                    rows="3"
                    className="selection-textarea"
                    disabled={sheetReadOnly}
                  />
                </div>

                {/* Disclaimer */}
                <div className="selection-disclaimer">
                  <AlertTriangle size={18} className="disclaimer-warning-icon" />
                  <p>
                    <strong>Note:</strong> Items will not automatically be held. Once a final selection is made, you or your fabricator may choose to hold under the fabricator's account for 7 days. After 7 days, tags may be removed without notice to you or your fabricator.
                  </p>
                </div>

                {/* Actions */}
                <div className="selection-modal-actions">
                  <div className="selection-modal-actions-left">
                    {hasSendEmailPermission && (
                      <button
                        type="button"
                        onClick={() => setShowEmailModal(true)}
                        className="btn-email-trigger"
                        disabled={isSaving}
                      >
                        <Mail size={15} /> Send Email
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePrintPDF}
                      className="btn-print-trigger"
                      disabled={isSaving}
                    >
                      <Printer size={15} /> Print / Save PDF
                    </button>
                  </div>

                  <div className="selection-modal-actions-right">
                    {sheetReadOnly ? (
                      <p className="sel-view-only-note">View only — you don't have permission to edit selection sheets.</p>
                    ) : (
                      <button
                        type="submit"
                        className="btn-save-selection"
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 size={15} className="animate-spin" /> Saving...
                          </>
                        ) : saveSuccess ? (
                          'Saved Successfully! ✓'
                        ) : (
                          <>
                            <Save size={15} /> Save Selection
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>
            {/* END DESKTOP UI */}

          </div>
        </div>
      )}

      {selectedCheckIn && showDiscardConfirm && (
        <div
          className="selection-email-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDiscardConfirm(false); }}
        >
          <div className="selection-email-modal-container" role="alertdialog" aria-modal="true" aria-labelledby="sel-discard-title">
            <div className="selection-email-modal-header">
              <h4 id="sel-discard-title">Discard your changes?</h4>
            </div>
            <div className="selection-email-modal-body">
              <p className="email-modal-description">
                {sheetChangeCount === 1 ? 'You’ve changed 1 field.' : `You’ve changed ${sheetChangeCount} fields.`} They’ll be lost if you close now.
              </p>
              <div className="selection-email-modal-actions">
                <button type="button" className="btn-email-modal-send" autoFocus onClick={() => setShowDiscardConfirm(false)}>
                  Keep editing
                </button>
                <button type="button" className="btn-sel-discard" onClick={closeSheet}>
                  Discard
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEmailModal && (
        <div className="selection-email-modal-overlay">
          <div className="selection-email-modal-container">
            <div className="selection-email-modal-header">
              <h4>Send Selection Sheet</h4>
              <button
                type="button"
                onClick={() => { setShowEmailModal(false); setEmailAddress(''); }}
                className="btn-close-email-modal"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSendEmail} className="selection-email-modal-body">
              <p className="email-modal-description">
                Enter the email address where you would like to send this customer selection sheet.
                {!sheetReadOnly && sheetChangeCount > 0 && ' Your unsaved changes will be saved first.'}
              </p>
              <div className="email-field-wrapper">
                <input
                  type="email"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  placeholder="recipient@email.com"
                  className="selection-email-modal-input"
                  required
                  disabled={isSendingEmail}
                  autoFocus
                />
              </div>
              <div className="selection-email-modal-actions">
                <button
                  type="button"
                  onClick={() => { setShowEmailModal(false); setEmailAddress(''); }}
                  className="btn-email-modal-cancel"
                  disabled={isSendingEmail}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-email-modal-send"
                  disabled={isSendingEmail || !emailAddress.trim()}
                >
                  {isSendingEmail ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Sending...
                    </>
                  ) : emailSuccess ? (
                    'Sent Successfully! ✓'
                  ) : (
                    <>
                      <Mail size={14} /> Send Email
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {cropperOpen && (
        <div className="tag-cropper-modal-overlay">
          <div className="tag-cropper-modal-container">
            <div className="tag-cropper-modal-header">
              <h4>Crop Label Tag</h4>
              <button
                type="button"
                onClick={() => setCropperOpen(false)}
                className="btn-close-cropper-modal"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="tag-cropper-modal-body">
              <p className="cropper-description">
                Position and size the crop frame around a single slab label text. This isolates the label from background noise.
              </p>
              
              <div className="cropper-image-wrapper" style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
                  <img src={cropImageSrc} alt="Tag preview" className="cropper-preview-img" style={{ display: 'block', maxWidth: '100%', maxHeight: '50vh', objectFit: 'contain' }} />
                  <div className="cropper-overlay-mask">
                    <div className="cropper-box" style={{
                      left: `${cropBox.x}%`,
                      top: `${cropBox.y}%`,
                      width: `${cropBox.width}%`,
                      height: `${cropBox.height}%`
                    }} />
                  </div>
                </div>
              </div>
              
              <div className="cropper-controls">
                <div className="control-group">
                  <label>Position X: {cropBox.x}%</label>
                  <input
                    type="range"
                    min="0"
                    max={100 - cropBox.width}
                    value={cropBox.x}
                    onChange={(e) => setCropBox(prev => ({ ...prev, x: parseInt(e.target.value) }))}
                  />
                </div>
                <div className="control-group">
                  <label>Position Y: {cropBox.y}%</label>
                  <input
                    type="range"
                    min="0"
                    max={100 - cropBox.height}
                    value={cropBox.y}
                    onChange={(e) => setCropBox(prev => ({ ...prev, y: parseInt(e.target.value) }))}
                  />
                </div>
                <div className="control-group">
                  <label>Width: {cropBox.width}%</label>
                  <input
                    type="range"
                    min="10"
                    max={100 - cropBox.x}
                    value={cropBox.width}
                    onChange={(e) => setCropBox(prev => ({ ...prev, width: parseInt(e.target.value) }))}
                  />
                </div>
                <div className="control-group">
                  <label>Height: {cropBox.height}%</label>
                  <input
                    type="range"
                    min="10"
                    max={100 - cropBox.y}
                    value={cropBox.height}
                    onChange={(e) => setCropBox(prev => ({ ...prev, height: parseInt(e.target.value) }))}
                  />
                </div>
              </div>
              
              <div className="tag-cropper-modal-actions">
                <button
                  type="button"
                  onClick={() => setCropperOpen(false)}
                  className="btn-cropper-modal-cancel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const croppedBlob = await getCroppedImageBlob(cropFile, cropBox.x, cropBox.y, cropBox.width, cropBox.height);
                      executeTagOcrScan(cropTargetIndex, croppedBlob);
                    } catch (err) {
                      console.error("Cropping failed:", err);
                      alert("Failed to crop image. Please try again.");
                    }
                  }}
                  className="btn-cropper-modal-scan"
                >
                  Scan Selected Area
                </button>
              </div>
            </div>
          </div>
        </div>
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
