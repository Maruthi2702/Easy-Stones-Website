import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    Search, Plus, Download, Upload, Mail, X, Wrench, Users, MoreHorizontal, SlidersHorizontal,
    ChevronDown, AlertTriangle, LayoutList
} from 'lucide-react';
import SidebarToggleButton from '../shared/SidebarToggleButton';
import Pagination from '../shared/Pagination';
import { DEFAULT_ROWS_PER_PAGE } from '../shared/paginationConfig';
import AddCustomerModal from './AddCustomerModal';
import CustomerImportModal from '../admin/CustomerImportModal';
import { useAuth } from '../../context/AuthContext';
import { toSalesRepList } from '../../utils/salesReps';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import * as XLSX from 'xlsx';
import { formatPhoneForDisplay } from '../../utils/phoneUtils';
import {
    STATUSES, statusMeta, SAVED_VIEWS, scopedFilterOptions, groupRepsByLocation, emailListFor,
    primaryEmailOf, cityLineOf, streetOf, locationOf
} from '../../utils/customerList';
import CustomerTable from './customerList/CustomerTable';
import CustomerRowList from './customerList/CustomerRowList';
import CustomerDrawer from './customerList/CustomerDrawer';
import BulkBar from './customerList/BulkBar';
import LogCallSheet from './customerList/LogCallSheet';
import { canAddVisit } from '../../utils/visitAccess';
import { useLocationsFilter } from '../shared/useLocationFilter';
import { FilterDropdown } from './customerList/parts';
import { useDismiss, copyText } from './customerList/uiHelpers';
// Kept for the add/edit modal and the classes other sales screens share with it
// (.location-badge tints, status pills); the list itself is styled by CustomerList.css.
import './PartnersSheet.css';
import './customerList/CustomerList.css';

// Filtering on a rep is only half the question — "who has nobody yet" is the
// other half, and it is the list someone works through to clear the backlog.
const UNASSIGNED = 'unassigned';

const TABS = [
    { key: 'fabricators', label: 'Fabricators', icon: Wrench, hint: 'Fabricators are pricing-eligible and buy direct' },
    { key: 'partners', label: 'Partners', icon: Users, hint: 'Contractors, dealers, designers and more' },
];

const LEVELS = ['Level - 1', 'Level - 2', 'Level - 3', 'Level - 4'];
const PARTNER_TYPES = ['Contractor', 'Dealer', 'Floor Covering', 'Designer', 'Builder', 'Fabricator'];
const MODA_OPTIONS = [
    { value: 'display', label: 'Has display' },
    { value: 'noDisplay', label: 'No display' },
    { value: 'binders', label: 'Has binders' },
    { value: 'noBinders', label: 'No binders' }
];
const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const SORTS = [
    { value: 'company:asc', label: 'Company A–Z' },
    { value: 'company:desc', label: 'Company Z–A' },
    { value: 'level:asc', label: 'Level 1 → 4' },
    { value: 'city:asc', label: 'City' },
    { value: 'salesRep:asc', label: 'Sales rep' },
    { value: 'location:asc', label: 'Location' }
];

// Global in-memory cache to prevent re-fetching on tab switches & re-mounts.
// Cleared on every write (see clearListCache) — it has no expiry of its own.
const globalPartnersCache = {};
const clearListCache = () => { Object.keys(globalPartnersCache).forEach(k => delete globalPartnersCache[k]); };

