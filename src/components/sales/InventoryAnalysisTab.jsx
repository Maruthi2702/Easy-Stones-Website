import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Boxes, Upload, RefreshCw, Search, Filter, Package, DollarSign,
  Layers, Clock, AlertTriangle, TrendingDown, ChevronRight
} from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import CustomSelect from '../shared/CustomSelect';
import Pagination from '../shared/Pagination';
import InventoryImportModal from './InventoryImportModal';
import { SLAB_STATUS_BUCKET as statusBucket } from '../../utils/inventoryStatus';
import './InventoryAnalysisTab.css';

const fmtMoney = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const fmtNum = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
// Rates keep their cents, unlike the whole-dollar extended amounts: a lot
// priced at $12.94/SF vs $13/SF is a real difference once it's multiplied by
// a few hundred feet, and this figure exists to be quoted from directly.
const fmtRate = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Matches the $bucket boundaries in GET /api/inventory-analysis/summary.
// $bucket omits empty buckets from its output entirely, so buckets are
// looked up here by their boundary value (the aggregation's _id), never by
// array position — a quiet month in one range would otherwise shift every
// label after it.
const AGING_BOUNDARIES = [
  { min: 0, label: '0–30 days' },
  { min: 30, label: '31–60 days' },
  { min: 60, label: '61–90 days' },
  { min: 90, label: '91–180 days' },
  { min: 180, label: '181–365 days' },
  { min: 365, label: '365+ days' }
];

