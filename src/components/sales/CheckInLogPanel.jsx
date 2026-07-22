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
import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock, Search, Download, Loader2, Calendar,
  Users, Building2, Phone, Mail, UserCheck, X, Eye, Edit2, Trash2, ClipboardList,
  Save, AlertTriangle, Printer, Sun, Moon, Filter, Scan, Plus, MapPin
} from 'lucide-react';
import { API_URL } from '../../config/api';
import Pagination from '../shared/Pagination';
import { useAuth } from '../../context/AuthContext';
import './CheckInLogPanel.css';

/* ── helpers ──────────────────────────────────── */
const parseLocalDate = (ts) => {
  if (!ts) return new Date();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string' && ts.includes('T')) return new Date(ts);
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts)) {
    const [y, m, d] = ts.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(ts);
};

const formatDate = (ts) => {
  const d = parseLocalDate(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatTime = (ts) => {
  const d = parseLocalDate(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatLastUpdated = (d) =>
  d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

const isToday = (ts) => {
  if (!ts) return false;
  const d = parseLocalDate(ts);
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

        // Resize: limit max size to 1200px to optimize performance and prevent crashes
        const MAX_DIM = 1200;
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

const getLevenshteinDistance = (a, b) => {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[a.length][b.length];
};

const findCloseInventoryLot = (parsedMaterial, parsedLot, productList) => {
  if (!parsedLot) return parsedLot;
  
  const matchedProduct = productList.find(p => 
    p.name.toLowerCase().includes(parsedMaterial.toLowerCase()) || 
    parsedMaterial.toLowerCase().includes(p.name.toLowerCase())
  );
  
  if (matchedProduct && matchedProduct.bundles && matchedProduct.bundles.length > 0) {
    const candidateLots = matchedProduct.bundles
      .map(b => b.bundleNumber || b.serial)
      .filter(Boolean)
      .map(l => l.replace(/\D/g, ''));
      
    const cleanParsedLot = parsedLot.replace(/\D/g, '');
    
    let bestCandidate = null;
    let minDistance = 999;
    
    for (const candidate of candidateLots) {
      if (candidate === cleanParsedLot) return candidate;
      
      const distance = getLevenshteinDistance(cleanParsedLot, candidate);
      if (distance < minDistance) {
        minDistance = distance;
        bestCandidate = candidate;
      }
    }
    
    const maxLen = bestCandidate ? Math.max(cleanParsedLot.length, bestCandidate.length) : 0;
    const threshold = maxLen >= 5 ? 2 : 1;
    if (bestCandidate && minDistance <= threshold) {
      console.log(`Auto-corrected OCR lot typo: ${parsedLot} -> ${bestCandidate} (distance: ${minDistance})`);
      return bestCandidate;
    }
  }
  
  return parsedLot;
};

const correctLotUsingBundle = (lot, bundle) => {
  if (!lot || !bundle) return lot;
  
  const cleanBundle = bundle.replace(/[\(\)\[\]\{\}]/g, '').trim();
  const parts = cleanBundle.split(/[\/\\|I]/).map(p => p.trim()).filter(Boolean);
  
  if (parts.length >= 2) {
    const bundleLotCandidate = parts[1]; // e.g. in "7/13845", this is "13845"
    
    if (/^\d+$/.test(bundleLotCandidate) && bundleLotCandidate.length >= 3) {
      const distance = getLevenshteinDistance(lot, bundleLotCandidate);
      if (distance > 0 && distance <= 2) {
        console.log(`Auto-corrected OCR lot typo using bundle: ${lot} -> ${bundleLotCandidate} (distance: ${distance})`);
        return bundleLotCandidate;
      }
    }
  }
  
  return lot;
};

const findCloseInventorySize = (parsedMaterial, parsedSize, productList) => {
  if (!parsedSize) return parsedSize;
  
  const matchedProduct = productList.find(p => 
    p.name.toLowerCase().includes(parsedMaterial.toLowerCase()) || 
    parsedMaterial.toLowerCase().includes(p.name.toLowerCase())
  );
  
  if (matchedProduct && matchedProduct.sizes && matchedProduct.sizes.length > 0) {
    const cleanParsedSize = parsedSize.replace(/\s+/g, '').toLowerCase();
    
    let bestCandidate = null;
    let minDistance = 999;
    
    for (const sizeCandidate of matchedProduct.sizes) {
      const cleanCandidate = sizeCandidate.replace(/\s+/g, '').toLowerCase();
      if (cleanCandidate === cleanParsedSize) return sizeCandidate; // exact match
      
      const distance = getLevenshteinDistance(cleanParsedSize, cleanCandidate);
      if (distance < minDistance) {
        minDistance = distance;
        bestCandidate = sizeCandidate;
      }
    }
    
    if (bestCandidate && minDistance <= 2) {
      console.log(`Auto-corrected OCR size typo: ${parsedSize} -> ${bestCandidate} (distance: ${minDistance})`);
      return bestCandidate;
    }
  }
  
  return parsedSize;
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
  todayCount: todayCountProp = null,
  monthCount = 0,
  allTimeCount = 0,
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  rowsPerPage = 20,
  onRowsPerPageChange = () => {},
  filterMonth = null,
  filterYear = null,
  onFilterMonthChange = () => {},
  onFilterYearChange = () => {},
  onExport,
  sidebarToggle = null,
  embedded = false,
  onView = null,
  onEdit = null,
  onDelete = null,
  theme: themeProp = null,
  onToggleTheme = null,
  filterLocation = null,
  onFilterLocationChange = null,
  locations = [],
}) => {
  const { user } = useAuth();
  const hasEditPermission = !user || user.permissions?.includes('manage_checkins');
  const hasDeletePermission = !user || user.permissions?.includes('delete_checkins');
  const hasSendEmailPermission = !user || user.permissions?.includes('send_checkin_email');
  const hasMultipleLocations = user && (user.assignedLocations?.includes('*') || user.assignedLocations?.length > 1);

  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [internalTheme, setInternalTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_theme');
      return saved === 'dark' ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  });

  const theme = themeProp || internalTheme;

  const handleToggleTheme = () => {
    if (onToggleTheme) {
      onToggleTheme();
    } else {
      const nextTheme = theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('checkin_theme', nextTheme);
        setInternalTheme(nextTheme);
        window.dispatchEvent(new Event('checkin_theme_changed'));
      } catch (e) {
        console.error(e);
      }
    }
  };

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const saved = localStorage.getItem('checkin_theme');
        setInternalTheme(saved === 'dark' ? 'dark' : 'light');
      } catch (e) {}
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

  // ── OCR Tag Scanning State ──
  const [scanningIndex, setScanningIndex] = useState(null);
  const [scanningProgress, setScanningProgress] = useState(0);

  // ── Tag Cropper State ──
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState('');
  const [cropBox, setCropBox] = useState({ x: 30, y: 10, width: 40, height: 80 });
  const [cropTargetIndex, setCropTargetIndex] = useState(null);
  const [cropFile, setCropFile] = useState(null);

  // Load active selection sheet state from localStorage on mount (if page was refreshed)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('active_selection_sheet');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.checkIn) {
          setSelectedCheckIn(parsed.checkIn);
          setBuilderName(parsed.builderName || '');
          setBuilderPhone(parsed.builderPhone || '');
          setSalesRep(parsed.salesRep || '');
          setSalesRepEmail(parsed.salesRepEmail || '');
          setSelections(parsed.selections || Array.from({ length: 6 }, () => ({ material: '', details: '', size: '', lot: '' })));
          setSpecialNotes(parsed.specialNotes || '');
        }
      }
    } catch (e) {
      console.error('Failed to load active selection sheet from localStorage:', e);
    }
  }, []);

  // Save active selection sheet state to localStorage reactively when fields change
  useEffect(() => {
    if (selectedCheckIn) {
      try {
        localStorage.setItem('active_selection_sheet', JSON.stringify({
          checkIn: selectedCheckIn,
          builderName,
          builderPhone,
          salesRep,
          salesRepEmail,
          selections,
          specialNotes
        }));
      } catch (e) {
        console.error('Failed to save active selection sheet state to localStorage:', e);
      }
    } else {
      try {
        localStorage.removeItem('active_selection_sheet');
      } catch (e) {}
    }
  }, [selectedCheckIn, builderName, builderPhone, salesRep, salesRepEmail, selections, specialNotes]);

  // Fetch product and sales rep auto-suggestions when selections modal is opened
  useEffect(() => {
    if (selectedCheckIn) {
      // 1. Products
      fetch(`${API_URL}/api/products`)
        .then(res => res.json())
        .then(data => {
          const list = Array.isArray(data) ? data : (data.data || []);
          setProductList(list);
        })
        .catch(err => console.error('Error fetching products:', err));

      // 2. Sales Reps
      fetch(`${API_URL}/api/salesreps`)
        .then(res => res.json())
        .then(data => {
          const list = data.success ? data.data : (Array.isArray(data) ? data : []);
          setSalesReps(list);
        })
        .catch(err => console.error('Error fetching sales reps:', err));
    }
  }, [selectedCheckIn]);

  const handlePrintPDF = () => {
    if (!selectedCheckIn) return;

    const dateStr = formatDate(selectedCheckIn.createdAt);
    const validSelections = selections.filter(s => s.material.trim() !== '');

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
            <td style="padding: 10px; color: #222; font-weight: 500;">${sel.material || 'N/A'}</td>
            <td style="padding: 10px; color: #555;">${sel.lot || 'N/A'}</td>
            <td style="padding: 10px; color: #555;">${sel.details || 'N/A'}</td>
            <td style="padding: 10px; color: #555;">${sel.size || 'N/A'}</td>
          </tr>
        `;
      });
    }

    const printWindow = window.open('', '_blank', 'width=800,height=800');
    printWindow.document.write(`
      <html>
        <head>
          <title>Selection Sheet - ${selectedCheckIn.name}</title>
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
            <div class="detail-item"><span class="detail-label">Date:</span> <span class="detail-value">${dateStr}</span></div>
            <div class="detail-item"><span class="detail-label">Customer Name:</span> <span class="detail-value">${selectedCheckIn.name}</span></div>
            <div class="detail-item"><span class="detail-label">Phone Number:</span> <span class="detail-value">${selectedCheckIn.phone}</span></div>
            <div class="detail-item"><span class="detail-label">Company Name:</span> <span class="detail-value">${selectedCheckIn.fabricatorCompany || 'N/A'}</span></div>
            <div class="detail-item"><span class="detail-label">Company Phone:</span> <span class="detail-value">${selectedCheckIn.fabricatorPhone || 'N/A'}</span></div>
            <div class="detail-item"><span class="detail-label">Sales Rep:</span> <span class="detail-value">${salesRep || 'N/A'}</span></div>
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
            <p>${specialNotes.replace(/\n/g, '<br>')}</p>
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
    
    const savedSelections = checkIn.selections || [];
    const formattedSelections = Array.from({ length: 6 }, (_, idx) => {
      if (savedSelections[idx]) {
        return {
          material: savedSelections[idx].material || '',
          details: savedSelections[idx].details || '',
          size: savedSelections[idx].size || '',
          lot: savedSelections[idx].lot || ''
        };
      }
      return { material: '', details: '', size: '', lot: '' };
    });
    setSelections(formattedSelections);
    setSpecialNotes(checkIn.specialNotes || '');
    setSaveSuccess(false);
  };

  const handleSalesRepChange = (val) => {
    setSalesRep(val);
    // Find matching sales rep in state list
    const matched = salesReps.find(r => 
      r.name.toLowerCase() === val.trim().toLowerCase() || 
      r.username.toLowerCase() === val.trim().toLowerCase()
    );
    if (matched) {
      setSalesRepEmail(matched.email || '');
      console.log(`Matched sales rep email: ${matched.email}`);
    } else {
      setSalesRepEmail('');
    }
  };

  const parseStoneLabel = (text, productList = []) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // 1. Try standard single-line parsing first
    for (const line of lines) {
      const sizeRegex = /(\d{2,4})\s*[xX×*%]\s*(\d{2,4})/;
      const sizeMatch = line.match(sizeRegex);

      if (sizeMatch) {
        const sizeStr = sizeMatch[0];
        const sizeIndex = line.indexOf(sizeStr);
        
        const beforeSize = line.substring(0, sizeIndex).trim();
        const afterSize = line.substring(sizeIndex + sizeStr.length).trim();
        
        if (beforeSize.length > 5 && afterSize.length > 3) {
          const material = afterSize.replace(/^[/\s|\\:\-—–]+|[/\s|\\:\-—–]+$/g, '').trim()
                                    .replace(/^[iIl1|/\s\\:\-—–]+\s+/, '').trim();
          
          let bundle = '';
          const bundleMatch = beforeSize.match(/[\(\[\{](.+?)[\)\}\]]/);
          if (bundleMatch) bundle = bundleMatch[1].trim();
          
          const beforeWithoutBundle = beforeSize.replace(/[\(\[\{].+?[\)\}\]]/g, ' ');
          const tokens = beforeWithoutBundle.match(/[a-zA-Z0-9]+/g) || [];
          const numberMatches = tokens
            .map(t => {
              const cleaned = t
                .replace(/[Ss]/g, '5')
                .replace(/[Oo]/g, '0')
                .replace(/[IiIl]/g, '1')
                .replace(/[Bb]/g, '8')
                .replace(/[Gg]/g, '6')
                .replace(/[Zz]/g, '2')
                .replace(/[Tt]/g, '7');
              return /^\d+$/.test(cleaned) ? cleaned : null;
            })
            .filter(Boolean);

          let lot = '';
          let slab = '';
          if (numberMatches && numberMatches.length >= 2) {
            lot = numberMatches[0];
            slab = numberMatches[1];
          } else if (numberMatches && numberMatches.length === 1) {
            lot = numberMatches[0];
          }

          return { lot, slab, bundle, size: sizeStr, material };
        }
      }
    }

    // 2. Multiline Fallback Parser
    let sizeStr = '';
    let lot = '';
    let slab = '';
    let material = '';
    let bundle = '';

    const sizeRegex = /(\d{2,4})\s*[xX×*%]\s*(\d{2,4})/;
    const fullTextJoined = lines.join(' ');
    const sizeMatch = fullTextJoined.match(sizeRegex);
    
    if (sizeMatch) {
      sizeStr = sizeMatch[0];
    }

    const sizeNumbers = sizeMatch ? [sizeMatch[1], sizeMatch[2]] : [];
    const allNumericTokens = [];

    lines.forEach(line => {
      const cleanLine = sizeMatch && line.includes(sizeStr) ? line.replace(sizeStr, ' ') : line;
      const tokens = cleanLine.match(/[a-zA-Z0-9]+/g) || [];
      tokens.forEach(t => {
        const cleaned = t
          .replace(/[Ss]/g, '5')
          .replace(/[Oo]/g, '0')
          .replace(/[IiIl]/g, '1')
          .replace(/[Bb]/g, '8')
          .replace(/[Gg]/g, '6')
          .replace(/[Zz]/g, '2')
          .replace(/[Tt]/g, '7');
        
        if (/^\d+$/.test(cleaned) && cleaned.length >= 2) {
          if (!sizeNumbers.includes(cleaned)) {
            allNumericTokens.push(cleaned);
          }
        }
      });
    });

    if (allNumericTokens.length >= 2) {
      lot = allNumericTokens[0];
      slab = allNumericTokens[1];
    } else if (allNumericTokens.length === 1) {
      lot = allNumericTokens[0];
    }

    // Find the Material Name
    // First, check if any line contains a substring of a product name from our database
    let databaseMatchedMaterial = '';
    for (const line of lines) {
      const match = productList.find(p => 
        line.toLowerCase().includes(p.name.toLowerCase())
      );
      if (match) {
        databaseMatchedMaterial = line.trim();
        break;
      }
    }

    if (databaseMatchedMaterial) {
      material = databaseMatchedMaterial;
    } else {
      // Fallback: line with the most alphabetical characters
      let maxLetterCount = 0;
      lines.forEach(line => {
        if (/^\d+$/.test(line.replace(/[\s\-\/]/g, ''))) return;
        if (sizeMatch && line.includes(sizeStr) && line.replace(sizeStr, '').trim().length < 3) return;
        
        const letterCount = (line.match(/[a-zA-Z]/g) || []).length;
        if (letterCount > maxLetterCount) {
          maxLetterCount = letterCount;
          material = line.trim();
        }
      });
    }

    // Clean size and leading/trailing delimiters from the material name
    if (sizeStr && material.includes(sizeStr)) {
      material = material.replace(sizeStr, '');
    }
    material = material.replace(/^[/\s|\\:\-—–]+|[/\s|\\:\-—–]+$/g, '').trim()
                       .replace(/^[iIl1|/\s\\:\-—–]+\s+/, '').trim();

    const bundleMatch = fullTextJoined.match(/[\(\[\{](.+?)[\)\}\]]/);
    if (bundleMatch) {
      bundle = bundleMatch[1].trim();
    }

    if (lot || slab || sizeStr || material) {
      return {
        lot,
        slab,
        bundle,
        size: sizeStr,
        material
      };
    }

    return null;
  };

  const handleTagImageUpload = (idx, event) => {
    const file = event.target.files[0];
    if (!file) return;

    setCropFile(file);
    setCropTargetIndex(idx);
    setCropBox({ x: 30, y: 10, width: 40, height: 80 });

    const reader = new FileReader();
    reader.onload = (e) => {
      setCropImageSrc(e.target.result);
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    event.target.value = null;
  };

  const executeTagOcrScan = async (idx, croppedBlob) => {
    const Tesseract = (await import('tesseract.js')).default;
    setCropperOpen(false);
    setScanningIndex(idx);
    setScanningProgress(0);

    try {
      const orientations = [0, 90, 270];
      let bestText = '';
      let parsed = null;

      for (let i = 0; i < orientations.length; i++) {
        const degrees = orientations[i];
        console.log(`Scanning orientation: ${degrees}°...`);

        // Resize and rotate image
        const processedBlob = await preprocessImage(croppedBlob, degrees);

        const { data: { text } } = await Tesseract.recognize(
          processedBlob,
          'eng',
          {
            logger: m => {
              if (m.status === 'recognizing text') {
                const overallProgress = Math.floor(((i + m.progress) / orientations.length) * 100);
                setScanningProgress(overallProgress);
              }
            }
          }
        );

        if (text && text.trim().length > bestText.trim().length) {
          bestText = text;
        }

        parsed = parseStoneLabel(text, productList);
        if (parsed) {
          console.log(`Successfully parsed at ${degrees}° rotation!`, parsed);
          break; // Found a valid layout, exit rotation loop
        }
      }

      if (parsed) {
        let finalLot = parsed.lot;
        
        // 1. Cross-reference Lot using Bundle Number
        if (parsed.bundle) {
          finalLot = correctLotUsingBundle(parsed.lot, parsed.bundle);
        }
        
        // 2. Cross-reference Lot using Database Product Inventory
        finalLot = findCloseInventoryLot(
          parsed.material || selections[idx]?.material || "",
          finalLot,
          productList
        );

        // 3. Cross-reference Size using Database Product Sizes
        const finalSize = findCloseInventorySize(
          parsed.material || selections[idx]?.material || "",
          parsed.size,
          productList
        );

        setSelections(prev => prev.map((sel, i) => {
          if (i === idx) {
            return {
              material: (parsed.material || sel.material).toUpperCase(),
              lot: finalLot || sel.lot,
              details: parsed.slab || sel.details,
              size: finalSize || sel.size
            };
          }
          return sel;
        }));
      } else {
        const firstLine = bestText.split('\n').map(l => l.trim()).find(l => l.length > 0);
        if (firstLine) {
          setSelections(prev => prev.map((sel, i) => {
            if (i === idx) {
              return {
                ...sel,
                material: firstLine.toUpperCase()
              };
            }
            return sel;
          }));
          alert("We recognized some text, but could not parse the exact 'Lot - Slab / (Bundle) / Size / Material' tag structure. We have filled the raw text into the Material Name field.");
        } else {
          alert("Could not recognize any text on this image. Please try a clearer picture.");
        }
      }
    } catch (err) {
      console.error('OCR recognition error:', err);
      alert('Failed to scan tag image: ' + err.message);
    } finally {
      setScanningIndex(null);
      setScanningProgress(0);
    }
  };

  const handleSelectionChange = (idx, field, value) => {
    setSelections(prev => prev.map((sel, i) => {
      if (i === idx) {
        const val = field === 'material' ? value.toUpperCase() : value;
        return { ...sel, [field]: val };
      }
      return sel;
    }));
  };

  const handleSaveSelections = async (e) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    try {
      // Filter out completely blank rows
      const cleanSelections = selections.filter(s => s.material.trim() !== '');

      const response = await fetch(`${API_URL}/api/checkin/${selectedCheckIn._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          builderName,
          builderPhone,
          selections: cleanSelections,
          specialNotes,
          salesRep,
          salesRepEmail
        }),
        credentials: 'include'
      });

      if (response.ok) {
        setSaveSuccess(true);
        setTimeout(() => {
          setSelectedCheckIn(null);
          if (onRefresh) onRefresh();
        }, 1000);
      } else {
        alert('Failed to save selections. Please try again.');
      }
    } catch (err) {
      console.error('Error saving selection sheet:', err);
      alert('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };
  const handleSendEmail = async (e) => {
    if (e) e.preventDefault();
    if (!emailAddress.trim()) return;
    setIsSendingEmail(true);
    try {
      const response = await fetch(`${API_URL}/api/checkin/${selectedCheckIn._id}/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
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
        const errData = await response.json();
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

  const filtered = useMemo(() => {
    const s = (searchTerm || '').trim().toLowerCase();
    if (!s) return checkIns;
    return checkIns.filter((c) => {
      return (
        (c.name || '').toLowerCase().includes(s) ||
        (c.phone || '').toLowerCase().includes(s) ||
        (c.fabricatorCompany || '').toLowerCase().includes(s) ||
        (c.fabricatorName || '').toLowerCase().includes(s)
      );
    });
  }, [checkIns, searchTerm]);

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

          {/* Date & Location Filters */}
          {onFilterMonthChange && onFilterYearChange && (
            <div className="clp-filter-container">
              <button
                type="button"
                className={`clp-filter-btn ${(filterMonth || filterYear || filterLocation) ? 'clp-filter-active' : ''}`}
                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                title="Filter Check-ins"
              >
                <Filter size={14} />
                <span>
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
                    {user && (user.assignedLocations?.includes('*') || user.assignedLocations?.length > 1) && onFilterLocationChange && (
                      <div className="filter-select-group" style={{ marginBottom: '1rem' }}>
                        <label>Location</label>
                        <select
                          value={filterLocation || ''}
                          onChange={(e) => onFilterLocationChange(e.target.value || null)}
                          className="filter-dropdown-select"
                        >
                          {user.assignedLocations?.includes('*') ? (
                            <>
                              <option value="">All Locations</option>
                              {locations.length > 0 ? (
                                locations.map(loc => (
                                  <option key={loc._id || loc.name} value={loc.name}>{loc.name}</option>
                                ))
                              ) : (
                                <>
                                  <option value="Seattle">Seattle</option>
                                  <option value="Spokane">Spokane</option>
                                  <option value="Salt Lake City">Salt Lake City</option>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <option value="">All My Locations</option>
                              {user.assignedLocations?.map(loc => (
                                <option key={loc} value={loc}>{loc}</option>
                              ))}
                            </>
                          )}
                        </select>
                      </div>
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
            <button className="clp-export-btn" onClick={onExport}>
              <Download size={14} />
              Export
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
        <div className="clp-stat">
          <div className="clp-stat-icon clp-stat-blue">
            <Calendar size={16} />
          </div>
          <div>
            <div className="clp-stat-val">{monthCount}</div>
            <div className="clp-stat-lbl">{new Date().toLocaleString('default', { month: 'long' })} Visitors</div>
          </div>
        </div>
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
          <>
            {/* ── Laptop / Desktop View: Table ── */}
            <div className="clp-table-scroll clp-desktop-only">
              <table className="clp-table">
                <thead>
                  <tr>
                    <th>CHECK-IN TIME</th>
                    <th>VISITOR NAME</th>
                    <th>PHONE NUMBER</th>
                    <th>COMPANY/CONTACT NAME</th>
                    <th>CUSTOMER PHONE</th>
                    {hasMultipleLocations && <th>LOCATION</th>}
                    <th style={{ textAlign: 'center' }}>ACTIONS</th>
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
                            {onView && (
                              <button
                                onClick={() => onView(c)}
                                title="View details"
                                style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                              >
                                <Eye size={15} />
                              </button>
                            )}
                            {onEdit && hasEditPermission && (
                              <button
                                onClick={() => onEdit(c)}
                                title="Edit check-in"
                                style={{ background: 'transparent', border: 'none', color: '#d4af37', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                              >
                                <Edit2 size={15} />
                              </button>
                            )}
                            {onDelete && hasDeletePermission && (
                              <button
                                onClick={() => onDelete(c)}
                                title="Delete check-in"
                                style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                              >
                                <Trash2 size={15} />
                              </button>
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

      {/* ── Pagination ── */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={onRowsPerPageChange}
        rowsPerPageOptions={[15, 25, 50]}
      />

      {/* ── Selection Sheet Modal ── */}
      {selectedCheckIn && (
        <div className="selection-modal-overlay">
          <div className="selection-modal-container">
            <div className="selection-modal-header">
              <h2 className="selection-modal-header-title">CUSTOMER VISIT / STONE SELECTION</h2>
              <button 
                type="button" 
                className="selection-modal-close" 
                onClick={() => setSelectedCheckIn(null)}
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
                <div className="detail-item">
                  <span className="detail-label">
                    <Users size={12} className="detail-icon" /> Sales Rep:
                  </span>
                  <input
                    type="text"
                    value={salesRep}
                    onChange={(e) => handleSalesRepChange(e.target.value)}
                    placeholder="Enter sales rep name"
                    className="selection-input"
                    list="salesreps-datalist"
                  />
                </div>
                {selectedCheckIn.loggedBy?.username && (
                  <div className="detail-item">
                    <span className="detail-label">
                      <UserCheck size={12} className="detail-icon" /> Logged By:
                    </span>
                    <span className="detail-value" style={{ fontStyle: 'italic', color: '#a0aec0' }}>{selectedCheckIn.loggedBy.username}</span>
                  </div>
                )}
              </div>

              {/* Selections Grid Table */}
              <div className="selections-table-wrapper">
                <table className="selections-table">
                  <thead>
                    <tr>
                      <th style={{ width: '6%', textAlign: 'center' }}>#</th>
                      <th style={{ width: '38%' }}>Material Name</th>
                      <th style={{ width: '20%' }}>Lot/Bundle Number</th>
                      <th style={{ width: '23%' }}>Slab Numbers</th>
                      <th style={{ width: '13%' }}>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selections.map((sel, idx) => (
                      <tr key={idx} className="selection-row-item">
                        <td className="selection-row-num">{idx + 1}</td>
                        <td style={{ position: 'relative', zIndex: activeDropdownIndex === idx ? 100 : 1 }}>
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
                                placeholder="Type material name..."
                                className="selection-grid-input"
                                style={{ paddingRight: '2.2rem' }}
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
                              ) : (
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
                            {activeDropdownIndex === idx && (
                              <div className={`custom-autocomplete-dropdown ${idx >= 3 ? 'open-upward' : ''}`}>
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
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={sel.details}
                            onChange={(e) => handleSelectionChange(idx, 'details', e.target.value)}
                            placeholder="1, 2"
                            className="selection-grid-input"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={sel.size}
                            onChange={(e) => handleSelectionChange(idx, 'size', e.target.value)}
                            placeholder="120 x 60"
                            className="selection-grid-input"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* HTML5 Datalist for autocomplete */}
              <datalist id="products-datalist">
                {productList.map((prod, pIdx) => (
                  <option key={prod._id || pIdx} value={prod.name} />
                ))}
              </datalist>

              <datalist id="salesreps-datalist">
                {salesReps
                  .filter(rep => {
                    if (!selectedCheckIn?.location) return true;
                    if (rep.location === selectedCheckIn.location) return true;
                    if (rep.assignedLocations?.includes(selectedCheckIn.location)) return true;
                    if (rep.assignedLocations?.includes('*')) return true;
                    return false;
                  })
                  .map((rep, idx) => (
                    <option key={rep.username || idx} value={rep.name} />
                  ))}
              </datalist>

              {/* Special Notes */}
              <div className="selection-notes-wrapper">
                <label className="selection-notes-label">Special Notes:</label>
                <textarea
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                  placeholder="Enter any special requests, delivery notes, or details..."
                  rows="3"
                  className="selection-textarea"
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
                </div>
              </div>
            </form>
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
    </div>
  );
};

export default CheckInLogPanel;
