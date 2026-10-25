import { FolderPlus, Loader, Plus, UserPlus } from 'lucide-react';
import VisitPostCard from '../../../components/sales/VisitPostCard';
import { canModifyVisit, canDeleteVisit } from '../../../utils/visitAccess';
import type { Loose } from '../../../types/records';

export type VisitsTabProps = {
    /** The customer's visits, oldest first (shown newest first). */
    visits: Loose[];
    /** Their history is still on its way. */
    loading: boolean;
    customerLocation?: string;
    currentUser: Loose | null;
    currentUserId: string | null;
    canAddVisits: boolean;
    onAddContact: () => void;
    onAddResource: () => void;
    onAddVisit: () => void;
    onReaction: (visitId: string, type: string) => void;
    onEditVisit: (visit: Loose) => void;
    onDeleteVisit: (visitId: string, customerId?: string | null) => void;
    onOpenGallery: (images: string[], index: number) => void;
    /** Which post has its reaction picker open (kept by the page, so it survives a tab change). */
    activeReactionMessageId: string | null;
    setActiveReactionMessageId: (id: string | null) => void;
};

/** Customer profile → Visits: the feed of posts, with Add Contact / Resource / Visit. */
export default function VisitsTab({
    visits, loading, customerLocation, currentUser, currentUserId, canAddVisits, onAddContact, onAddResource, onAddVisit, onReaction,
    onEditVisit, onDeleteVisit, onOpenGallery, activeReactionMessageId, setActiveReactionMessageId
}: VisitsTabProps) {
    return (
        <div className="tab-section visits-tab">
            {/* Top "New Post" Input Area */}
            {/* Add Visit Button Area */}
            <div className="add-visit-container">
                <button className="icon-action-btn secondary" onClick={onAddContact} title="Add Contact">
                    <UserPlus size={18} />
                    <span className="btn-label">Add Contact</span>
                </button>
                {canAddVisits && (
                    <>
                        <button className="icon-action-btn secondary" onClick={onAddResource} title="Add Resource">
                            <FolderPlus size={18} />
                            <span className="btn-label">Add Resource</span>
                        </button>
                        <button className="add-visit-btn" onClick={onAddVisit}>
                            <Plus size={18} />
                            Add Visit
                        </button>
                    </>
                )}
            </div>

            <div className="chat-container channel-feed">
                <div className="chat-messages feed-list">
                    {loading ? (
                        <div className="loading-spinner-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '220px', padding: '3rem 2rem', gap: '12px' }}>
                            <Loader className="spin-animation" size={32} color="#D4AF37" />
                            <span style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 500 }}>Loading customer history...</span>
                        </div>
                    ) : (
                        visits.length > 0 ? (
                            [...visits].reverse().map(visit => (
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
                                    canModify={canModifyVisit({ ...currentUser, id: currentUserId }, visit, customerLocation)}
                                    canDelete={canDeleteVisit({ ...currentUser, id: currentUserId }, visit, customerLocation)}
                                />
                            ))
                        ) : (
                            <div className="empty-list-message">
                                No posts yet. Be the first to post!
                            </div>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}
