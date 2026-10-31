import { Clock } from 'lucide-react';
import VisitPostCard from '../../../components/sales/VisitPostCard';
import { canModifyVisit, canDeleteVisit } from '../../../utils/visitAccess';
import { useMyTeam } from '../../../api/myTeam';
import Pagination from '../../../components/shared/Pagination';
import { usePagination, pageCount } from '../../../components/shared/paginationConfig';
import { TabEmpty, TabSkeleton } from './TabStates';
import type { Loose } from '../../../types/records';

export type VisitsTabProps = {
    /** The customer's visits, oldest first (shown newest first). */
    visits: Loose[];
    /** Their history is still on its way. */
    loading: boolean;
    currentUser: Loose | null;
    currentUserId: string | null;
    canAddVisits: boolean;
    /** The empty tab's own Add visit button (the header's one hides while the tab is empty). */
    onAddVisit: () => void;
    onReaction: (visitId: string, type: string) => void;
    onEditVisit: (visit: Loose) => void;
    onDeleteVisit: (visitId: string, customerId?: string | null) => void;
    onOpenGallery: (images: string[], index: number) => void;
    /** Which post has its reaction picker open (kept by the page, so it survives a tab change). */
    activeReactionMessageId: string | null;
    setActiveReactionMessageId: (id: string | null) => void;
};

/**
 * Customer profile → Visits: the feed of posts, newest first, 50 to a page. The
 * Add visit button is the header's (2026-10-29); the empty tab holds its own.
 */
export default function VisitsTab({
    visits, loading, currentUser, currentUserId, canAddVisits, onAddVisit, onReaction,
    onEditVisit, onDeleteVisit, onOpenGallery, activeReactionMessageId, setActiveReactionMessageId
}: VisitsTabProps) {
    const team = useMyTeam(currentUser, currentUserId);
    const paging = usePagination();
    const newestFirst = [...visits].reverse();
    const totalPages = pageCount(newestFirst.length, paging.rowsPerPage);
    const page = Math.min(paging.currentPage, totalPages);
    const shown = newestFirst.slice((page - 1) * paging.rowsPerPage, page * paging.rowsPerPage);

    return (
        <div className="tab-section visits-tab">
            <div className="chat-container channel-feed">
                <div className="chat-messages feed-list">
                    {loading ? (
                        <TabSkeleton />
                    ) : (
                        shown.length > 0 ? (
                            shown.map(visit => (
                                <VisitPostCard
                                    key={visit._id}
                                    visit={visit}
                                    currentUser={currentUser}
                                    currentUserId={currentUserId}
                                    handleReaction={onReaction}
                                    activeReactionMessageId={activeReactionMessageId}
                                    setActiveReactionMessageId={setActiveReactionMessageId}
                                    handleEditVisit={onEditVisit}
                                    handleDeleteVisit={onDeleteVisit}
                                    handleOpenGallery={onOpenGallery}
                                    canModify={canModifyVisit({ ...currentUser, id: currentUserId }, visit, team)}
                                    canDelete={canDeleteVisit({ ...currentUser, id: currentUserId }, visit, team)}
                                />
                            ))
                        ) : (
                            <TabEmpty
                                icon={<Clock size={28} aria-hidden="true" />}
                                title="No visits yet"
                                text="Log a visit to start this customer's history."
                                actionLabel={canAddVisits ? 'Add visit' : undefined}
                                onAction={onAddVisit}
                            />
                        )
                    )}
                </div>
            </div>
            {!loading && newestFirst.length > paging.rowsPerPage && (
                <Pagination
                    currentPage={page} totalPages={totalPages} onPageChange={paging.setCurrentPage}
                    rowsPerPage={paging.rowsPerPage} onRowsPerPageChange={paging.setRowsPerPage} totalCount={newestFirst.length}
                />
            )}
        </div>
    );
}
