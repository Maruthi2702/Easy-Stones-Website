import { Search } from 'lucide-react';
import Pagination from '../../../components/shared/Pagination';
import { canModifyVisit, canDeleteVisit } from '../../../utils/visitAccess';
import { useMyTeam } from '../../../api/myTeam';
import DashboardAside from '../components/DashboardAside';
import VisitsFocusList from '../components/VisitsFocusList';
import RepBreakdownTable from '../components/RepBreakdownTable';
import type { RepRow } from '../repBreakdown';
import type { Loose } from '../../../types/records';

export type VisitsPanelProps = {
    /** This page of the filtered visits. */
    pagedVisits: Loose[];
    /** How many visits match the filters (all pages). */
    totalCount: number;
    searchTerm: string;
    onSearchChange: (value: string) => void;
    page: number;
    rowsPerPage: number;
    onPageChange: (page: number) => void;
    onRowsPerPageChange: (rows: number) => void;
    tableLoading: boolean;
    /** The visit being opened for Edit (its row's button waits). */
    busyVisitId: string | null;
    currentUser: Loose | null;
    currentUserId: string | null;
    /** Names for the Today panel's calendar stops. */
    customers: Loose[];
    schedules: Loose[];
    followUpPanel: Loose[];
    followUpCount: number;
    /** More than the viewer is in view (the People filter): rows say who logged them. */
    showWhoLogged: boolean;
    /** "List | By rep": null hides the switch (they only see their own). */
    byRep: { view: 'list' | 'byRep'; onViewChange: (v: 'list' | 'byRep') => void; rows: RepRow[]; showToday?: boolean; onPick: (id: string) => void } | null;
    onOpenTab: (tab: 'planner' | 'followups') => void;
    onOpenVisitCard: (visit: Loose) => void;
    onEditVisit: (visit: Loose) => void;
    onDeleteVisit: (visitId: string, customerId?: string | null) => void;
    onOpenGallery: (images: string[], index: number) => void;
    /** A customer's profile (also leaves the dashboard). */
    onOpenCustomer: (customerId: string) => void;
};

/** Dashboard → Sales Visits: the Focus board (visit list with pager) and its Today / Follow-ups panels. */
export default function VisitsPanel({
    pagedVisits, totalCount, searchTerm, onSearchChange, page, rowsPerPage, onPageChange, onRowsPerPageChange, tableLoading, busyVisitId,
    currentUser, currentUserId, customers, schedules, followUpPanel, followUpCount, showWhoLogged, byRep, onOpenTab, onOpenVisitCard, onEditVisit, onDeleteVisit,
    onOpenGallery, onOpenCustomer
}: VisitsPanelProps) {
    const team = useMyTeam(currentUser, currentUserId);
    const showingByRep = byRep?.view === 'byRep';
    return (
        <div className="dfx-board">
        <div className="visits-table-section">
            <div className="section-header">
                <h2>Sales Visits</h2>
                <div className="table-controls">
                    {!showingByRep && (
                    <div className="table-search">
                         <Search className="search-icon" size={18} />
                         <input
                             type="text"
                             placeholder="Search visits..."
                            value={searchTerm}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>
                    )}
                </div>
            </div>

            {showingByRep && byRep ? (
                <RepBreakdownTable rows={byRep.rows} loading={tableLoading} showToday={byRep.showToday} onPick={byRep.onPick} />
            ) : (
            <>

            <VisitsFocusList
                visits={pagedVisits}
                canModify={(visit) => canModifyVisit({ ...currentUser, id: currentUserId }, visit, team)}
                canDelete={(visit) => canDeleteVisit({ ...currentUser, id: currentUserId }, visit, team)}
                canOpenCustomer={currentUser?.permissions?.includes('view_customers')}
                showWhoLogged={showWhoLogged}
                loading={tableLoading}
                busyVisitId={busyVisitId}
                onOpenCustomer={onOpenVisitCard}
                onEdit={onEditVisit}
                onDelete={(visit) => onDeleteVisit(visit._id, visit.customerId)}
                onOpenGallery={onOpenGallery}
            />

            {/* Pagination Controls */}
            <Pagination
                 currentPage={page}
                 totalPages={Math.ceil(totalCount / rowsPerPage)}
                 onPageChange={(p) => { onPageChange(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                 rowsPerPage={rowsPerPage}
                 onRowsPerPageChange={onRowsPerPageChange}
                 totalCount={totalCount}
             />
            </>
            )}
        </div>
        <DashboardAside
            schedules={schedules}
            customerName={(sch) => {
                const id = sch.customerId?._id || sch.customerId;
                const c = customers.find(x => String(x._id) === String(id));
                const src = c || sch.customerId || {};
                return src.company || src.contactName || '';
            }}
            followUps={followUpPanel}
            showWhoLogged={showWhoLogged}
            followUpCount={followUpCount}
            onOpenPlanner={() => onOpenTab('planner')}
            onOpenFollowUps={() => onOpenTab('followups')}
            onOpenCustomer={(f) => {
                if (!f.customerId) return;
                                onOpenCustomer(f.customerId);
            }}
        />
        </div>
    );
}
