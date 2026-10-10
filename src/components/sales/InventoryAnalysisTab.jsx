import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import {
  Boxes, Upload, RefreshCw, Search, Filter, Package, DollarSign,
  Layers, Clock, AlertTriangle, TrendingDown, ChevronRight
} from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { peekInventory, rememberInventory, clearInventoryCache } from '../../api/inventoryAnalysisCache';
import CustomSelect from '../shared/CustomSelect';
import LocationFilter from '../shared/LocationFilter';
import { useLocationsFilter } from '../shared/useLocationFilter';
import InventoryLocationField from './InventoryLocationField';
import { splitInventoryLocations, defaultInventoryLocations } from '../../utils/inventoryLocations';
import Pagination from '../shared/Pagination';
import { usePagination } from '../shared/paginationConfig';
import InventoryImportModal from './InventoryImportModal';
import { fmtMoney, fmtNum, ageDays, STATUS_ORDER, STATUS_LABEL, dominantStatus } from './inventoryFormat';
import InventorySlabList from './InventorySlabList';
import { CART, can } from '../../holds/permissions';
import './InventoryAnalysisTab.css';

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

// Fetched once per session and kept (src/api/inventoryAnalysisCache.js) until an
// import, so returning to this tab paints at once instead of loading again.
const PRESENCE_URL = `${API_URL}/api/inventory-analysis/summary`;
const FILTERS_URL = `${API_URL}/api/inventory-analysis/filters`;
const BRANCHES_URL = `${API_URL}/api/admin/locations`;

/** A fresh answer for `url`, remembered for next time. Throws on a failed request. */
const fetchInventoryJson = async (url) => {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  rememberInventory(url, data);
  return data;
};