const ageDays = (dateStr) => {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

// Matches src/routes... no — matches server.js's SLAB_STATUS_BUCKET, which
// generalizes SPS's raw slabStatus strings into these four buckets (plus
// "other" for anything unrecognized) so the UI never has to special-case
// SPS's literal codes.
// Ordered roughly by how far along the outbound path a slab is — available,
// then spoken for, then being staged to leave, then gone — so the proportional
// status bar reads left-to-right as progress rather than an arbitrary order.
const STATUS_ORDER = ['available', 'hold', 'so', 'pickticket', 'packinglist', 'transfer', 'other'];
const STATUS_LABEL = {
  available: 'Available',
  hold: 'Hold',
  so: 'On SO',
  pickticket: 'Pick Ticket',
  packinglist: 'Packing List',
  transfer: 'Transfer',
  other: 'Other'
};

const dominantStatus = (counts) => {
  const present = STATUS_ORDER.filter(k => counts[k] > 0);
  if (!present.length) return null;
  return present.reduce((best, k) => (counts[k] > counts[best] ? k : best), present[0]);
};

const InventoryAnalysisTab = ({ currentUser = null, sidebarToggle = null, refreshSignal = 0 }) => {
  const [view, setView] = useState('stock'); // 'stock' | 'reorder'
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  // Tracked separately from `summary` (which reflects the active filters) so
  // that filtering down to zero matches shows "no matching items," not the
  // first-time "nothing has ever been imported" empty state.
  const [hasAnyInventory, setHasAnyInventory] = useState(null);

  // Stock Detail, grouped by product — one row per product with rolled-up
  // totals; slabsByProduct lazily holds each expanded product's individual
  // slabs, fetched only once a group is opened.
  const [groups, setGroups] = useState([]);
  const [groupsTotal, setGroupsTotal] = useState(0);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [expandedProducts, setExpandedProducts] = useState(() => new Set());
  const [slabsByProduct, setSlabsByProduct] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const [filterOptions, setFilterOptions] = useState({ categories: [], locations: [], statuses: [] });
  const [search, setSearch] = useState('');
  // Fetches key off this, not `search` — typing stays instant in the box
  // while the network request waits for a pause, instead of firing (and
  // re-rendering the summary/table) on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  // Default to Seattle for now — most inventory analysis usage is
  // Seattle-specific; revisit once other branches have real data to filter.
  const [locationFilter, setLocationFilter] = useState('Seattle');
  const [statusFilter, setStatusFilter] = useState('All');

  const [velocityRows, setVelocityRows] = useState([]);
  const [loadingVelocity, setLoadingVelocity] = useState(false);
  const [velocityLocation, setVelocityLocation] = useState('Seattle');

  const [importModal, setImportModal] = useState(null); // 'stock' | 'sales' | null

  const userPermissions = currentUser?.permissions || [];
  // Permission-only, no role shortcut: admin/director hold both grants by
  // default (see server.js's NEW_PERMISSION_GRANTS), but both are also
  // independently revocable per-role under Users & Roles (this feature adds
  // that exact toggle). A role-name bypass here would keep showing the
  // Import buttons/price figures to a role after an admin turned them off
  // for it, even though the API already enforces the real permission.
  const canImport = userPermissions.includes('import_inventory_analysis');
  // Cost/asset-value figures are gated separately from the page itself — the
  // API already strips these fields server-side for anyone without this
  // permission, so this flag only controls whether the UI bothers to render
  // the column/card at all.
  const canViewPrices = userPermissions.includes('view_inventory_prices');

  // Shared by fetchSummary and fetchItems so the summary cards/aging panel
  // always reflect the same search/category/location/status the Stock Detail
  // table is filtered to, rather than silently showing global totals.
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    if (categoryFilter !== 'All') params.set('category', categoryFilter);
    if (locationFilter !== 'All') params.set('location', locationFilter);
    if (statusFilter !== 'All') params.set('status', statusFilter);
    return params;
  }, [debouncedSearch, categoryFilter, locationFilter, statusFilter]);

  const fetchSummary = useCallback(async () => {
    try {
      setLoadingSummary(true);
      const params = buildFilterParams();
      const res = await authFetch(`${API_URL}/api/inventory-analysis/summary?${params.toString()}`);
      if (res.ok) setSummary(await res.json());
    } catch (err) {
      console.error('Failed to fetch inventory summary:', err);
    } finally {
      setLoadingSummary(false);
    }
  }, [buildFilterParams]);

  // One-time, filter-independent check for whether an import has ever
  // happened at all — see hasAnyInventory's declaration above.
  const checkHasAnyInventory = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/inventory-analysis/summary`);
      if (res.ok) {
        const data = await res.json();
        setHasAnyInventory((data.totalItems || 0) > 0);
      }
    } catch (err) {
      console.error('Failed to check inventory presence:', err);
    }
  }, []);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/inventory-analysis/filters`);
      if (res.ok) setFilterOptions(await res.json());
    } catch (err) {
      console.error('Failed to fetch inventory filters:', err);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      setLoadingGroups(true);
      const params = buildFilterParams();
      params.set('page', String(currentPage));
      params.set('limit', String(rowsPerPage));

      const res = await authFetch(`${API_URL}/api/inventory-analysis/items/grouped?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
        setGroupsTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch grouped inventory:', err);
    } finally {
      setLoadingGroups(false);
    }
  }, [buildFilterParams, currentPage, rowsPerPage]);

  // Lazily loads one product's individual slabs (up to 200) the first time
  // its group is expanded, scoped to the same filters as the group row so a
  // filtered-down group never expands into slabs that wouldn't match.
  const fetchSlabsForProduct = useCallback(async (product) => {
    setSlabsByProduct(prev => ({ ...prev, [product]: { ...(prev[product] || {}), loading: true, error: false } }));
    try {
      const params = buildFilterParams();
      params.set('product', product);
      params.set('limit', '200');
      const res = await authFetch(`${API_URL}/api/inventory-analysis/items?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSlabsByProduct(prev => ({ ...prev, [product]: { items: data.items || [], total: data.total || 0, loading: false, error: false } }));
      } else {
        setSlabsByProduct(prev => ({ ...prev, [product]: { items: [], total: 0, loading: false, error: true } }));
      }
    } catch (err) {
      console.error('Failed to fetch slabs for product:', err);
      setSlabsByProduct(prev => ({ ...prev, [product]: { items: [], total: 0, loading: false, error: true } }));
    }
  }, [buildFilterParams]);

  const fetchVelocity = useCallback(async () => {
    try {
      setLoadingVelocity(true);
      const params = new URLSearchParams();
      if (velocityLocation !== 'All') params.set('location', velocityLocation);
      const res = await authFetch(`${API_URL}/api/inventory-analysis/velocity?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setVelocityRows(data.rows || []);
      }
    } catch (err) {
      console.error('Failed to fetch inventory velocity:', err);
    } finally {
      setLoadingVelocity(false);
    }
  }, [velocityLocation]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { fetchFilterOptions(); }, [fetchFilterOptions]);
  useEffect(() => { checkHasAnyInventory(); }, [checkHasAnyInventory]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { if (view === 'stock') fetchGroups(); }, [view, fetchGroups]);
  useEffect(() => { if (view === 'reorder') fetchVelocity(); }, [view, fetchVelocity]);
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, categoryFilter, locationFilter, statusFilter]);
  // A changed filter can change which slabs belong to an already-expanded
  // group (or make the group disappear entirely) — collapse and drop the
  // cache rather than show a stale expansion against the new filtered set.
  useEffect(() => {
    setExpandedProducts(new Set());
    setSlabsByProduct({});
  }, [buildFilterParams]);

  const toggleProduct = (product) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(product)) {
        next.delete(product);
      } else {
        next.add(product);
        if (!slabsByProduct[product]) fetchSlabsForProduct(product);
      }
      return next;
    });
  };

  // Shared by the modal's onComplete and by the socket-driven refresh below,
  // so an import applied from another tab/user (see server.js's
  // 'inventory_analysis_update' emit) refreshes this screen the same way
  // finishing an import locally does.
  const refreshAll = useCallback(() => {
    setExpandedProducts(new Set());
    setSlabsByProduct({});
    fetchSummary();
    fetchFilterOptions();
    checkHasAnyInventory();
    fetchGroups();
    fetchVelocity();
  }, [fetchSummary, fetchFilterOptions, checkHasAnyInventory, fetchGroups, fetchVelocity]);

  const handleImportComplete = () => {
    setImportModal(null);
    refreshAll();
  };

  // refreshSignal increments whenever the server emits 'inventory_analysis_update'
  // (someone — possibly on another device — imported stock or sales data).
  // Skip the first render so this doesn't duplicate the mount-time fetches above.
  const skippedFirstRefreshSignal = useRef(false);
  useEffect(() => {
    if (!skippedFirstRefreshSignal.current) {
      skippedFirstRefreshSignal.current = true;
      return;
    }
    refreshAll();
  }, [refreshSignal, refreshAll]);

  const totalPages = Math.ceil(groupsTotal / rowsPerPage) || 1;
  const hasNoData = hasAnyInventory === false;
  // Only true before the very first load resolves — never true again after,
  // so typing/filtering (which re-triggers fetchSummary) never unmounts the
  // filter bar or search box out from under the user mid-keystroke.
  const initialLoading = hasAnyInventory === null;
  // $bucket's 'unknown' default (out-of-range ageDays, e.g. a receivedDate in
  // the future) can be in this list under a non-numeric _id — it isn't
  // rendered as one of AGING_BOUNDARIES' rows below, so it must also be
  // excluded here or its count would inflate the bar chart's scale and make
  // every rendered bar look shorter than its true share.
  const numericAgingBuckets = (summary?.agingBuckets || []).filter(b => typeof b._id === 'number');
  const maxAgingCount = numericAgingBuckets.length
    ? Math.max(...numericAgingBuckets.map(b => b.count))
    : 0;

  return (
    <div className="invan-tab-container">
      <div className="invan-header">
        <div className="invan-header-left">
          {sidebarToggle}
          <h2 className="invan-title-text">Inventory Analysis</h2>
        </div>
        {canImport && !hasNoData && (
          <div className="invan-header-actions">
            <button type="button" className="invan-btn-import secondary" onClick={() => setImportModal('sales')}>
              <Upload size={15} /> <span className="invan-btn-text-full">Import Sales History</span><span className="invan-btn-text-short">Sales</span>
            </button>
            <button type="button" className="invan-btn-import" onClick={() => setImportModal('stock')}>
              <Upload size={15} /> <span className="invan-btn-text-full">Import Stock</span><span className="invan-btn-text-short">Stock</span>
            </button>
          </div>
        )}
      </div>

      <p className="invan-subtitle">
        Stock levels, aging, and reorder signals from SPS's inventory exports.
        {summary?.lastImportedAt && (
          <span className="invan-last-synced"> Last stock sync: {new Date(summary.lastImportedAt).toLocaleString()}{summary.lastImportedByName ? ` by ${summary.lastImportedByName}` : ''}.</span>
        )}
      </p>

      {initialLoading ? (
        <div className="invan-loading"><RefreshCw size={24} className="invan-spin-icon" /><span>Loading inventory analysis...</span></div>
      ) : hasNoData ? (
        <div className="invan-empty-state">
          <div className="invan-empty-icon-wrapper"><Boxes size={32} /></div>
          <h4>No Inventory Data Yet</h4>
          <p>Import an SPS "Inventory In Stock - Detail" export to see stock levels, aging, and reorder analysis.</p>
          {canImport && (
            <button type="button" className="invan-btn-import-empty" onClick={() => setImportModal('stock')}>
              <Upload size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Import Stock Export
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={`invan-summary-grid${loadingSummary ? ' invan-refetching' : ''}`}>
            <div className="invan-summary-card">
              <div className="invan-summary-icon"><Layers size={18} /></div>
              <div>
                <div className="invan-summary-value">{fmtNum(summary?.totalItems)}</div>
                <div className="invan-summary-label">Lots / Slabs On File</div>
              </div>
            </div>
            {canViewPrices && (
              <div className="invan-summary-card">
                <div className="invan-summary-icon"><DollarSign size={18} /></div>
                <div>
                  <div className="invan-summary-value">{fmtMoney(summary?.totalAssetValue)}</div>
                  <div className="invan-summary-label">Total Asset Value</div>
                </div>
              </div>
            )}
            <div className="invan-summary-card">
              <div className="invan-summary-icon"><Package size={18} /></div>
              <div>
                <div className="invan-summary-value">{summary?.distinctProductCount || 0}</div>
                <div className="invan-summary-label">Distinct Products</div>
              </div>
            </div>
            <div className="invan-summary-card">
              <div className="invan-summary-icon"><Boxes size={18} /></div>
              <div>
                <div className="invan-summary-value">{fmtNum(summary?.totalAvailableQty)}</div>
                <div className="invan-summary-label">Available Quantity</div>
              </div>
            </div>
          </div>

          {maxAgingCount > 0 && (
            <div className={`invan-aging-panel${loadingSummary ? ' invan-refetching' : ''}`}>
              <h4><Clock size={15} /> Inventory Age (by Received Date)</h4>
              <div className="invan-aging-bars">
                {AGING_BOUNDARIES.map(boundary => {
                  const bucket = summary.agingBuckets.find(b => b._id === boundary.min);
                  const count = bucket?.count || 0;
                  const assetValue = bucket?.assetValue || 0;
                  const pct = maxAgingCount ? (count / maxAgingCount) * 100 : 0;
                  return (
                    <div key={boundary.min} className="invan-aging-row">
                      <span className="invan-aging-label">{boundary.label}</span>
                      <div className="invan-aging-track">
                        <div className="invan-aging-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="invan-aging-count">{count}{canViewPrices ? ` · ${fmtMoney(assetValue)}` : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="invan-view-toggle">
            <button type="button" className={view === 'stock' ? 'active' : ''} onClick={() => setView('stock')}>Stock Detail</button>
            <button type="button" className={view === 'reorder' ? 'active' : ''} onClick={() => setView('reorder')}>Reorder & Velocity</button>
          </div>

          {view === 'stock' && (
            <>
              <div className="invan-filter-bar">
                <div className="invan-search-box">
                  <Search size={16} className="invan-search-icon" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search product, SKU, supplier, block..."
                  />
                  {search && <button type="button" className="invan-clear-search-btn" onClick={() => setSearch('')}>×</button>}
                </div>
                <div className="invan-select-filter-wrap">
                  <Filter size={14} className="invan-filter-icon" />
                  <CustomSelect
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    options={[{ value: 'All', label: 'All Categories' }, ...filterOptions.categories.map(c => ({ value: c, label: c }))]}
                  />
                </div>
                <div className="invan-select-filter-wrap">
                  <CustomSelect
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    options={[{ value: 'All', label: 'All Locations' }, ...filterOptions.locations.map(l => ({ value: l, label: l }))]}
                  />
                </div>
                <div className="invan-select-filter-wrap">
                  <CustomSelect
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    options={[
                      { value: 'All', label: 'All Statuses' },
                      { value: 'available', label: 'Available (no hold/SO/transfer)' },
                      ...filterOptions.statuses.map(s => ({ value: s, label: s }))
                    ]}
                  />
                </div>
              </div>

              <div className={`invan-grid-wrapper${loadingGroups && groups.length > 0 ? ' invan-refetching' : ''}`}>
                {loadingGroups && groups.length === 0 ? (
                  <div className="invan-loading"><RefreshCw size={24} className="invan-spin-icon" /><span>Loading inventory...</span></div>
                ) : groups.length === 0 ? (
                  <div className="invan-empty-state">
                    <div className="invan-empty-icon-wrapper"><Search size={30} /></div>
                    <h4>No Matching Items</h4>
                    <p>Try adjusting your search or filters.</p>
                  </div>
                ) : (
                  <>
                    <div className={`invan-group-head desktop-only${canViewPrices ? '' : ' no-price'}`}>
                      <span className="ga-chev" />
                      <span className="ga-prod">Product</span>
                      <span className="ga-cat">Category</span>
                      <span className="ga-slabs">Slabs</span>
                      <span className="ga-onhand">On Hand</span>
                      <span className="ga-avail">Available</span>
                      {canViewPrices && <span className="ga-value">Value</span>}
                      <span className="ga-status">Status</span>
                    </div>

                    {groups.map(g => {
                      const isOpen = expandedProducts.has(g.product);
                      const slabState = slabsByProduct[g.product];
                      const oldestAge = ageDays(g.oldestReceivedDate);
                      const dominant = dominantStatus(g.statusCounts);
                      const presentStatuses = STATUS_ORDER.filter(k => g.statusCounts[k] > 0);

                      return (
                        <div key={g.product} className={`invan-group${isOpen ? ' open' : ''}`}>
                          <div
                            className={`invan-group-row${canViewPrices ? '' : ' no-price'}`}
                            role="button"
                            tabIndex={0}
                            aria-expanded={isOpen}
                            onClick={() => toggleProduct(g.product)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleProduct(g.product); } }}
                          >
                            <ChevronRight size={17} className="invan-chevron ga-chev" />
                            <div className="invan-group-product ga-prod">
                              <span className="invan-group-name" title={g.product}>{g.product}</span>
                              <span className="invan-group-sub">
                                {g.locations.join(' · ')}{oldestAge !== null ? ` · oldest lot ${oldestAge}d` : ''}
                              </span>
                            </div>
                            <div className="ga-cat">{g.category || '—'}</div>
                            <div className="invan-gnum ga-slabs">{g.slabCount}<span className="unit">slabs</span></div>
                            <div className="invan-gnum ga-onhand">{fmtNum(g.totalOnHand)}<span className="unit">{g.units}</span></div>
                            <div className={`invan-gnum ga-avail${g.totalAvailable === 0 ? ' invan-gnum-zero' : ''}`}>{fmtNum(g.totalAvailable)}<span className="unit">{g.units}</span></div>
                            {canViewPrices && <div className="invan-gnum ga-value">{fmtMoney(g.totalAssetValue)}</div>}
                            <div className="invan-status-cell ga-status">
                              {dominant && (
                                <span className={`invan-status-headline ${dominant}`}>{g.statusCounts[dominant]} {STATUS_LABEL[dominant]}</span>
                              )}
                              {presentStatuses.length > 1 && (
                                <div
                                  className="invan-status-bar"
                                  title={presentStatuses.map(k => `${g.statusCounts[k]} ${STATUS_LABEL[k]}`).join(' · ')}
                                >
                                  {presentStatuses.map(k => (
                                    <span key={k} className={`seg ${k}`} style={{ width: `${(g.statusCounts[k] / g.slabCount) * 100}%` }} />
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="invan-slabs-wrap">
                            <div className="invan-slabs-inner">
                              {slabState?.loading ? (
                                <div className="invan-slabs-status"><RefreshCw size={15} className="invan-spin-icon" /> Loading slabs...</div>
                              ) : slabState?.error ? (
                                <div className="invan-slabs-status">
                                  Failed to load slabs.
                                  <button type="button" className="invan-slabs-retry" onClick={() => fetchSlabsForProduct(g.product)}>Retry</button>
                                </div>
                              ) : slabState?.items?.length ? (
                                <div className="invan-slabs">
                                  <div className={`invan-slab-head desktop-only${canViewPrices ? '' : ' no-price'}`}>
                                    <span className="sa-sp"></span>
                                    <span className="sa-serial">Serial#</span>
                                    <span className="sa-dims">Dimensions</span>
                                    <span className="sa-loc">Location</span>
                                    <span className="sa-onhand">On Hand</span>
                                    {canViewPrices && <span className="sa-landed">Landed Cost</span>}
                                    <span className="sa-recv">Received</span>
                                    <span className="sa-age">Age</span>
                                    <span className="sa-status">Status</span>
                                  </div>
                                  {slabState.items.map(s => {
                                    const sAge = ageDays(s.receivedDate);
                                    const sBucket = statusBucket(s.slabStatus);
                                    return (
                                      <div key={s._id} className={`invan-slab-row${canViewPrices ? '' : ' no-price'}`}>
                                        <span className="sa-sp"></span>
                                        <span className="sa-serial invan-slab-serial">{s.serialNumber || '—'}</span>
                                        <span className="sa-dims">{s.dimensions || '—'}</span>
                                        <span className="sa-loc invan-slab-loc" title={s.location}>{s.location || '—'}</span>
                                        <span className="sa-onhand num">{fmtNum(s.instockQty)}<span className="unit">{s.units}</span></span>
                                        {/* Rate and slab total in one cell: they're the same
                                            fact at two scales, and quoting means reading
                                            them together rather than across the row. */}
                                        {canViewPrices && (
                                          <span className="sa-landed num">
                                            {fmtRate(s.unitLandedCost)}<span className="unit">/{s.units || 'ea'}</span>
                                            <span className="invan-slab-total">{fmtMoney(s.assetValue)}</span>
                                          </span>
                                        )}
                                        <span className="sa-recv num">{s.receivedDate ? new Date(s.receivedDate).toLocaleDateString() : '—'}</span>
                                        <span className={`sa-age num${sAge !== null && sAge > 365 ? ' invan-age-old' : ''}`}>{sAge !== null ? `${sAge}d` : '—'}</span>
                                        <span className="sa-status"><span className={`invan-status-pill ${sBucket}`}>{STATUS_LABEL[sBucket]}</span></span>
                                      </div>
                                    );
                                  })}
                                  {slabState.total > slabState.items.length && (
                                    <div className="invan-slabs-status">Showing {slabState.items.length} of {slabState.total} slabs.</div>
                                  )}
                                </div>
                              ) : slabState ? (
                                <div className="invan-slabs-status">No slabs found for this product under the current filters.</div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {groups.length > 0 && (
                <div className="invan-pagination-wrapper">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={(limit) => { setRowsPerPage(limit); setCurrentPage(1); }}
                    rowsPerPageOptions={[10, 20, 50, 100]}
                  />
                </div>
              )}
            </>
          )}

          {view === 'reorder' && (
            <>
              <div className="invan-filter-bar">
                <div className="invan-select-filter-wrap">
                  <Filter size={14} className="invan-filter-icon" />
                  <CustomSelect
                    value={velocityLocation}
                    onChange={(e) => setVelocityLocation(e.target.value)}
                    options={[{ value: 'All', label: 'All Locations' }, ...filterOptions.locations.map(l => ({ value: l, label: l }))]}
                  />
                </div>
              </div>
              <p className="invan-subtitle">
                Days of supply = available quantity ÷ daily sell-through rate from the most recent sales export for that product and location. "No sales data" means no matching sales import exists yet — it isn't the same as zero risk.
              </p>
              <div className={`invan-grid-wrapper${loadingVelocity && velocityRows.length > 0 ? ' invan-refetching' : ''}`}>
                {loadingVelocity && velocityRows.length === 0 ? (
                  <div className="invan-loading"><RefreshCw size={24} className="invan-spin-icon" /><span>Loading velocity analysis...</span></div>
                ) : velocityRows.length === 0 ? (
                  <div className="invan-empty-state">
                    <div className="invan-empty-icon-wrapper"><TrendingDown size={32} /></div>
                    <h4>No Sales History Imported Yet</h4>
                    <p>Import an SPS "Fast Moving Inventory" export to see reorder and velocity analysis.</p>
                    {canImport && (
                      <button type="button" className="invan-btn-import-empty" onClick={() => setImportModal('sales')}>
                        <Upload size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Import Sales History
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <table className="invan-table invan-velocity-table desktop-only">
                      <thead>
                        <tr>
                          <th className="h-vproduct">Product</th>
                          <th className="h-vlocation">Location</th>
                          <th className="h-vqty">Available Qty</th>
                          <th className="h-vsold">Sold in Period</th>
                          <th className="h-vvel">Velocity / Day</th>
                          <th className="h-vdays">Days of Supply</th>
                        </tr>
                      </thead>
                      <tbody>
                        {velocityRows.map((row, i) => (
                          <tr key={`${row.product}-${row.location}-${i}`}>
                            <td className="invan-col-product" title={row.product}>{row.product}</td>
                            <td title={row.location}>{row.location}</td>
                            <td>{fmtNum(row.availableQuantity)} {row.units}</td>
                            <td>{row.quantitySoldInPeriod !== null ? fmtNum(row.quantitySoldInPeriod) : '—'}</td>
                            <td>{row.velocityPerDay !== null ? row.velocityPerDay.toFixed(2) : '—'}</td>
                            <td>
                              {row.daysOfSupply !== null ? (
                                <span className={`invan-days-badge ${row.daysOfSupply < 30 ? 'low' : row.daysOfSupply < 60 ? 'medium' : 'good'}`}>
                                  {row.daysOfSupply < 30 && <AlertTriangle size={12} />}
                                  {Math.round(row.daysOfSupply)}d
                                </span>
                              ) : (
                                <span className="invan-days-badge unknown">No sales data</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="invan-mobile-cards mobile-only">
                      {velocityRows.map((row, i) => (
                        <div key={`${row.product}-${row.location}-${i}`} className="invan-card-mobile">
                          <div className="invan-card-top-row">
                            <span className="invan-card-title">{row.product}</span>
                            {row.daysOfSupply !== null ? (
                              <span className={`invan-days-badge ${row.daysOfSupply < 30 ? 'low' : row.daysOfSupply < 60 ? 'medium' : 'good'}`}>
                                {row.daysOfSupply < 30 && <AlertTriangle size={12} />}
                                {Math.round(row.daysOfSupply)}d
                              </span>
                            ) : (
                              <span className="invan-days-badge unknown">No sales data</span>
                            )}
                          </div>
                          <div className="invan-card-meta"><span>{row.location}</span></div>
                          <div className="invan-card-stat-grid">
                            <div><span className="invan-card-stat-label">Available</span><span>{fmtNum(row.availableQuantity)} {row.units}</span></div>
                            <div><span className="invan-card-stat-label">Sold in Period</span><span>{row.quantitySoldInPeriod !== null ? fmtNum(row.quantitySoldInPeriod) : '—'}</span></div>
                            <div><span className="invan-card-stat-label">Velocity / Day</span><span>{row.velocityPerDay !== null ? row.velocityPerDay.toFixed(2) : '—'}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}

      {importModal && (
        <InventoryImportModal
          type={importModal}
          onClose={() => setImportModal(null)}
          onComplete={handleImportComplete}
        />
      )}
    </div>
  );
};

export default InventoryAnalysisTab;
