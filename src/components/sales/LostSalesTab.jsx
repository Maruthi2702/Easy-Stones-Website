import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingDown, DollarSign, Layers, Search, Filter, Plus, 
  Trash2, Edit3, MapPin, AlertCircle, RefreshCw, ArrowUpDown,
  BarChart2, ChevronDown, ChevronUp, FileText, Building
} from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import LostSaleModal from './LostSaleModal';
import { getCustomerName, REASON_OPTIONS } from '../../utils/lostSale';
import Pagination from '../shared/Pagination';
import CustomSelect from '../shared/CustomSelect';
import { formatDate } from '../../utils/dateUtils';
import './LostSalesTab.css';

const LostSalesTab = ({
  currentUser = null,
  customersList = [],
  customerOptions = [],
  locationsList = ['Seattle', 'Spokane', 'Salt Lake City'],
  theme = 'dark',
  onCreateNew = null,
  isDropdownLoading = false,
  sidebarToggle = null
}) => {
  const [lostSales, setLostSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReason, setSelectedReason] = useState('All');
  const [selectedLocationFilter, setSelectedLocationFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest');

  // UX High-Density & Pagination State
  const [showStatsPanel, setShowStatsPanel] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(15);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  // Permission Checks: View, Edit, Delete
  const userPermissions = currentUser?.permissions || [];
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'director' || !currentUser;
  const canEdit = isAdmin || userPermissions.includes('edit_lost_sales') || userPermissions.includes('manage_lost_sales');
  const canDelete = isAdmin || userPermissions.includes('delete_lost_sales') || userPermissions.includes('manage_lost_sales');

  // Sync with Backend API
  const fetchLostSalesFromApi = async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${API_URL}/api/lost-sales`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLostSales(data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch lost sales from API:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLostSalesFromApi();
  }, []);

  // Reset to Page 1 when filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedReason, selectedLocationFilter, sortBy]);

  const handleSaveOpportunity = async (newRecord) => {
    try {
      setLoading(true);
      const isNew = !newRecord._id || newRecord._id.startsWith('ls_');
      const url = isNew ? `${API_URL}/api/lost-sales` : `${API_URL}/api/lost-sales/${newRecord._id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await authFetch(url, {
        method,
        body: JSON.stringify(newRecord)
      });

      if (res.ok) {
        await fetchLostSalesFromApi();
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to save lost sale record');
      }
    } catch (err) {
      console.error('Error saving lost sale opportunity:', err);
      alert('Network error while saving lost sale record');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRecord = async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this lost sale record?')) return;

    try {
      setLoading(true);

      const res = await authFetch(`${API_URL}/api/lost-sales/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setLostSales(prev => prev.filter(item => item._id !== id));
      } else {
        alert('Failed to delete lost sale record');
      }
    } catch (err) {
      console.error('Error deleting lost sale record:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item, e) => {
    if (e) e.stopPropagation();
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedReason('All');
    setSelectedLocationFilter('All');
  };

  // Helper to extract string safely from any prop (string or object)
  const getSafeString = (val, fallback = '') => {
    return getCustomerName(val, fallback);
  };

  // Filtered & Sorted Records
  const filteredRecords = useMemo(() => {
    return lostSales.filter(item => {
      const q = searchQuery.toLowerCase().trim();
      const cName = getSafeString(item.customerName).toLowerCase();
      const pName = getSafeString(item.productName).toLowerCase();
      const sRep = getSafeString(item.salesRepName).toLowerCase();
      const comp = getSafeString(item.competitorName).toLowerCase();
      const note = getSafeString(item.notes).toLowerCase();

      const matchesSearch = !q || (
        cName.includes(q) ||
        pName.includes(q) ||
        sRep.includes(q) ||
        comp.includes(q) ||
        note.includes(q)
      );

      const itemLoc = getSafeString(item.location);
      const matchesReason = selectedReason === 'All' || item.reason === selectedReason;
      const matchesLocation = selectedLocationFilter === 'All' || itemLoc === selectedLocationFilter;

      return matchesSearch && matchesReason && matchesLocation;
    }).sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt);
      if (sortBy === 'value_desc') return (b.totalLostValue || 0) - (a.totalLostValue || 0);
      if (sortBy === 'slabs_desc') return (b.slabsCount || 0) - (a.slabsCount || 0);
      return 0;
    });
  }, [lostSales, searchQuery, selectedReason, selectedLocationFilter, sortBy]);

  // Pagination Slice
  const totalPages = Math.ceil(filteredRecords.length / rowsPerPage) || 1;

  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredRecords.slice(start, start + rowsPerPage);
  }, [filteredRecords, currentPage, rowsPerPage]);

  // Metrics KPI Calculations
  const totalLostRevenue = useMemo(() => {
    return filteredRecords.reduce((acc, curr) => acc + (curr.totalLostValue || 0), 0);
  }, [filteredRecords]);

  const totalLostSlabs = useMemo(() => {
    return filteredRecords.reduce((acc, curr) => acc + (curr.slabsCount || 0), 0);
  }, [filteredRecords]);

  const totalLostSf = useMemo(() => {
    return filteredRecords.reduce((acc, curr) => acc + (curr.totalSf || 0), 0);
  }, [filteredRecords]);

  const topReasonText = useMemo(() => {
    if (filteredRecords.length === 0) return 'None';
    const counts = {};
    filteredRecords.forEach(r => {
      counts[r.reason] = (counts[r.reason] || 0) + 1;
    });
    let top = 'Out of Stock';
    let max = 0;
    Object.keys(counts).forEach(reasonKey => {
      if (counts[reasonKey] > max) {
        max = counts[reasonKey];
        top = reasonKey;
      }
    });
    const pct = Math.round((max / filteredRecords.length) * 100);
    return `${top} (${pct}%)`;
  }, [filteredRecords]);

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  };

  // The lost-sale date is a calendar date stored at UTC midnight; reading it with
  // a bare new Date() rendered it a day early for anyone west of UTC.
  const formatDateStr = (dateVal) => formatDate(dateVal, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });

  const getReasonBadgeClass = (reason) => {
    const match = REASON_OPTIONS.find(r => r.id === reason);
    return match ? match.badgeClass : 'badge-other-reason';
  };

  // The badge shows the short form to keep the column narrow; the expanded row
  // spells the reason out in full.
  const getReasonShortLabel = (reason) => {
    const match = REASON_OPTIONS.find(r => r.id === reason);
    return match ? match.filterLabel : (reason || 'Other');
  };

  const getReasonFullLabel = (reason) => {
    const match = REASON_OPTIONS.find(r => r.id === reason);
    return match ? match.label : (reason || 'Other');
  };

  const formatSf = (val) => (val || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });

  const formatSlabs = (count) => `${count || 0} ${count === 1 ? 'Slab' : 'Slabs'}`;

  // "Nothing recorded yet" and "your filters excluded everything" are very
  // different states, and only the second one is the user's to undo.
  const hasFilteredEverythingOut = filteredRecords.length === 0 && lostSales.length > 0;

  return (
    <div className={`lost-sales-tab-container high-density ${theme}-theme-active`}>
      {/* ── ROW 1: Top Header (Title + Record Lost Sale Button - SAME ROW) ── */}
      <div className="lost-sales-header compact-header">
        <div className="header-left-title">
          {sidebarToggle}
          <h2 className="title-text-compact">Lost Sales Tracker</h2>
        </div>

        {canEdit && (
          <button type="button" className="btn-add-lost-sale" onClick={handleOpenAddModal}>
            <Plus size={15} />
            <span className="btn-text-full">Record Lost Sale</span>
            <span className="btn-text-short">Record</span>
          </button>
        )}
      </div>

      {/* ── ROW 2: High-Density Inline KPI Metric Pills Bar ── */}
      <div className="inline-kpi-pills-bar">
        <div className="kpi-pill gold" title="Total Lost Revenue">
          <DollarSign size={13} />
          <span>{formatCurrency(totalLostRevenue)}</span>
        </div>
        <div className="kpi-pill blue" title="Total Lost Slabs & Square Feet">
          <Layers size={13} />
          <span>{formatSlabs(totalLostSlabs)} ({totalLostSf.toLocaleString('en-US', { maximumFractionDigits: 0 })} SF)</span>
        </div>
        <div className="kpi-pill red" title="Top Friction Factor">
          <AlertCircle size={13} />
          <span>{topReasonText}</span>
        </div>
      </div>

      {/* Collapsible Full KPI Cards Panel */}
      {showStatsPanel && (
        <div className="lost-sales-kpi-grid anim-slide-down">
          <div className="kpi-card gold-border">
            <div className="kpi-icon-wrap gold">
              <DollarSign size={20} />
            </div>
            <div className="kpi-info">
              <span className="kpi-label">Total Lost Revenue</span>
              <h3 className="kpi-value gold">{formatCurrency(totalLostRevenue)}</h3>
              <span className="kpi-subtext">{filteredRecords.length} Lost Opportunities</span>
            </div>
          </div>

          <div className="kpi-card blue-border">
            <div className="kpi-icon-wrap blue">
              <Layers size={20} />
            </div>
            <div className="kpi-info">
              <span className="kpi-label">Total Lost Slabs</span>
              <h3 className="kpi-value">{formatSlabs(totalLostSlabs)}</h3>
              <span className="kpi-subtext">{formatSf(totalLostSf)} Total SF</span>
            </div>
          </div>

          <div className="kpi-card red-border">
            <div className="kpi-icon-wrap red">
              <AlertCircle size={20} />
            </div>
            <div className="kpi-info">
              <span className="kpi-label">Top Reason for Loss</span>
              <h3 className="kpi-value">{topReasonText}</h3>
              <span className="kpi-subtext">Primary Business Friction</span>
            </div>
          </div>
        </div>
      )}

      {/* ── ROW 3 & 4: Search + Controls & Filters ── */}
      <div className="lost-sales-filter-bar compact">
        <div className="search-input-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search customer, product, rep..."
          />
          {searchQuery && (
            <button className="clear-search-btn" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>

        <div className="filter-controls-group">
          <button
            type="button"
            className={`btn-toggle-stats ${showStatsPanel ? 'active' : ''}`}
            onClick={() => setShowStatsPanel(!showStatsPanel)}
            title="Toggle Detailed Analytics Cards"
          >
            <BarChart2 size={15} />
            <span className="btn-text-full">{showStatsPanel ? 'Hide Cards' : 'Show Cards'}</span>
            <span className="btn-text-short">Cards</span>
          </button>

          <div className="select-filter-wrap" style={{ minWidth: 150 }}>
            <Filter size={14} className="filter-icon" />
            <CustomSelect
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              options={[
                { value: 'All', label: 'All Reasons' },
                ...REASON_OPTIONS.map(r => ({ value: r.id, label: r.filterLabel }))
              ]}
            />
          </div>

          <div className="select-filter-wrap" style={{ minWidth: 160 }}>
            <MapPin size={14} className="filter-icon" />
            <CustomSelect
              value={selectedLocationFilter}
              onChange={(e) => setSelectedLocationFilter(e.target.value)}
              options={[
                { value: 'All', label: 'All Showrooms' },
                ...locationsList.map(loc => {
                  const locName = getSafeString(loc);
                  return { value: locName, label: locName };
                })
              ]}
            />
          </div>

          <div className="select-filter-wrap" style={{ minWidth: 150 }}>
            <ArrowUpDown size={14} className="filter-icon" />
            <CustomSelect
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              options={[
                { value: 'newest', label: 'Newest First' },
                { value: 'value_desc', label: 'Highest Value ($)' },
                { value: 'slabs_desc', label: 'Most Slabs' }
              ]}
            />
          </div>
        </div>
      </div>

      {/* Desktop Data Grid */}
      <div className="lost-sales-grid-wrapper desktop-only high-capacity">
        {loading ? (
          <div className="lost-sales-loading">
            <RefreshCw size={24} className="spin-icon" />
            <span>Loading Lost Sales Records...</span>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="lost-sales-empty-state">
            <div className="empty-icon-wrapper">
              {hasFilteredEverythingOut ? <Search size={30} /> : <TrendingDown size={32} />}
            </div>
            {hasFilteredEverythingOut ? (
              <>
                <h4>No Matching Lost Sales</h4>
                <p>{lostSales.length} record{lostSales.length === 1 ? '' : 's'} on file, but none match the current search and filters.</p>
                <button className="btn-clear-filters-empty" onClick={handleResetFilters}>
                  Clear Filters
                </button>
              </>
            ) : (
              <>
                <h4>No Lost Sales Recorded Yet</h4>
                <p>Track missed opportunities, competitor pricing, and stock gaps in real-time to optimize inventory and pricing strategies.</p>
                {canEdit && (
                  <button className="btn-add-lost-sale-empty" onClick={handleOpenAddModal}>
                    <Plus size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Record Lost Sale
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <table className="lost-sales-table dense-table">
            <thead>
              {/* Column widths live in the stylesheet (table-layout: fixed), so
                  each column is sized once and cells ellipsis at their own edge. */}
              <tr>
                <th className="h-expand"></th>
                <th className="h-date">Date</th>
                <th className="h-customer">Customer</th>
                <th className="h-product">Product</th>
                <th className="h-size">Size</th>
                <th className="h-price">Price / SF</th>
                <th className="h-value">Lost Value</th>
                <th className="h-reason">Reason</th>
                <th className="h-location">Location</th>
                <th className="h-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRecords.map(item => {
                const cName = getSafeString(item.customerName, 'Client');
                const pName = getSafeString(item.productName, 'Product');
                const locName = getSafeString(item.location, 'Seattle');
                const repName = getSafeString(item.salesRepName, 'Sales Rep');
                const compName = getSafeString(item.competitorName, '');
                const isExpanded = expandedRowId === item._id;

                return (
                  <React.Fragment key={item._id}>
                    <tr 
                      className={`lost-sale-row ${isExpanded ? 'is-expanded' : ''}`}
                      onClick={() => setExpandedRowId(isExpanded ? null : item._id)}
                      title="Click to view details"
                    >
                      <td className="col-expand-chevron">
                        {isExpanded ? <ChevronUp size={16} color="#d4af37" /> : <ChevronDown size={16} color="#64748b" />}
                      </td>
                      <td className="col-date">{formatDateStr(item.date)}</td>
                      <td className="col-customer">
                        <span className="cust-name-text" title={cName}>{cName}</span>
                        {compName && (
                          <span className="competitor-sub" title={`Lost to ${compName}`}>vs {compName}</span>
                        )}
                      </td>
                      <td className="col-product">
                        <span className="prod-name-text" title={pName}>{pName}</span>
                      </td>
                      <td className="col-size">
                        <span className="size-dim">{item.lengthInches}" × {item.widthInches}"</span>
                      </td>
                      <td className="col-price">${(item.pricePerSf || 0).toFixed(2)}/SF</td>
                      <td className="col-total-value">
                        <span className="gold-value-text">{formatCurrency(item.totalLostValue)}</span>
                      </td>
                      <td className="col-reason">
                        <span className={`reason-badge ${getReasonBadgeClass(item.reason)}`} title={item.reason}>
                          {getReasonShortLabel(item.reason)}
                        </span>
                      </td>
                      <td className="col-location" title={locName}>{locName}</td>
                      <td className="col-actions">
                        {canEdit && (
                          <button
                            type="button"
                            className="lost-sales-action-btn edit-btn"
                            onClick={(e) => handleOpenEditModal(item, e)}
                            title="Edit Opportunity"
                          >
                            <Edit3 size={16} color="#d4af37" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="lost-sales-action-btn delete-btn"
                            onClick={(e) => handleDeleteRecord(item._id, e)}
                            title="Delete Opportunity"
                          >
                            <Trash2 size={16} color="#ef4444" />
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Inline Expandable Row Details */}
                    {isExpanded && (
                      <tr className="expanded-details-row">
                        <td colSpan={10}>
                          <div className="inline-expanded-content anim-slide-down">
                            <div className="detail-col">
                              <span className="detail-heading"><FileText size={14} /> Notes & Customer Request:</span>
                              <p className="detail-notes-text">{item.notes ? `"${item.notes}"` : 'No additional notes recorded.'}</p>
                            </div>
                            {/* Only what the row above doesn't already show — showroom
                                and competitor are columns, so repeating them here
                                just cost the row width it needed elsewhere. */}
                            <div className="detail-col">
                              <span className="detail-heading"><Building size={14} /> Opportunity Details:</span>
                              <div className="detail-pills-row">
                                <span className="detail-pill">Reason: <strong>{getReasonFullLabel(item.reason)}</strong></span>
                                <span className="detail-pill">Sales Rep: <strong>{repName}</strong></span>
                                <span className="detail-pill">Slabs: <strong>{item.slabsCount || 0}</strong></span>
                                <span className="detail-pill">Total SF: <strong>{formatSf(item.totalSf)} SF</strong></span>
                                {compName && (
                                  <span className="detail-pill">Competitor: <strong>{compName}</strong></span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile Card Layout */}
      <div className="lost-sales-mobile-cards mobile-only">
        {filteredRecords.length === 0 ? (
          <div className="lost-sales-empty-state">
            <div className="empty-icon-wrapper">
              {hasFilteredEverythingOut ? <Search size={28} /> : <TrendingDown size={28} />}
            </div>
            {hasFilteredEverythingOut ? (
              <>
                <h4>No Matching Lost Sales</h4>
                <p>Nothing on file matches the current search and filters.</p>
                <button className="btn-clear-filters-empty" onClick={handleResetFilters}>
                  Clear Filters
                </button>
              </>
            ) : (
              <>
                <h4>No Lost Sales Recorded Yet</h4>
                <p>Log a missed opportunity to start tracking lost revenue.</p>
              </>
            )}
          </div>
        ) : (
          paginatedRecords.map(item => {
            const cName = getSafeString(item.customerName, 'Client');
            const pName = getSafeString(item.productName, 'Product');
            return (
              <div key={item._id} className="lost-sale-card-mobile">
                <div className="card-top-row">
                  <span className="card-date">{formatDateStr(item.date)}</span>
                  <span className={`reason-badge ${getReasonBadgeClass(item.reason)}`}>
                    {item.reason}
                  </span>
                </div>

                <h4 className="card-cust-name">{cName}</h4>
                <p className="card-product-name">{pName}</p>

                <div className="card-specs-row">
                  <span>{item.lengthInches}" × {item.widthInches}"</span>
                  <span>{formatSlabs(item.slabsCount)} · {formatSf(item.totalSf)} SF</span>
                  <span>${(item.pricePerSf || 0).toFixed(2)}/SF</span>
                </div>

                {item.notes && <p className="card-notes-quote">"{getSafeString(item.notes)}"</p>}

                <div className="card-bottom-bar">
                  <div className="card-lost-value">
                    <span className="lbl">Total Lost:</span>
                    <span className="val">{formatCurrency(item.totalLostValue)}</span>
                  </div>
                  <div className="card-action-btns">
                    {canEdit && (
                      <button className="mobile-action-btn" onClick={(e) => handleOpenEditModal(item, e)}>
                        <Edit3 size={15} /> Edit
                      </button>
                    )}
                    {canDelete && (
                      <button className="mobile-action-btn delete" onClick={(e) => handleDeleteRecord(item._id, e)} title="Delete">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Site-wide Shared Pagination Component */}
      {filteredRecords.length > 0 && (
        <div className="lost-sales-pagination-wrapper">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={(page) => setCurrentPage(page)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(limit) => {
              setRowsPerPage(limit);
              setCurrentPage(1);
            }}
            rowsPerPageOptions={[10, 15, 25, 50, 100]}
          />
        </div>
      )}

      {/* Add / Edit Modal */}
      <LostSaleModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveOpportunity}
        initialData={editingItem}
        customersList={customersList}
        customerOptions={customerOptions}
        currentUser={currentUser}
        locationsList={locationsList}
        onCreateNew={onCreateNew}
        isDropdownLoading={isDropdownLoading}
      />
    </div>
  );
};

export default LostSalesTab;
