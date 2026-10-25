import type { RefObject } from 'react';
import { Search, Plus, Download, Upload, Mail, X, MoreHorizontal, Link2 } from 'lucide-react';
import SidebarToggleButton from '../../../components/shared/SidebarToggleButton';
import { SHOW_EXCEL_IMPORT } from './listOptions';
import type { ListDialogs } from './useListUi';

export type ListHeaderProps = {
    dialogs: ListDialogs;
    isSidebarOpen: boolean;
    isMobile: boolean;
    phone: boolean;
    onToggleSidebar?: () => void;
    loading: boolean;
    totalCount: number;
    searchRef: RefObject<HTMLInputElement | null>;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    canExport: boolean;
    canImport: boolean;
    canEdit: boolean;
    canAdd: boolean;
    onExport: () => void;
    onEmailAll: () => void;
};

/** The list's title row: menu button, count, search, ⋯ (export / import) and Add customer. */
export default function ListHeader(p: ListHeaderProps) {
    const { dialogs: dl, isSidebarOpen, isMobile, phone, onToggleSidebar, loading, totalCount, searchRef, searchTerm, onSearchChange, canExport, canImport, canEdit, canAdd } = p;
    const { moreOpen, setMoreOpen, moreRef } = dl;
    return (
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
                    onChange={(e) => onSearchChange(e.target.value)}
                />
                {searchTerm
                    ? <button type="button" className="cl-ib" style={{ width: 26, height: 26 }} onClick={() => onSearchChange('')} aria-label="Clear search"><X size={14} /></button>
                    : <kbd className="cl-kbd cl-hide-narrow">/</kbd>}
            </label>
            {(canExport || canImport) && (
                <div className="cl-rowmenu" ref={moreRef}>
                    <button type="button" className="cl-ib box" aria-label="More actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>
                        <MoreHorizontal size={18} />
                    </button>
                    {moreOpen && (
                        <div className="cl-pop right" role="menu" style={{ minWidth: 250 }}>
                            {canExport && (
                                <>
                                    <button type="button" role="menuitem" className="cl-opt" onClick={() => { setMoreOpen(false); p.onExport(); }}><Download size={16} aria-hidden="true" />Export to Excel</button>
                                    <button type="button" role="menuitem" className="cl-opt" onClick={p.onEmailAll}><Mail size={16} aria-hidden="true" />Copy marketing emails</button>
                                </>
                            )}
                            {SHOW_EXCEL_IMPORT && canImport && (
                                <button type="button" role="menuitem" className="cl-opt" onClick={() => { setMoreOpen(false); dl.setShowImportModal(true); }}><Upload size={16} aria-hidden="true" />Import from Excel</button>
                            )}
                            {canImport && (
                                <button type="button" role="menuitem" className="cl-opt" onClick={() => { setMoreOpen(false); dl.setShowSpsImport(true); }}><Upload size={16} aria-hidden="true" />Import from SPS</button>
                            )}
                            {canImport && canEdit && (
                                <button type="button" role="menuitem" className="cl-opt" onClick={() => { setMoreOpen(false); dl.setShowSpsConnect(true); }}><Link2 size={16} aria-hidden="true" />Connect customers to SPS</button>
                            )}
                        </div>
                    )}
                </div>
            )}
            {canAdd && (
                <button type="button" className="cl-btn gold cl-hide-phone" onClick={dl.openAdd}>
                    <Plus size={17} aria-hidden="true" />Add customer
                </button>
            )}
        </div>
    );
}