const useWindowWidth = () => {
    const [w, setW] = useState(() => window.innerWidth);
    useEffect(() => {
        const onResize = () => setW(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return w;
};

/** Saved-view picker — first control in the filter row (and the narrow-screen bar). */
const ViewPicker = ({ view, counts, onChange }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useDismiss(open, setOpen, ref);
    const current = SAVED_VIEWS.find(v => v.key === view);
    return (
        <div className="cl-dd" ref={ref}>
            <button type="button" className={`cl-dd-btn${current ? ' set' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
                <LayoutList size={14} aria-hidden="true" />
                <span className="lbl">{current ? current.label : 'All customers'}</span>
                {current && counts[current.key] !== undefined && <span style={{ opacity: 0.75, fontSize: 11.5 }}>{counts[current.key]}</span>}
                <ChevronDown size={14} aria-hidden="true" />
            </button>
            {open && (
                <div className="cl-pop" role="menu">
                    <button type="button" role="menuitemradio" aria-checked={!view} className="cl-opt" onClick={() => { setOpen(false); onChange(''); }}>All customers</button>
                    {SAVED_VIEWS.map(v => (
                        <button key={v.key} type="button" role="menuitemradio" aria-checked={view === v.key} className="cl-opt" onClick={() => { setOpen(false); onChange(v.key); }}>
                            {v.warn && <AlertTriangle size={14} style={{ color: 'var(--cl-warn)' }} aria-hidden="true" />}
                            {v.label}
                            {counts[v.key] !== undefined && <span className="n">{counts[v.key]}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const PartnersSheet = ({ onSelectCustomer, onToggleSidebar, isSidebarOpen, customerRefreshTrigger, onPlanRoute }) => {
    const { user } = useAuth();
    const width = useWindowWidth();
    const narrow = width < 900;   // list rows + slide-over instead of table + side drawer
    // Phones open the same details panel as iPad and laptop (full screen there),
    // with Open profile inside it — they used to skip straight to the profile,
    // so a phone never saw the panel (changed 2026-10-06 at the owner's ask).
    const phone = width < 600;
    const isMobile = width <= 1024; // the sales layout's own sidebar breakpoint

    const canEdit = !!user?.permissions?.includes('manage_customers');
    const canDelete = canEdit || !!user?.permissions?.includes('delete_customers');

    const [activeTab, setActiveTab] = useState('fabricators');
    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [editingPartner, setEditingPartner] = useState(null);
    const [viewingPartner, setViewingPartner] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [showFilterSheet, setShowFilterSheet] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef(null);
    useDismiss(moreOpen, setMoreOpen, moreRef);

    // Filters. Saved views and the A–Z letter are presets on top of these.
    const [filterLevels, setFilterLevels] = useState([]);
    const [filterTypes, setFilterTypes] = useState([]);
    const [filterCities, setFilterCities] = useState([]);
    const [filterStatuses, setFilterStatuses] = useState([]);
    const [filterSalesReps, setFilterSalesReps] = useState([]);
    // filterLocations is further down, once `scoped` says which locations are offered.
    const [filterModa, setFilterModa] = useState([]);
    const [view, setView] = useState('');
    const [letter, setLetter] = useState('');
    const [viewCounts, setViewCounts] = useState({});
    const [countsNonce, setCountsNonce] = useState(0);

    const [uniqueCities, setUniqueCities] = useState([]);
    const [salesReps, setSalesReps] = useState([]);
    const [locations, setLocations] = useState([]);

    const [currentPage, setCurrentPage] = useState(() => parseInt(new URLSearchParams(window.location.search).get('p'), 10) || 1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [limit, setLimit] = useState(DEFAULT_ROWS_PER_PAGE);
    const [sortBy, setSortBy] = useState('level');
    const [sortOrder, setSortOrder] = useState('asc');

    // Selection persists across pages, so keep the rows themselves for copy/export.
    const [selected, setSelected] = useState(() => new Map());
    const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkMessage, setBulkMessage] = useState('');
    const [notice, setNotice] = useState('');

    const [openCustomer, setOpenCustomer] = useState(null);
    const [focusIndex, setFocusIndex] = useState(-1);

    const rootRef = useRef(null);
    const searchRef = useRef(null);

    // "Log this call?": a Call tapped on a phone is remembered (sessionStorage,
    // so it survives the browser being backgrounded or reloaded for the call),
    // and when the person comes back to the app they're asked to log it.
    const canLogCalls = canAddVisit(user);
    const [logCallFor, setLogCallFor] = useState(null);
    const rememberCall = (row) => {
        if (!canLogCalls || !row?._id) return;
        try {
            sessionStorage.setItem('cl.pendingCall', JSON.stringify({
                at: Date.now(),
                customer: { _id: row._id, company: row.company, contactName: row.contactName, name: row.name }
            }));
        } catch { /* private mode: no prompt, the call itself still works */ }
    };
    useEffect(() => {
        if (!canLogCalls) return undefined;
        const check = () => {
            if (document.visibilityState !== 'visible') return;
            let pending = null;
            try { pending = JSON.parse(sessionStorage.getItem('cl.pendingCall') || 'null'); } catch { pending = null; }
            if (!pending?.customer?._id) return;
            const elapsed = Date.now() - (pending.at || 0);
            // Ignore the instant the dialer hands back without a call, and anything stale.
            if (elapsed < 3000) return;
            try { sessionStorage.removeItem('cl.pendingCall'); } catch { /* ignore */ }
            if (elapsed <= 2 * 60 * 60 * 1000) setLogCallFor(pending.customer);
        };
        document.addEventListener('visibilitychange', check);
        window.addEventListener('focus', check);
        return () => {
            document.removeEventListener('visibilitychange', check);
            window.removeEventListener('focus', check);
        };
    }, [canLogCalls]);

    useEffect(() => {
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('p', currentPage);
        window.history.replaceState(window.history.state, '', newUrl);
    }, [currentPage]);

    useEffect(() => {
        const handlePopState = () => setCurrentPage(parseInt(new URLSearchParams(window.location.search).get('p'), 10) || 1);
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        if (!notice) return undefined;
        const t = setTimeout(() => setNotice(''), 3500);
        return () => clearTimeout(t);
    }, [notice]);

    useEffect(() => {
        if (!bulkMessage) return undefined;
        const t = setTimeout(() => setBulkMessage(''), 3000);
        return () => clearTimeout(t);
    }, [bulkMessage]);

    // Pickers: cities, the staff who can own an account, and the branches.
    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/customers/cities`);
                if (res.ok) setUniqueCities((await res.json()) || []);
            } catch (err) { console.error('Error fetching unique cities:', err); }
        })();
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/salesreps`);
                if (res.ok) setSalesReps(toSalesRepList(await res.json()));
            } catch (err) { console.error('Error fetching sales reps:', err); }
        })();
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/admin/locations`);
                if (!res.ok) return;
                const data = await res.json();
                setLocations((data || []).map(l => l.name).filter(Boolean));
            } catch (err) { console.error('Error fetching locations:', err); }
        })();
    }, []);

    // What this person is offered in the Rep and Location filters (by the
    // Visits view rule) — not what they're allowed to see; the list isn't scoped.
    const scoped = useMemo(() => scopedFilterOptions({ user, salesReps, locations }), [user, salesReps, locations]);
    // Opens with just their home location ticked ([] = every location), like
    // every other location filter — see useLocationFilter.js.
    const [filterLocations, setFilterLocations] = useLocationsFilter('customerList', user, scoped.locations);
    const repOptions = useMemo(() => [
        { group: null, options: [{ value: UNASSIGNED, label: 'Unassigned' }] },
        ...groupRepsByLocation(scoped.reps).map(g => ({
            group: g.location,
            options: g.reps.map(r => ({ value: r._id, label: String(r._id) === String(user?.id) ? `${r.name} (you)` : r.name }))
        }))
    ], [scoped.reps, user?.id]);
    const repNote = scoped.scope === 'all' ? null : 'Only the reps your role can see are listed.';
    const locationNote = scoped.scope === 'all' ? null : 'Only the locations you have access to in Users & Roles are listed.';

    // ── Query ────────────────────────────────────────────────────────────────
    const listParams = useCallback(() => {
        const p = { sortBy, sortOrder };
        if (debouncedSearch) p.search = debouncedSearch;
        if (filterLevels.length) p.level = filterLevels.join(',');
        if (filterTypes.length) p.type = filterTypes.join(',');
        if (filterCities.length) p.city = filterCities.join(',');
        if (filterStatuses.length) p.status = filterStatuses.join(',');
        if (filterSalesReps.length) p.salesRep = filterSalesReps.join(',');
        if (filterLocations.length) p.location = filterLocations.join(',');
        if (filterModa.length) p.moda = filterModa.join(',');
        if (view) p.view = view;
        if (letter) p.letter = letter;
        // The tab scopes the list, except while searching (a search finds the
        // customer whichever tab it's on) or when types were picked explicitly.
        if (!debouncedSearch && !filterTypes.length) {
            if (activeTab === 'fabricators') p.type = 'Fabricator';
            else p.typeExclude = 'Fabricator';
        }
        return p;
    }, [sortBy, sortOrder, debouncedSearch, filterLevels, filterTypes, filterCities, filterStatuses, filterSalesReps, filterLocations, filterModa, view, letter, activeTab]);

    const urlFor = (params) => {
        const url = new URL(`${API_URL}/api/customers/list`, window.location.origin);
        Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
        return url;
    };

    const requestSeq = useRef(0);
    const fetchPartners = useCallback(async ({ skipCache = false } = {}) => {
        const params = { ...listParams(), page: currentPage, limit };
        const cacheKey = JSON.stringify(params);
        const seq = ++requestSeq.current;
        const cached = globalPartnersCache[cacheKey];
        if (cached) {
            setPartners(cached.partners || []);
            setTotalPages(cached.totalPages || 1);
            setTotalCount(cached.totalCount || 0);
            setLoading(false);
            if (!skipCache) return;
        } else {
            setLoading(true);
        }
        try {
            const response = await authFetch(urlFor(params));
            if (seq !== requestSeq.current) return; // a newer request has started; ignore this one
            if (response.ok) {
                const data = await response.json();
                if (seq !== requestSeq.current) return;
                globalPartnersCache[cacheKey] = data;
                setPartners(data.partners || []);
                setTotalPages(data.totalPages || 1);
                setTotalCount(data.totalCount || 0);
                setLoadError('');
            } else {
                setLoadError('Could not load customers. Try again.');
            }
        } catch (error) {
            console.error('Error fetching partners:', error);
            if (seq === requestSeq.current) setLoadError('Could not load customers. Check your connection and try again.');
        } finally {
            if (seq === requestSeq.current) setLoading(false);
        }
    }, [listParams, currentPage, limit]);

    useEffect(() => { fetchPartners(); }, [fetchPartners, customerRefreshTrigger]);

    const refreshAll = useCallback(() => {
        clearListCache();
        setCountsNonce(n => n + 1);
        fetchPartners({ skipCache: true });
    }, [fetchPartners]);

    // A change made elsewhere (the profile's status picker) while this list sits
    // mounted-but-hidden behind it would otherwise come back from the cache stale.
    useEffect(() => {
        window.addEventListener('customers:changed', refreshAll);
        return () => window.removeEventListener('customers:changed', refreshAll);
    }, [refreshAll]);

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/customers/view-counts?tab=${activeTab}`);
                if (res.ok && live) setViewCounts(await res.json());
            } catch { /* counts are a nicety; the views still work without them */ }
        })();
        return () => { live = false; };
    }, [activeTab, customerRefreshTrigger, countsNonce]);

    useEffect(() => {
        if (searchTerm === debouncedSearch) return undefined;
        const timer = setTimeout(() => { setDebouncedSearch(searchTerm); setCurrentPage(1); }, 400);
        return () => clearTimeout(timer);
    }, [searchTerm, debouncedSearch]);

    // Keep the open drawer and keyboard focus pointing at rows that exist.
    useEffect(() => { setFocusIndex(-1); }, [partners]);

    const resetPage = () => setCurrentPage(1);
    const withReset = (setter) => (v) => { setter(v); resetPage(); };

    const handleTabChange = (tabKey) => {
        setActiveTab(tabKey);
        setSearchTerm(''); setDebouncedSearch('');
        // Location is kept: it's which branch you're working in, not a
        // filter on this tab's list.
        setFilterLevels([]); setFilterTypes([]); setFilterCities([]); setFilterStatuses([]);
        setFilterSalesReps([]); setFilterModa([]);
        setView(''); setLetter('');
        setSelected(new Map());
        setOpenCustomer(null);
        resetPage();
    };

    const clearFilters = () => {
        setFilterLevels([]); setFilterTypes([]); setFilterCities([]); setFilterStatuses([]);
        setFilterSalesReps([]); setFilterLocations([]); setFilterModa([]);
        setView(''); setLetter('');
        resetPage();
    };
    const activeFilterCount = filterLevels.length + filterTypes.length + filterCities.length + filterStatuses.length
        + filterSalesReps.length + filterLocations.length + filterModa.length + (letter ? 1 : 0);

    const handleSort = (field) => {
        if (sortBy === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        else { setSortBy(field); setSortOrder('asc'); }
        resetPage();
    };

    // ── Writes ───────────────────────────────────────────────────────────────
    const handleSavePartner = async (formData, closeModal) => {
        setIsSaving(true);
        try {
            const method = editingPartner ? 'PUT' : 'POST';
            const url = editingPartner ? `${API_URL}/api/customers/${editingPartner._id}` : `${API_URL}/api/customers`;
            const leadData = {
                ...formData,
                contactName: formData.customerName,
                name: formData.customerName,
                city: formData.address?.city || '',
                quickNote: formData.notes
            };
            const response = await authFetch(url, { method, body: JSON.stringify(leadData) });
            if (response.ok) {
                const saved = await response.json().catch(() => null);
                refreshAll();
                closeModal();
                setEditingPartner(null);
                setViewingPartner(null);
                if (saved && openCustomer && saved._id === openCustomer._id) setOpenCustomer(saved);
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.error('Server error saving lead:', errorData);
                alert(errorData.message || 'Failed to save customer');
            }
        } catch (error) {
            console.error('Error saving lead:', error);
            alert('Failed to save customer. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    // Resolves true once the customer is gone (the Edit form closes on that).
    const handleDeletePartner = async (id) => {
        if (!window.confirm('Are you sure you want to delete this customer?')) return false;
        try {
            const response = await authFetch(`${API_URL}/api/customers/${id}`, { method: 'DELETE' });
            if (response.ok) {
                if (openCustomer?._id === id) setOpenCustomer(null);
                setSelected(prev => { const next = new Map(prev); next.delete(id); return next; });
                refreshAll();
                return true;
            }
            const errorData = await response.json().catch(() => ({}));
            alert(errorData.message || 'Failed to delete customer');
        } catch (error) {
            console.error('Error deleting customer:', error);
            alert('An error occurred while deleting the customer');
        }
        return false;
    };

    const handleStatusChange = async (id, status) => {
        try {
            const res = await authFetch(`${API_URL}/api/customers/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
            if (!res.ok) return false;
            setPartners(list => list.map(p => (p._id === id ? { ...p, status } : p)));
            setOpenCustomer(c => (c && c._id === id ? { ...c, status } : c));
            clearListCache();
            setCountsNonce(n => n + 1);
            return true;
        } catch {
            return false;
        }
    };

    // ── Export / copy ────────────────────────────────────────────────────────
    const exportRows = (rows, sheetName) => {
        const worksheet = XLSX.utils.json_to_sheet(rows.map(l => ({
            Company: l.company || '-',
            Name: l.contactName || l.name || '-',
            Email: l.email || '-',
            Phone: formatPhoneForDisplay(l.phone),
            Street: streetOf(l) || '-',
            City: cityLineOf(l) || l.city || '-',
            Status: l.status || '-',
            'Sales Rep': l.salesRepName || 'Unassigned',
            Location: locationOf(l),
            Level: l.level || '-',
            Type: l.customerType || 'Fabricator',
            'Moda Display': l.modaDisplay || 'No',
            'Moda Binders': l.modaBinder || '0',
            Notes: l.notes || l.quickNote || '-',
            Created: l.createdAt ? new Date(l.createdAt).toLocaleDateString() : '-'
        })));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        XLSX.writeFile(workbook, `${sheetName}_List_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const fetchAllMatching = async () => {
        const res = await authFetch(urlFor({ ...listParams(), limit: -1 }));
        if (!res.ok) throw new Error('fetch failed');
        return (await res.json()).partners || [];
    };

    const exportToExcel = async () => {
        try {
            exportRows(await fetchAllMatching(), activeTab === 'fabricators' ? 'Fabricators' : 'Partners');
        } catch (error) {
            console.error('Error exporting:', error);
            alert('Failed to export data');
        }
    };

    // Marketing list for everything matching the filters: skips accounts with
    // another rep and anyone who opted out, and prefers the marketing address.
    const emailAllContacts = async () => {
        setMoreOpen(false);
        try {
            const eligible = (await fetchAllMatching()).filter(p => p.status !== 'Different Sales Person' && p.receiveMarketing !== false);
            const emails = [...new Set(eligible
                .map(p => (p.marketingEmail && p.marketingEmail.trim() ? p.marketingEmail.trim() : primaryEmailOf(p)))
                .filter(Boolean))];
            if (emails.length === 0) { alert('No eligible marketing email addresses found for the current filters.'); return; }
            await copyText(emails.join('; '));
            setNotice(`Copied ${emails.length} marketing email addresses — paste them into Outlook's To or Bcc.`);
        } catch (error) {
            console.error('Error copying emails:', error);
            alert('Failed to copy emails');
        }
    };

    // ── Selection + bulk ─────────────────────────────────────────────────────
    const toggleRow = (id) => setSelected(prev => {
        const next = new Map(prev);
        if (next.has(id)) next.delete(id);
        else { const row = partners.find(p => p._id === id); if (row) next.set(id, row); }
        return next;
    });
    const toggleAll = (on) => setSelected(prev => {
        const next = new Map(prev);
        partners.forEach(p => (on ? next.set(p._id, p) : next.delete(p._id)));
        return next;
    });
    const selectedRows = useMemo(() => [...selected.values()], [selected]);

    const bulkPatch = async (body, describe) => {
        setBulkBusy(true);
        try {
            const res = await authFetch(`${API_URL}/api/customers/bulk`, {
                method: 'PATCH',
                body: JSON.stringify({ ids: [...selected.keys()], ...body })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { alert(data.message || 'Could not update the selected customers'); return; }
            setBulkMessage(describe(data.modified ?? selected.size));
            refreshAll();
        } catch {
            alert('Could not update the selected customers');
        } finally {
            setBulkBusy(false);
        }
    };

    const bulkCopyEmails = async () => {
        const list = emailListFor(selectedRows);
        if (!list) { setBulkMessage('No email addresses on the selected customers'); return; }
        await copyText(list);
        setBulkMessage(`Copied ${list.split('; ').length} emails`);
    };

    // ── Opening customers ────────────────────────────────────────────────────
    const openProfile = (row) => { setOpenCustomer(null); onSelectCustomer && onSelectCustomer(row); };
    const openRow = (row, index) => {
        setOpenCustomer(row);
        if (index !== undefined) setFocusIndex(index);
    };
    const openIndex = openCustomer ? partners.findIndex(p => p._id === openCustomer._id) : -1;

    // Keyboard: / search, ↑↓ move, Enter open, Esc close. Only while this list
    // is the one on screen — SalesPage keeps it mounted (hidden) behind a profile.
    useEffect(() => {
        const onKey = (e) => {
            if (!rootRef.current || rootRef.current.offsetParent === null) return;
            if (showAddModal || showImportModal || showFilterSheet) return;
            const tag = (e.target.tagName || '').toLowerCase();
            const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
            if (e.key === 'Escape') {
                if (openCustomer) { setOpenCustomer(null); return; }
                if (typing && e.target === searchRef.current) { searchRef.current.blur(); }
                return;
            }
            if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
            if (narrow || !partners.length) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const from = focusIndex >= 0 ? focusIndex : (openIndex >= 0 ? openIndex : -1);
                const next = Math.max(0, Math.min(partners.length - 1, from + (e.key === 'ArrowDown' ? 1 : -1)));
                setFocusIndex(next);
                if (openCustomer) setOpenCustomer(partners[next]);
            } else if (e.key === 'Enter' && focusIndex >= 0 && partners[focusIndex]) {
                e.preventDefault();
                setOpenCustomer(partners[focusIndex]);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [partners, focusIndex, openIndex, openCustomer, narrow, showAddModal, showImportModal, showFilterSheet]);

    const isFabTab = activeTab === 'fabricators';
    const showType = !isFabTab || !!debouncedSearch || filterTypes.length > 0;
    const currentTab = TABS.find(t => t.key === activeTab);
    const nothingMatches = !loading && !loadError && partners.length === 0;
    const anyNarrowing = activeFilterCount > 0 || !!view || !!debouncedSearch;

    // ── Filter controls (shared by the bar and the phone sheet) ──────────────
    const filterControls = (
        <>
            <FilterDropdown
                label="Status"
                allLabel="Status: All"
                options={STATUSES.map(s => ({ value: s, label: s, dot: statusMeta(s).tone }))}
                selected={filterStatuses}
                onChange={withReset(setFilterStatuses)}
            />
            <FilterDropdown
                label="Rep"
                allLabel="Sales rep"
                options={repOptions}
                selected={filterSalesReps}
                onChange={withReset(setFilterSalesReps)}
                searchable
                note={repNote}
                renderValue={(sel, labelOf) => (sel.length === 1 ? labelOf(sel[0]) : `${sel.length} reps`)}
            />
            {scoped.locations.length > 0 && (
                <FilterDropdown
                    label="Location"
                    options={scoped.locations.map(l => ({ value: l, label: l }))}
                    selected={filterLocations}
                    onChange={withReset(setFilterLocations)}
                    note={locationNote}
                />
            )}
            <FilterDropdown label="City" options={uniqueCities.map(c => ({ value: c, label: c }))} selected={filterCities} onChange={withReset(setFilterCities)} searchable />
            <FilterDropdown label="Level" options={LEVELS.map(l => ({ value: l, label: l }))} selected={filterLevels} onChange={withReset(setFilterLevels)} />
            {!isFabTab && (
                <FilterDropdown label="Type" options={PARTNER_TYPES.map(t => ({ value: t, label: t }))} selected={filterTypes} onChange={withReset(setFilterTypes)} />
            )}
            <FilterDropdown label="Moda Resources" options={MODA_OPTIONS} selected={filterModa} onChange={withReset(setFilterModa)} align="right" />
        </>
    );

    const viewPicker = <ViewPicker view={view} counts={viewCounts} onChange={(v) => { setView(v); resetPage(); }} />;
    const letterChip = letter && (
        <button type="button" className="cl-dd-btn set" onClick={() => { setLetter(''); resetPage(); }} aria-label={`Clear starts-with ${letter}`}>
            Starts with {letter} <X size={13} aria-hidden="true" />
        </button>
    );
    const clearAll = (activeFilterCount > 0 || view) && (
        <button type="button" className="cl-btn sm" style={{ border: 0, background: 'none', color: 'var(--cl-gold-ink)' }} onClick={clearFilters}>Clear all</button>
    );

    const sheetSort = (
        <label className="cl-dd" style={{ display: 'block' }}>
            <span className="cl-sr">Sort by</span>
            <select
                className="cl-dd-btn"
                style={{ width: '100%', height: 44 }}
                value={`${sortBy}:${sortOrder}`}
                onChange={(e) => { const [by, order] = e.target.value.split(':'); setSortBy(by); setSortOrder(order); resetPage(); }}
            >
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
        </label>
    );

    const azStrip = (
        <nav className="cl-az" aria-label="Jump to letter">
            {LETTERS.map(l => (
                <button
                    key={l}
                    type="button"
                    aria-pressed={letter === l}
                    aria-label={l === '#' ? 'Names starting with a number or symbol' : `Names starting with ${l}`}
                    onClick={() => { setLetter(letter === l ? '' : l); if (sortBy !== 'company') { setSortBy('company'); setSortOrder('asc'); } resetPage(); }}
                >{l}</button>
            ))}
        </nav>
    );

    const emptyState = (
        <div className="cl-empty">
            <span className="cl-empty-ic"><Search size={26} aria-hidden="true" /></span>
            <h3>{anyNarrowing ? 'No customers match these filters' : `No ${isFabTab ? 'fabricators' : 'partners'} yet`}</h3>
            <p>{anyNarrowing ? 'Try removing a filter, or search all customers.' : 'Add your first customer to get started.'}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                {anyNarrowing && <button type="button" className="cl-btn" onClick={() => { clearFilters(); setSearchTerm(''); setDebouncedSearch(''); }}><X size={15} aria-hidden="true" />Clear filters</button>}
                <button type="button" className="cl-btn gold" onClick={() => { setEditingPartner(null); setViewingPartner(null); setShowAddModal(true); }}><Plus size={16} aria-hidden="true" />Add customer</button>
            </div>
        </div>
    );

    const pager = (
        <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalCount={totalCount}
            rowsPerPage={limit}
            onPageChange={(p) => setCurrentPage(Math.max(1, Math.min(totalPages, p)))}
            onRowsPerPageChange={(n) => { setLimit(n); resetPage(); }}
        >
            {(!!openCustomer || focusIndex >= 0) && (
                <span className="cl-keys cl-hide-narrow" aria-hidden="true">
                    <span className="cl-kbd">↑</span><span className="cl-kbd">↓</span> move
                    <span className="cl-kbd">Enter</span> open <span className="cl-kbd">Esc</span> close <span className="cl-kbd">/</span> search
                </span>
            )}
        </Pagination>
    );

    return (
        <div className="partners-sheet-container cl" ref={rootRef}>
            {/* ── Header ── */}
            <div className="cl-hdr">
                {(!isSidebarOpen || isMobile) && onToggleSidebar && (
                    <SidebarToggleButton isOpen={isSidebarOpen} onClick={onToggleSidebar} />
                )}
                <h2>Customers</h2>
                {!loading && <span className="cl-count" aria-label={`${totalCount} customers`}>{totalCount}</span>}
                <span className="cl-grow" />
                <label className="cl-search">
                    <Search size={17} aria-hidden="true" />
                    <input
                        ref={searchRef}
                        type="search"
                        placeholder={phone ? 'Search customers' : 'Search company, contact, phone, email or address'}
                        aria-label="Search customers"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm
                        ? <button type="button" className="cl-ib" style={{ width: 26, height: 26 }} onClick={() => setSearchTerm('')} aria-label="Clear search"><X size={14} /></button>
                        : <kbd className="cl-kbd cl-hide-narrow">/</kbd>}
                </label>
                <button type="button" className="cl-btn cl-hide-narrow" onClick={exportToExcel}><Download size={16} aria-hidden="true" />Export</button>
                <div className="cl-rowmenu" ref={moreRef}>
                    <button type="button" className="cl-ib box" aria-label="More actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>
                        <MoreHorizontal size={18} />
                    </button>
                    {moreOpen && (
                        <div className="cl-pop right" role="menu" style={{ minWidth: 250 }}>
                            <button type="button" role="menuitem" className="cl-opt cl-only-narrow" onClick={() => { setMoreOpen(false); exportToExcel(); }}><Download size={16} aria-hidden="true" />Export to Excel</button>
                            <button type="button" role="menuitem" className="cl-opt" onClick={emailAllContacts}><Mail size={16} aria-hidden="true" />Copy marketing emails</button>
                            {canEdit && (
                                <button type="button" role="menuitem" className="cl-opt" onClick={() => { setMoreOpen(false); setShowImportModal(true); }}><Upload size={16} aria-hidden="true" />Import from Excel</button>
                            )}
                        </div>
                    )}
                </div>
                <button type="button" className="cl-btn gold cl-hide-phone" onClick={() => { setEditingPartner(null); setViewingPartner(null); setShowAddModal(true); }}>
                    <Plus size={17} aria-hidden="true" />Add customer
                </button>
            </div>

            {/* ── Tabs + views/filters ── */}
            <div className="cl-tabs cl-tabs-filters">
                <div role="tablist" aria-label="Customer type" style={{ display: 'flex', gap: 18 }}>
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const on = activeTab === tab.key;
                        return (
                            <button key={tab.key} type="button" role="tab" aria-selected={on} className="cl-tab" title={tab.hint} onClick={() => handleTabChange(tab.key)}>
                                <Icon size={15} aria-hidden="true" />{tab.label}
                                {on && !loading && <span className="n">{totalCount}</span>}
                            </button>
                        );
                    })}
                </div>
                {/* Desktop: views + filters share the tabs row, so the list starts a row higher. */}
                <div className="cl-filters cl-hide-narrow">
                    {viewPicker}
                    {filterControls}
                    {letterChip}
                    {clearAll}
                </div>
            </div>

            {/* ── Filter bar (narrow screens: filters live in a sheet) ── */}
            <div className="cl-bar cl-only-narrow">
                {viewPicker}
                <button type="button" className={`cl-dd-btn${activeFilterCount ? ' set' : ''}`} onClick={() => setShowFilterSheet(true)}>
                    <SlidersHorizontal size={15} aria-hidden="true" />Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
                </button>
                {letterChip}
                {clearAll}
                <span className="cl-grow" />
                <span className="cl-muted cl-hide-phone" style={{ fontSize: 12.5 }}>{currentTab?.hint}</span>
            </div>

            {notice && <div role="status" className="cl-sec" style={{ padding: '10px 14px', marginBottom: 10, fontSize: 13.5 }}>{notice}</div>}
            {loadError && (
                <div role="alert" className="cl-sec" style={{ padding: '10px 14px', marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="cl-err">{loadError}</span>
                    <button type="button" className="cl-btn sm" onClick={() => fetchPartners({ skipCache: true })}>Retry</button>
                </div>
            )}

            {/* ── List ── */}
            <div className="cl-body">
                {narrow ? (
                    <div style={{ flex: 1, minWidth: 0 }}>
                        {nothingMatches ? <div className="cl-list">{emptyState}</div> : (
                            <CustomerRowList
                                rows={partners}
                                loading={loading}
                                openId={openCustomer?._id}
                                onOpen={(row) => openRow(row)}
                                onOpenProfile={openProfile}
                                onMore={(row) => setOpenCustomer(row)}
                                onCall={rememberCall}
                            />
                        )}
                        {!nothingMatches && !(loading && partners.length === 0) && <div className="cl-card" style={{ marginTop: 10 }}>{pager}</div>}
                    </div>
                ) : (
                    <div className="cl-card">
                        {nothingMatches ? (
                            <>
                                <CustomerTable rows={[]} loading={false} sort={{ by: sortBy, order: sortOrder }} onSort={handleSort} selectedIds={selectedIds} onToggle={() => {}} onToggleAll={() => {}} />
                                {emptyState}
                            </>
                        ) : (
                            <CustomerTable
                                rows={partners}
                                loading={loading}
                                sort={{ by: sortBy, order: sortOrder }}
                                onSort={handleSort}
                                selectedIds={selectedIds}
                                onToggle={toggleRow}
                                onToggleAll={toggleAll}
                                openId={openCustomer?._id}
                                focusIndex={focusIndex}
                                onOpen={openRow}
                                onOpenProfile={openProfile}
                                onEdit={(row) => { setEditingPartner(row); setViewingPartner(null); setShowAddModal(true); }}
                                onDelete={handleDeletePartner}
                                canEdit={canEdit}
                                canDelete={canDelete}
                                showType={showType}
                            />
                        )}
                        {!nothingMatches && !(loading && partners.length === 0) && pager}
                    </div>
                )}
                {(!nothingMatches || letter) && azStrip}
            </div>

            <button type="button" className="cl-fab" aria-label="Add customer" onClick={() => { setEditingPartner(null); setViewingPartner(null); setShowAddModal(true); }}>
                <Plus size={26} />
            </button>

            {!narrow && (
                <BulkBar
                    count={selected.size}
                    canEdit={canEdit}
                    salesReps={salesReps}
                    busy={bulkBusy}
                    message={bulkMessage}
                    onPlanRoute={onPlanRoute ? () => onPlanRoute(selectedRows) : null}
                    onCopyEmails={bulkCopyEmails}
                    onAssignRep={(repId) => bulkPatch({ salesRep: repId }, (n) => `${n} reassigned`)}
                    onSetStatus={(status) => bulkPatch({ status }, (n) => `${n} set to ${status}`)}
                    onExport={() => exportRows(selectedRows, 'Selected_Customers')}
                    onClear={() => setSelected(new Map())}
                />
            )}

            {openCustomer && (
                <CustomerDrawer
                    // Remount (and refetch) when the record is saved, not just when another customer opens.
                    key={`${openCustomer._id}:${openCustomer.updatedAt || ''}`}
                    customer={openCustomer}
                    overlay={narrow}
                    position={openIndex >= 0 ? { index: (currentPage - 1) * limit + openIndex, total: totalCount } : null}
                    onPrev={openIndex > 0 ? () => { setOpenCustomer(partners[openIndex - 1]); setFocusIndex(openIndex - 1); } : null}
                    onNext={openIndex >= 0 && openIndex < partners.length - 1 ? () => { setOpenCustomer(partners[openIndex + 1]); setFocusIndex(openIndex + 1); } : null}
                    onClose={() => setOpenCustomer(null)}
                    onOpenProfile={openProfile}
                    onEdit={(row) => { setEditingPartner(row); setViewingPartner(null); setShowAddModal(true); }}
                    onDelete={handleDeletePartner}
                    onStatusChange={handleStatusChange}
                    canEdit={canEdit}
                    canDelete={canDelete}
                />
            )}

            {showFilterSheet && (
                <>
                    <div className="cl-scrim" onClick={() => setShowFilterSheet(false)} aria-hidden="true" />
                    <section className="cl-sheet cl" role="dialog" aria-modal="true" aria-label="Filters">
                        <div className="cl-sheet-handle" aria-hidden="true" />
                        <div className="cl-sheet-hd">
                            <h3>Filters</h3>
                            {(activeFilterCount > 0 || view) && <button type="button" className="cl-btn sm" style={{ border: 0, background: 'none', color: 'var(--cl-gold-ink)' }} onClick={clearFilters}>Clear all</button>}
                            <button type="button" className="cl-ib" aria-label="Close filters" onClick={() => setShowFilterSheet(false)}><X size={20} /></button>
                        </div>
                        <div className="cl-sheet-bd">
                            <div className="cl-fl">Sort by</div>
                            {sheetSort}
                            <div className="cl-fl">Filter by</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{filterControls}</div>
                        </div>
                        <div className="cl-sheet-ft">
                            <button type="button" className="cl-btn" style={{ height: 48 }} onClick={clearFilters}>Reset</button>
                            <button type="button" className="cl-btn gold" style={{ height: 48, flex: 1, justifyContent: 'center' }} onClick={() => setShowFilterSheet(false)}>
                                Show {loading ? '' : totalCount} results
                            </button>
                        </div>
                    </section>
                </>
            )}

            {logCallFor && (
                <LogCallSheet
                    customer={logCallFor}
                    userName={user?.contactName || user?.name}
                    onSkip={() => setLogCallFor(null)}
                    onDone={() => { setLogCallFor(null); setNotice('Call logged on the customer’s Visits.'); }}
                />
            )}

            <AddCustomerModal
                show={showAddModal}
                onClose={() => { setShowAddModal(false); setEditingPartner(null); setViewingPartner(null); }}
                onSave={handleSavePartner}
                isSaving={isSaving}
                editingCustomer={editingPartner}
                viewingCustomer={viewingPartner}
                salesReps={salesReps}
                locations={locations}
                currentUser={user}
                onOpenExisting={(c) => setOpenCustomer(c)}
                onDelete={canDelete ? (c) => handleDeletePartner(c._id) : null}
            />

            <CustomerImportModal
                show={showImportModal}
                onClose={() => setShowImportModal(false)}
                onImported={refreshAll}
            />
        </div>
    );
};

export default PartnersSheet;
