import { useState, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { Plus } from 'lucide-react';
import ListHeader from './ListHeader';
import ListBody from './ListBody';
import AddCustomerModalJs from '../../../components/sales/AddCustomerModal';
import CustomerImportModalJs from '../../../components/admin/CustomerImportModal';
import SpsConnectModalJs from '../../../components/sales/SpsConnectModal';
import SpsImportModalJs from '../../../components/sales/SpsImportModal';
import { canAddCustomer, canImportCustomers, canEditCustomers, canDeleteCustomers, canViewCustomerProfile, canExportCustomers } from '../../../utils/customerAccess';
import { useAuth } from '../../../context/AuthContext';
import CustomerDrawer from './CustomerDrawer';
import BulkBar from './BulkBar';
import BulkDeleteDialog from './BulkDeleteDialog';
import LogCallSheet from './LogCallSheet';
import ListToolbar from './ListToolbar';
import ListFilterControls, { ViewPicker } from './ListFilterControls';
import ListFilterSheet from './ListFilterSheet';
import { canAddVisit } from '../../../utils/visitAccess';
import { useWindowWidth, useListDialogs, useFlash, usePendingCall, useSelection } from './useListUi';
import { useListPaging, useListPickers, useListFilters } from './useListFilters';
import { useCustomerListData } from './useCustomerListData';
import { useCustomerWrites, useBulkActions } from './useListActions';
import { useListKeyboard } from './useListKeyboard';
import { exportRows, listExportActions } from './listExport';
import type { Loose } from '../../../types/records';
// Kept for the add/edit modal and the classes other sales screens share with it
// (.location-badge tints, status pills); the list itself is styled by CustomerList.css.
import './PartnersSheet.css';
import './CustomerList.css';

// Still JavaScript, so taken as taking any props until they're typed.
const AddCustomerModal = AddCustomerModalJs as unknown as ComponentType<Loose>;
const CustomerImportModal = CustomerImportModalJs as unknown as ComponentType<Loose>;
const SpsConnectModal = SpsConnectModalJs as unknown as ComponentType<Loose>;
const SpsImportModal = SpsImportModalJs as unknown as ComponentType<Loose>;

export type PartnersSheetProps = {
    onSelectCustomer?: (customer: Loose) => void;
    onToggleSidebar?: () => void;
    isSidebarOpen: boolean;
    customerRefreshTrigger?: number;
    /** The selection bar's "Plan route"; undefined without the Route Planner. */
    onPlanRoute?: (rows: Loose[]) => void;
};

/**
 * The Customers list: Fabricators / Partners, filters and saved views, the
 * table (rows on narrow screens) with its side drawer, selection and bulk
 * changes. State and loading are its hooks (useListUi, useListFilters,
 * useCustomerListData, useListActions, useListKeyboard); the parts are
 * presentational.
 */
const PartnersSheet = ({ onSelectCustomer, onToggleSidebar, isSidebarOpen, customerRefreshTrigger, onPlanRoute }: PartnersSheetProps) => {
    const { user } = useAuth();
    const width = useWindowWidth();
    const narrow = width < 900;   // list rows + slide-over instead of table + side drawer
    // Phones open the same details panel as iPad and laptop (full screen there),
    // with Open profile inside it — they used to skip straight to the profile,
    // so a phone never saw the panel (changed 2026-10-06 at the owner's ask).
    const phone = width < 600;
    const isMobile = width <= 1024; // the sales layout's own sidebar breakpoint

    const canEdit = canEditCustomers(user);
    const canAdd = canAddCustomer(user);
    const canImport = canImportCustomers(user);
    // Full profile and Export are their own switches (customerAccess.js); the
    // server enforces both, this only decides what the screen offers.
    const canProfile = canViewCustomerProfile(user);
    const canExport = canExportCustomers(user);
    const canDelete = canDeleteCustomers(user);

    const [activeTab, setActiveTab] = useState('fabricators');
    const dialogs = useListDialogs();
    const { setEditingPartner, setViewingPartner, setShowFilterSheet } = dialogs;
    const canLogCalls = canAddVisit(user);
    const { logCallFor, setLogCallFor, rememberCall } = usePendingCall(canLogCalls);
    const paging = useListPaging(canProfile);
    const { currentPage, setCurrentPage, limit, setLimit, sortBy, setSortBy, sortOrder, setSortOrder } = paging;
    const [notice, setNotice] = useFlash(3500);
    const [bulkMessage, setBulkMessage] = useFlash(3000);
    const { uniqueCities, salesReps, locations } = useListPickers();
    const filters = useListFilters(user, salesReps, locations);
    const { view, setView, letter, setLetter, filterTypes, activeFilterCount } = filters;
    const data = useCustomerListData({ activeTab, filters, sortBy, sortOrder, currentPage, setCurrentPage, limit, customerRefreshTrigger });
    const { partners, loading, loadError, totalPages, totalCount, searchTerm, setSearchTerm, debouncedSearch, setDebouncedSearch, refreshAll } = data;

    const { selected, setSelected, selectedIds, selectedRows, toggleRow, toggleAll } = useSelection(partners);

    const [openCustomer, setOpenCustomer] = useState<Loose | null>(null);
    const [focusIndex, setFocusIndex] = useState(-1);
    const rootRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    // Keep the open drawer and keyboard focus pointing at rows that exist.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- as it was before the split (the rule now sees it)
    useEffect(() => { setFocusIndex(-1); }, [partners]);

    const writes = useCustomerWrites({
        editingPartner: dialogs.editingPartner, setEditingPartner, setViewingPartner, openCustomer, setOpenCustomer,
        setSelected, setPartners: data.setPartners, setCountsNonce: data.setCountsNonce, refreshAll
    });
    const { handleDeletePartner } = writes;
    const bulk = useBulkActions({ selected, selectedRows, setSelected, setBulkMessage, openCustomer, setOpenCustomer, refreshAll });
    const { exportToExcel, emailAllContacts } = listExportActions({ fetchAllMatching: data.fetchAllMatching, activeTab, setMoreOpen: dialogs.setMoreOpen, setNotice });

    const resetPage = () => setCurrentPage(1);
    const withReset = (setter: (next: string[]) => void) => (v: string[]) => { setter(v); resetPage(); };

    const handleTabChange = (tabKey: string) => {
        setActiveTab(tabKey);
        setSearchTerm(''); setDebouncedSearch('');
        // Location is kept: it's which branch you're working in, not a
        // filter on this tab's list.
        filters.setFilterLevels([]); filters.setFilterTypes([]); filters.setFilterCities([]); filters.setFilterStatuses([]);
        filters.setFilterSalesReps([]); filters.setFilterModa([]);
        setView(''); setLetter('');
        setSelected(new Map());
        setOpenCustomer(null);
        resetPage();
    };

    const clearFilters = () => {
        filters.setFilterLevels([]); filters.setFilterTypes([]); filters.setFilterCities([]); filters.setFilterStatuses([]);
        filters.setFilterSalesReps([]); filters.setFilterLocations([]); filters.setFilterModa([]);
        setView(''); setLetter('');
        resetPage();
    };

    const handleSort = (field: string) => {
        if (sortBy === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        else { setSortBy(field); setSortOrder('asc'); }
        resetPage();
    };

    // ── Opening customers ────────────────────────────────────────────────────
    // Without Full profile there is no profile to open: the basic card (the drawer) is the most there is.
    const openProfile = (row: Loose) => {
        if (!canProfile) { setOpenCustomer(row); return; }
        setOpenCustomer(null);
        if (onSelectCustomer) onSelectCustomer(row);
    };
    const openRow = (row: Loose, index?: number) => {
        setOpenCustomer(row);
        if (index !== undefined) setFocusIndex(index);
    };
    const openIndex = openCustomer ? partners.findIndex(p => p._id === openCustomer._id) : -1;

    useListKeyboard({
        rootRef, searchRef, partners, focusIndex, setFocusIndex, openIndex, openCustomer, setOpenCustomer, narrow,
        showAddModal: dialogs.showAddModal, showImportModal: dialogs.showImportModal, showSpsConnect: dialogs.showSpsConnect,
        showSpsImport: dialogs.showSpsImport, showFilterSheet: dialogs.showFilterSheet, bulkDelete: bulk.bulkDelete
    });

    const isFabTab = activeTab === 'fabricators';
    const showType = !isFabTab || !!debouncedSearch || filterTypes.length > 0;
    const nothingMatches = !loading && !loadError && partners.length === 0;
    const anyNarrowing = activeFilterCount > 0 || !!view || !!debouncedSearch;

    const filterControls = <ListFilterControls filters={filters} user={user} uniqueCities={uniqueCities} canProfile={canProfile} isFabTab={isFabTab} withReset={withReset} />;
    const viewPicker = !canProfile ? null : <ViewPicker view={view} counts={data.viewCounts} onChange={(v: string) => { setView(v); resetPage(); }} />;

    return (
        <div className="partners-sheet-container cl" ref={rootRef}>
            {/* ── Header ── */}
            <ListHeader
                dialogs={dialogs} isSidebarOpen={isSidebarOpen} isMobile={isMobile} phone={phone} onToggleSidebar={onToggleSidebar}
                loading={loading} totalCount={totalCount} searchRef={searchRef} searchTerm={searchTerm} onSearchChange={setSearchTerm}
                canExport={canExport} canImport={canImport} canEdit={canEdit} canAdd={canAdd} onExport={exportToExcel} onEmailAll={emailAllContacts}
            />

            <ListToolbar
                activeTab={activeTab} onTabChange={handleTabChange} loading={loading} totalCount={totalCount}
                viewPicker={viewPicker} filterControls={filterControls}
                letter={letter} onClearLetter={() => { setLetter(''); resetPage(); }}
                view={view} activeFilterCount={activeFilterCount} onClearFilters={clearFilters} onOpenSheet={() => setShowFilterSheet(true)}
            />

            {notice && <div role="status" className="cl-sec" style={{ padding: '10px 14px', marginBottom: 10, fontSize: 13.5 }}>{notice}</div>}
            {loadError && (
                <div role="alert" className="cl-sec" style={{ padding: '10px 14px', marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="cl-err">{loadError}</span>
                    <button type="button" className="cl-btn sm" onClick={() => data.fetchPartners({ skipCache: true })}>Retry</button>
                </div>
            )}

            {/* ── List ── */}
            <ListBody
                narrow={narrow} partners={partners} loading={loading} nothingMatches={nothingMatches}
                openCustomer={openCustomer} focusIndex={focusIndex}
                sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}
                selectedIds={selectedIds} onToggle={toggleRow} onToggleAll={toggleAll}
                onOpen={openRow} onOpenProfile={openProfile} onMore={(row) => setOpenCustomer(row)} onCall={rememberCall}
                onEdit={dialogs.openEdit} onDelete={handleDeletePartner}
                canEdit={canEdit} canDelete={canDelete} canProfile={canProfile} canAdd={canAdd} showType={showType}
                currentPage={currentPage} totalPages={totalPages} totalCount={totalCount} limit={limit}
                onPageChange={(p) => setCurrentPage(Math.max(1, Math.min(totalPages, p)))}
                onRowsPerPageChange={(n) => { setLimit(n); resetPage(); }}
                letter={letter}
                onLetter={(l) => { setLetter(letter === l ? '' : l); if (sortBy !== 'company') { setSortBy('company'); setSortOrder('asc'); } resetPage(); }}
                anyNarrowing={anyNarrowing} isFabTab={isFabTab}
                onClearEverything={() => { clearFilters(); setSearchTerm(''); setDebouncedSearch(''); }}
                onAdd={dialogs.openAdd}
            />

            {canAdd && <button type="button" className="cl-fab" aria-label="Add customer" onClick={dialogs.openAdd}>
                <Plus size={26} />
            </button>}

            {!narrow && (
                <BulkBar
                    count={selected.size}
                    canEdit={canEdit}
                    salesReps={salesReps}
                    busy={bulk.bulkBusy}
                    message={bulkMessage}
                    onPlanRoute={onPlanRoute ? () => onPlanRoute(selectedRows) : null}
                    onCopyEmails={bulk.bulkCopyEmails}
                    onAssignRep={(repId) => bulk.bulkPatch({ salesRep: repId }, (n: number) => `${n} reassigned`)}
                    onSetStatus={(status) => bulk.bulkPatch({ status }, (n: number) => `${n} set to ${status}`)}
                    onExport={canExport ? () => exportRows(selectedRows, 'Selected_Customers') : null}
                    onDelete={canDelete ? bulk.startBulkDelete : null}
                    onClear={() => setSelected(new Map())}
                    undo={bulk.lastDelete ? {
                        message: bulk.lastDelete.message,
                        busy: bulk.lastDelete.busy,
                        onUndo: bulk.lastDelete.batchId ? bulk.undoBulkDelete : null,
                        onDismiss: () => bulk.setLastDelete(null)
                    } : null}
                />
            )}

            {bulk.bulkDelete && (
                <BulkDeleteDialog
                    rows={bulk.bulkDelete.rows}
                    saving={bulk.bulkDeleteSaving}
                    error={bulk.bulkDeleteError}
                    onConfirm={bulk.confirmBulkDelete}
                    onClose={() => bulk.setBulkDelete(null)}
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
                    onEdit={dialogs.openEdit}
                    onDelete={handleDeletePartner}
                    onStatusChange={writes.handleStatusChange}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    canProfile={canProfile}
                />
            )}

            {dialogs.showFilterSheet && (
                <ListFilterSheet
                    filterControls={filterControls} sortBy={sortBy} sortOrder={sortOrder}
                    onSort={(by, order) => { setSortBy(by); setSortOrder(order); resetPage(); }}
                    canProfile={canProfile} showClearAll={activeFilterCount > 0 || view} onClearFilters={clearFilters}
                    loading={loading} totalCount={totalCount} onClose={() => setShowFilterSheet(false)}
                />
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
                show={dialogs.showAddModal}
                onClose={dialogs.closeAdd}
                onSave={writes.handleSavePartner}
                isSaving={writes.isSaving}
                editingCustomer={dialogs.editingPartner}
                viewingCustomer={dialogs.viewingPartner}
                salesReps={salesReps}
                locations={locations}
                currentUser={user}
                onOpenExisting={(c: Loose) => setOpenCustomer(c)}
                onDelete={canDelete ? (c: Loose) => handleDeletePartner(c._id) : null}
            />

            {dialogs.showSpsImport && (
                <SpsImportModal
                    onClose={() => dialogs.setShowSpsImport(false)}
                    onChanged={refreshAll}
                    salesReps={salesReps}
                    locations={locations}
                    user={user}
                    canEdit={canEdit}
                    canAdd={canAdd}
                    canDelete={canDelete}
                />
            )}
            {dialogs.showSpsConnect && <SpsConnectModal onClose={() => dialogs.setShowSpsConnect(false)} onChanged={refreshAll} />}

            <CustomerImportModal
                show={dialogs.showImportModal}
                onClose={() => dialogs.setShowImportModal(false)}
                onImported={refreshAll}
                canResolveDuplicates={canEdit}
            />
        </div>
    );
};

export default PartnersSheet;
