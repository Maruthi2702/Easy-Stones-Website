import { Search, Plus, X } from 'lucide-react';
import Pagination from '../../../components/shared/Pagination';
import CustomerTable from './CustomerTable';
import CustomerRowList from './CustomerRowList';
import { LETTERS } from './listOptions';
import type { Loose } from '../../../types/records';

export type ListBodyProps = {
    narrow: boolean;
    partners: Loose[];
    loading: boolean;
    nothingMatches: boolean;
    openCustomer: Loose | null;
    focusIndex: number;
    sortBy: string;
    sortOrder: string;
    onSort: (field: string) => void;
    selectedIds: Set<string>;
    onToggle: (id: string) => void;
    onToggleAll: (on: boolean) => void;
    onOpen: (row: Loose, index?: number) => void;
    onOpenProfile: (row: Loose) => void;
    onMore: (row: Loose) => void;
    onCall: (row: Loose) => void;
    onEdit: (row: Loose) => void;
    onDelete: (id: string) => unknown;
    canEdit: boolean;
    canDelete: boolean;
    canProfile: boolean;
    canAdd: boolean;
    showType: boolean;
    // Pager
    currentPage: number;
    totalPages: number;
    totalCount: number;
    limit: number;
    onPageChange: (page: number) => void;
    onRowsPerPageChange: (n: number) => void;
    // A–Z and the empty state
    letter: string;
    onLetter: (letter: string) => void;
    anyNarrowing: boolean;
    isFabTab: boolean;
    /** Empty state's Clear filters: the filters and the search. */
    onClearEverything: () => void;
    onAdd: () => void;
};

/** The rows (table, or three-line rows on narrow screens), the pager, the empty state and the A–Z strip. */
export default function ListBody(p: ListBodyProps) {
    const { narrow, partners, loading, nothingMatches, openCustomer, focusIndex, letter } = p;

    const emptyState = (
        <div className="cl-empty">
            <span className="cl-empty-ic"><Search size={26} aria-hidden="true" /></span>
            <h3>{p.anyNarrowing ? 'No customers match these filters' : `No ${p.isFabTab ? 'fabricators' : 'partners'} yet`}</h3>
            <p>{p.anyNarrowing ? 'Try removing a filter, or search all customers.' : 'Add your first customer to get started.'}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                {p.anyNarrowing && <button type="button" className="cl-btn" onClick={p.onClearEverything}><X size={15} aria-hidden="true" />Clear filters</button>}
                {p.canAdd && <button type="button" className="cl-btn gold" onClick={p.onAdd}><Plus size={16} aria-hidden="true" />Add customer</button>}
            </div>
        </div>
    );

    const pager = (
        <Pagination
            currentPage={p.currentPage}
            totalPages={p.totalPages}
            totalCount={p.totalCount}
            rowsPerPage={p.limit}
            onPageChange={p.onPageChange}
            onRowsPerPageChange={p.onRowsPerPageChange}
        >
            {(!!openCustomer || focusIndex >= 0) && (
                <span className="cl-keys cl-hide-narrow" aria-hidden="true">
                    <span className="cl-kbd">↑</span><span className="cl-kbd">↓</span> move
                    <span className="cl-kbd">Enter</span> open <span className="cl-kbd">Esc</span> close <span className="cl-kbd">/</span> search
                </span>
            )}
        </Pagination>
    );

    const azStrip = (
        <nav className="cl-az" aria-label="Jump to letter">
            {LETTERS.map(l => (
                <button
                    key={l}
                    type="button"
                    aria-pressed={letter === l}
                    aria-label={l === '#' ? 'Names starting with a number or symbol' : `Names starting with ${l}`}
                    onClick={() => p.onLetter(l)}
                >{l}</button>
            ))}
        </nav>
    );

    return (
        <div className="cl-body">
            {narrow ? (
                <div style={{ flex: 1, minWidth: 0 }}>
                    {nothingMatches ? <div className="cl-list">{emptyState}</div> : (
                        <CustomerRowList
                            rows={partners}
                            loading={loading}
                            openId={openCustomer?._id}
                            onOpen={(row) => p.onOpen(row)}
                            onOpenProfile={p.onOpenProfile}
                            onMore={p.onMore}
                            onCall={p.onCall}
                        />
                    )}
                    {!nothingMatches && !(loading && partners.length === 0) && <div className="cl-card" style={{ marginTop: 10 }}>{pager}</div>}
                </div>
            ) : (
                <div className="cl-card">
                    {nothingMatches ? (
                        <>
                            <CustomerTable rows={[]} loading={false} sort={{ by: p.sortBy, order: p.sortOrder }} onSort={p.onSort} selectedIds={p.selectedIds} onToggle={() => {}} onToggleAll={() => {}} />
                            {emptyState}
                        </>
                    ) : (
                        <CustomerTable
                            rows={partners}
                            loading={loading}
                            sort={{ by: p.sortBy, order: p.sortOrder }}
                            onSort={p.onSort}
                            selectedIds={p.selectedIds}
                            onToggle={p.onToggle}
                            onToggleAll={p.onToggleAll}
                            openId={openCustomer?._id}
                            focusIndex={focusIndex}
                            onOpen={p.onOpen}
                            onOpenProfile={p.onOpenProfile}
                            onEdit={p.onEdit}
                            onDelete={p.onDelete}
                            canEdit={p.canEdit}
                            canDelete={p.canDelete}
                            canProfile={p.canProfile}
                            showType={p.showType}
                        />
                    )}
                    {!nothingMatches && !(loading && partners.length === 0) && pager}
                </div>
            )}
            {(!nothingMatches || letter) && azStrip}
        </div>
    );
}
