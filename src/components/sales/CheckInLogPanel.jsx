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
import React, { useState, useEffect } from 'react';
import {
  Clock, Search, Download, Loader2, Calendar,
  ChevronLeft, ChevronRight, RefreshCw,
  Users, Building2, Phone, Mail, UserCheck, X, Eye, Edit2, Trash2, ClipboardList,
  Save, AlertTriangle, Printer, Sun, Moon
} from 'lucide-react';
import { API_URL } from '../../config/api';
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
  todayCount: todayCountProp = null,
  monthCount = 0,
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  onExport,
  sidebarToggle = null,
  embedded = false,
  onView = null,
  onEdit = null,
  onDelete = null,
  theme: themeProp = null,
  onToggleTheme = null,
}) => {
  const [internalTheme, setInternalTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
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
        setInternalTheme(saved === 'light' ? 'light' : 'dark');
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

  const handleSelectionChange = (idx, field, value) => {
    setSelections(prev => prev.map((sel, i) => {
      if (i === idx) {
        return { ...sel, [field]: value };
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
  const todayCount = todayCountProp !== null
    ? todayCountProp
    : checkIns.filter((c) => isToday(c.createdAt)).length;

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
    <div className={`clp-root ${embedded ? 'clp-embedded' : 'clp-page'} ${theme}-theme`}>

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
          <button
            type="button"
            className="clp-theme-btn"
            onClick={handleToggleTheme}
            title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
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
            <div className="clp-stat-val">{embedded ? checkIns.length : totalCount}</div>
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
          <div className="clp-table-scroll">
            <table className="clp-table">
              <thead>
                <tr>
                  <th>CHECK-IN TIME</th>
                  <th>VISITOR NAME</th>
                  <th>PHONE NUMBER</th>
                  <th>COMPANY/CONTACT NAME</th>
                  <th>PHONE NUMBER</th>
                  <th style={{ textAlign: 'center' }}>ACTIONS</th>
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
                        <div className="clp-icon-text">
                          <Phone size={12} /> {c.fabricatorPhone}
                        </div>
                      ) : (
                        <span className="clp-dash">—</span>
                      )}
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleOpenSelectionModal(c)}
                          title="Selection sheet"
                          style={{ background: 'transparent', border: 'none', color: '#10b981', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                        >
                          <ClipboardList size={15} />
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
                        {onEdit && (
                          <button
                            onClick={() => onEdit(c)}
                            title="Edit check-in"
                            style={{ background: 'transparent', border: 'none', color: '#d4af37', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                          >
                            <Edit2 size={15} />
                          </button>
                        )}
                        {onDelete && (
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
                        <td>
                          <input
                            type="text"
                            value={sel.material}
                            onChange={(e) => handleSelectionChange(idx, 'material', e.target.value)}
                            placeholder="Type material name..."
                            className="selection-grid-input"
                            list="products-datalist"
                          />
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
                {salesReps.map((rep, idx) => (
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
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(true)}
                    className="btn-email-trigger"
                    disabled={isSaving}
                  >
                    <Mail size={15} /> Send Email
                  </button>
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
                    type="button"
                    onClick={() => setSelectedCheckIn(null)}
                    className="btn-cancel"
                    disabled={isSaving}
                  >
                    <X size={15} /> Cancel
                  </button>
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
                        <Save size={15} /> Save Selection Sheet
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
    </div>
  );
};

export default CheckInLogPanel;