const InventoryAnalysisTab = ({ currentUser = null, sidebarToggle = null, refreshSignal = 0 }) => {
  const [view, setView] = useState('stock'); // 'stock' | 'reorder'
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  // Tracked separately from `summary` (which reflects the active filters) so
  // that filtering down to zero matches shows "no matching items," not the
  // first-time "nothing has ever been imported" empty state.
  const [hasAnyInventory, setHasAnyInventory] = useState(() => {
    const remembered = peekInventory(PRESENCE_URL);
    return remembered === undefined ? null : (remembered.totalItems || 0) > 0;
  });

  // Stock Detail, grouped by product — one row per product with rolled-up
  // totals; slabsByProduct lazily holds each expanded product's individual
  // slabs, fetched only once a group is opened.
  const [groups, setGroups] = useState([]);
  const [groupsTotal, setGroupsTotal] = useState(0);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [expandedProducts, setExpandedProducts] = useState(() => new Set());
  const [slabsByProduct, setSlabsByProduct] = useState({});
  const { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage } = usePagination();

  const [filterOptions, setFilterOptions] = useState(() => peekInventory(FILTERS_URL) || { categories: [], locations: [], statuses: [] });
  const [search, setSearch] = useState('');
  // Fetches key off this, not `search` — typing stays instant in the box
  // while the network request waits for a pause, instead of firing (and
  // re-rendering the summary/table) on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  // Which locations' stock to show, for Stock Detail and Reorder Risk alike.
  // SPS's locations are Easy Stones' own warehouses plus ~90 fabricators
  // holding stock on consignment, so the filter lists them apart (Easy Stones
  // first) and opens on the person's home location if it has stock, otherwise
  // on every Easy Stones location that does — never on everything by accident
  // (src/utils/inventoryLocations.js). [] = every location.
  // `branches` is Users & Roles → Locations: what tells ours from consignment.
  const [branches, setBranches] = useState(() => peekInventory(BRANCHES_URL) || []);
  // No stock is fetched until the locations and branches have both arrived,
  // so the first load is already the right selection — not "everything"
  // first, replaced a moment later.
  const [filtersReady, setFiltersReady] = useState(() => peekInventory(FILTERS_URL) !== undefined && peekInventory(BRANCHES_URL) !== undefined);
  const locationGroups = useMemo(
    () => splitInventoryLocations(filterOptions.locations, branches),
    [filterOptions.locations, branches]
  );
  const defaultLocations = useMemo(
    () => defaultInventoryLocations(currentUser, filterOptions.locations, branches),
    [currentUser, filterOptions.locations, branches]
  );
  const [locationFilter, setLocationFilter] = useLocationsFilter('inventory', currentUser, filterOptions.locations, defaultLocations);
  const locationParam = locationFilter.join(',');
  const [statusFilter, setStatusFilter] = useState('All');

  const [velocityRows, setVelocityRows] = useState([]);
  const [loadingVelocity, setLoadingVelocity] = useState(false);

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
  // The cart column on slab rows (Cart & Holds, src/holds/).
  const canUseCart = can(currentUser, CART.USE);

  // Shared by fetchSummary and fetchItems so the summary cards/aging panel
  // always reflect the same search/category/location/status the Stock Detail
  // table is filtered to, rather than silently showing global totals.
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    if (categoryFilter !== 'All') params.set('category', categoryFilter);
    if (locationParam) params.set('location', locationParam);
    if (statusFilter !== 'All') params.set('status', statusFilter);
    return params;
  }, [debouncedSearch, categoryFilter, locationParam, statusFilter]);

  // Each fetch below remembers the newest request it sent and drops any
  // answer to an older one: when filters change faster than the server
  // answers, a slow reply for the previous filter (often the big unfiltered
  // one) used to land last and overwrite the right numbers.
  const summaryReqRef = useRef(0);
  const groupsReqRef = useRef(0);
  const velocityReqRef = useRef(0);

  // Each fetch below shows a remembered answer straight away when it has one
  // (no request, no loading state), and otherwise fetches and remembers it.
  const fetchSummary = useCallback(async () => {
    const reqId = ++summaryReqRef.current;
    const url = `${API_URL}/api/inventory-analysis/summary?${buildFilterParams().toString()}`;
    const remembered = peekInventory(url);
    if (remembered !== undefined) {
      setSummary(remembered);
      setLoadingSummary(false);
      return;
    }
    try {
      setLoadingSummary(true);
      const data = await fetchInventoryJson(url);
      if (reqId === summaryReqRef.current) setSummary(data);
    } catch (err) {
      console.error('Failed to fetch inventory summary:', err);
    } finally {
      if (reqId === summaryReqRef.current) setLoadingSummary(false);
    }
  }, [buildFilterParams]);

  // One-time, filter-independent check for whether an import has ever
  // happened at all — see hasAnyInventory's declaration above.
  const checkHasAnyInventory = useCallback(async () => {
    try {
      const data = peekInventory(PRESENCE_URL) ?? await fetchInventoryJson(PRESENCE_URL);
      setHasAnyInventory((data.totalItems || 0) > 0);
    } catch (err) {
      console.error('Failed to check inventory presence:', err);
    }
  }, []);

  const fetchFilterOptions = useCallback(async () => {
    const rememberedFilters = peekInventory(FILTERS_URL);
    const rememberedBranches = peekInventory(BRANCHES_URL);
    if (rememberedFilters !== undefined && rememberedBranches !== undefined) {
      setFilterOptions(rememberedFilters);
      setBranches(Array.isArray(rememberedBranches) ? rememberedBranches : []);
      setFiltersReady(true);
      return;
    }
    const [filtersRes, branchesRes] = await Promise.allSettled([
      rememberedFilters ?? fetchInventoryJson(FILTERS_URL),
      rememberedBranches ?? fetchInventoryJson(BRANCHES_URL)
    ]);
    if (filtersRes.status === 'fulfilled') setFilterOptions(filtersRes.value);
    else console.error('Failed to fetch inventory filters:', filtersRes.reason);
    if (branchesRes.status === 'fulfilled') setBranches(Array.isArray(branchesRes.value) ? branchesRes.value : []);
    else console.error('Failed to fetch branch list:', branchesRes.reason);
    // Ready either way: if a list failed, the filter still works, it just
    // can't tell our locations from consignment.
    setFiltersReady(true);
  }, []);

  const fetchGroups = useCallback(async () => {
    const reqId = ++groupsReqRef.current;
    const params = buildFilterParams();
    params.set('page', String(currentPage));
    params.set('limit', String(rowsPerPage));
    const url = `${API_URL}/api/inventory-analysis/items/grouped?${params.toString()}`;
    const remembered = peekInventory(url);
    if (remembered !== undefined) {
      setGroups(remembered.groups || []);
      setGroupsTotal(remembered.total || 0);
      setLoadingGroups(false);
      return;
    }
    try {
      setLoadingGroups(true);
      const data = await fetchInventoryJson(url);
      if (reqId !== groupsReqRef.current) return;
      setGroups(data.groups || []);
      setGroupsTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch grouped inventory:', err);
    } finally {
      if (reqId === groupsReqRef.current) setLoadingGroups(false);
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
      const url = `${API_URL}/api/inventory-analysis/items?${params.toString()}`;
      const data = peekInventory(url) ?? await fetchInventoryJson(url);
      setSlabsByProduct(prev => ({ ...prev, [product]: { items: data.items || [], total: data.total || 0, loading: false, error: false } }));
    } catch (err) {
      console.error('Failed to fetch slabs for product:', err);
      setSlabsByProduct(prev => ({ ...prev, [product]: { items: [], total: 0, loading: false, error: true } }));
    }
  }, [buildFilterParams]);

  const fetchVelocity = useCallback(async () => {
    const reqId = ++velocityReqRef.current;
    const params = new URLSearchParams();
    if (locationParam) params.set('location', locationParam);
    const url = `${API_URL}/api/inventory-analysis/velocity?${params.toString()}`;
    const remembered = peekInventory(url);
    if (remembered !== undefined) {
      setVelocityRows(remembered.rows || []);
      setLoadingVelocity(false);
      return;
    }
    try {
      setLoadingVelocity(true);
      const data = await fetchInventoryJson(url);
      if (reqId === velocityReqRef.current) setVelocityRows(data.rows || []);
    } catch (err) {
      console.error('Failed to fetch inventory velocity:', err);
    } finally {
      if (reqId === velocityReqRef.current) setLoadingVelocity(false);
    }
  }, [locationParam]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Layout effects, so a remembered answer is on screen in the first frame
  // when someone returns to this tab — no flash of the loading state.
  useLayoutEffect(() => { fetchFilterOptions(); }, [fetchFilterOptions]);
  useLayoutEffect(() => { checkHasAnyInventory(); }, [checkHasAnyInventory]);
  useLayoutEffect(() => { if (filtersReady) fetchSummary(); }, [filtersReady, fetchSummary]);
  useLayoutEffect(() => { if (filtersReady && view === 'stock') fetchGroups(); }, [filtersReady, view, fetchGroups]);
  useLayoutEffect(() => { if (filtersReady && view === 'reorder') fetchVelocity(); }, [filtersReady, view, fetchVelocity]);
  useEffect(() => { resetPage(); }, [resetPage, debouncedSearch, categoryFilter, locationParam, statusFilter]);
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
  // so an import applied from another tab/user (see src/routes/inventoryAnalysis.js's
  // 'inventory_analysis_update' emit) refreshes this screen the same way
  // finishing an import locally does.
  const refreshAll = useCallback(() => {
    // New data was imported: nothing remembered is current any more.
    clearInventoryCache();
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
  // Acts only when it has actually moved since this tab last looked — not on
  // mount, where the fetches above already ran. This used to skip "the first
  // run" instead, which React's development double-mount defeated: every
  // visit wiped the remembered answers and loaded everything again. (An
  // import while this tab was closed has already cleared them — SalesPage.)
  const seenRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === seenRefreshSignal.current) return;
    seenRefreshSignal.current = refreshSignal;
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
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    options={[
                      { value: 'All', label: 'All Statuses' },
                      { value: 'available', label: 'Available (no hold/SO/transfer)' },
                      ...filterOptions.statuses.map(s => ({ value: s, label: s }))
                    ]}
                  />
                </div>
                <LocationFilter
                  wide
                  active={locationFilter.length > 0}
                  onClear={() => setLocationFilter([])}
                >
                  <InventoryLocationField
                    company={locationGroups.company}
                    consignment={locationGroups.consignment}
                    value={locationFilter}
                    onChange={setLocationFilter}
                    user={currentUser}
                  />
                </LocationFilter>
              </div>

              {/* One card for the stock list and its pager — the pager is the
                  card's bottom row, like the Customer List's (.invan-list-card). */}
              <div className="invan-list-card">
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
                                <InventorySlabList
                                  items={slabState.items}
                                  total={slabState.total}
                                  canViewPrices={canViewPrices}
                                  canUseCart={canUseCart}
                                />
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
                    onRowsPerPageChange={setRowsPerPage}
                    totalCount={groupsTotal}
                  />
                </div>
              )}
              </div>
            </>
          )}

          {view === 'reorder' && (
            <>
              <div className="invan-filter-bar">
                <LocationFilter
                  wide
                  active={locationFilter.length > 0}
                  onClear={() => setLocationFilter([])}
                >
                  <InventoryLocationField
                    company={locationGroups.company}
                    consignment={locationGroups.consignment}
                    value={locationFilter}
                    onChange={setLocationFilter}
                    user={currentUser}
                  />
                </LocationFilter>
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
