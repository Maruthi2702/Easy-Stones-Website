import React from 'react';
import { Smile, Edit2, Trash2, FileText, X } from 'lucide-react';
import { API_URL } from '../../config/api';

const VisitPostCard = ({
    visit,
    currentUser,
    currentUserId,
    formatDate,
    handleReaction,
    activeReactionMessageId,
    setActiveReactionMessageId,
    handleEditVisit,
    handleDeleteVisit,
    handleOpenGallery
}) => {
    return (
        <div className="visit-post-card">
            <div className="post-content-area">
                <div className="post-header">
                    <span className="post-author">{visit.createdByName || visit.creatorName || 'Unknown User'}</span>
                    <span className="post-time">
                        {(() => {
                            const dateVal = visit.date;
                            if (!dateVal) return '-';
                            // Strip Z to ensure local time face value
                            const dateObj = (typeof dateVal === 'string' && dateVal.endsWith('Z'))
                                ? new Date(dateVal.slice(0, -1))
                                : new Date(dateVal);

                            return dateObj.toLocaleDateString('en-US', {
                                month: '2-digit',
                                day: '2-digit',
                                year: 'numeric'
                            });
                        })()}
                    </span>

                    {(currentUser?.role === 'admin' || currentUser?.role === 'director' || currentUser?.role === 'manager' || currentUserId === visit.createdBy) && (
                        <div className="post-header-actions">
                            <button
                                className="icon-action-small reaction-trigger"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (activeReactionMessageId === visit._id) {
                                        setActiveReactionMessageId(null);
                                    } else {
                                        setActiveReactionMessageId(visit._id);
                                    }
                                }}
                                title="Add Reaction"
                            >
                                <Smile size={14} />
                            </button>
                            {activeReactionMessageId === visit._id && (
                                <div className="reaction-picker-floating">
                                    {['👍', '❤️', '😂', '😮', '👏'].map(emoji => (
                                        <button
                                            key={emoji}
                                            className="reaction-option"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleReaction(visit._id, emoji);
                                                setActiveReactionMessageId(null);
                                            }}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <button
                                className="icon-action-small edit"
                                onClick={(e) => { e.stopPropagation(); handleEditVisit(visit); }}
                                title="Edit"
                            >
                                <Edit2 size={14} />
                            </button>
                            <button
                                className="icon-action-small delete"
                                onClick={(e) => { e.stopPropagation(); handleDeleteVisit(visit._id); }}
                                title="Delete"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    )}
                </div>

                <div className="post-body">
                    {visit.purpose && <h4 className="post-purpose">{visit.purpose}</h4>}

                    {/* Images */}
                    {visit.image && (Array.isArray(visit.image) ? visit.image : [visit.image]).length > 0 && (
                        <div className={`post-images gallery-layout count-${Math.min((Array.isArray(visit.image) ? visit.image : [visit.image]).length, 4)}`}>
                            {(Array.isArray(visit.image) ? visit.image : [visit.image]).slice(0, 4).map((img, idx) => {
                                const totalImages = (Array.isArray(visit.image) ? visit.image : [visit.image]).length;
                                const isLastShown = idx === 3;
                                const remainingCount = totalImages - 4;

                                return (
                                    <div
                                        key={idx}
                                        className="post-image-wrapper"
                                        onClick={() => handleOpenGallery(visit.image, idx)}
                                    >
                                        {(img.startsWith('data:application/pdf') || img.toLowerCase().endsWith('.pdf') || (img.startsWith('/uploads') && img.toLowerCase().includes('.pdf'))) ? (
                                            <div className="pdf-attachment-card">
                                                <FileText size={20} color="#E5C04A" />
                                                <span>PDF</span>
                                            </div>
                                        ) : (
                                            <>
                                                <img
                                                    src={img.startsWith('/uploads') ? `${API_URL}${img}` : img}
                                                    alt="Attachment"
                                                    className="post-attachment-img"
                                                    loading="lazy"
                                                />
                                                {isLastShown && remainingCount > 0 && (
                                                    <div className="more-images-overlay">
                                                        <span>+{remainingCount}</span>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Text Note */}
                    {visit.notes && <p className="post-text">{visit.notes}</p>}

                    {(visit.outcome || visit.followUp || visit.nextAction || visit.managerComment || visit.headquartersComment) && (
                        <div className="post-details-ext">
                            {visit.outcome && !visit.purpose?.toLowerCase().includes('quick note') && (
                                <div className="post-detail-row outcome">
                                    <span className="detail-label">Outcome:</span>
                                    <span className="detail-value">{visit.outcome}</span>
                                </div>
                            )}
                            {visit.followUp && !visit.purpose?.toLowerCase().includes('quick note') && (
                                <div className="post-detail-row follow-up">
                                    <span className="detail-label">Follow Up:</span>
                                    <span className="detail-value">{visit.followUp}</span>
                                </div>
                            )}
                            {visit.managerComment && (
                                <div className="post-detail-row manager-comment">
                                    <span className="detail-label">Manager Comment:</span>
                                    <span className="detail-value">{visit.managerComment}</span>
                                </div>
                            )}
                            {visit.headquartersComment && (
                                <div className="post-detail-row hq-comment">
                                    <span className="detail-label">HQ Comment:</span>
                                    <span className="detail-value">{visit.headquartersComment}</span>
                                </div>
                            )}
                            {visit.nextAction && (
                                <div className="post-detail-row next-action">
                                    <span className="detail-label">Next Steps:</span>
                                    <span className="detail-value">{visit.nextAction}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Reactions Bar */}
                <div className="post-reactions">
                    {visit.reactions && visit.reactions.length > 0 && (
                        <div className="existing-reactions">
                            {Object.entries(
                                visit.reactions.reduce((acc, r) => {
                                    if (!r || !r.type) return acc;
                                    if (!acc[r.type]) acc[r.type] = { count: 0, userIds: [] };
                                    acc[r.type].count++;
                                    acc[r.type].userIds.push(r.userId);
                                    return acc;
                                }, {})
                            ).map(([type, data]) => {
                                const currentUserIdStr = currentUserId?.toString();
                                const userReacted = currentUserIdStr && data.userIds.map(id => id.toString()).includes(currentUserIdStr);
                                return (
                                    <span
                                        key={type}
                                        className={`reaction-pill ${userReacted ? 'user-reacted' : ''}`}
                                        title={userReacted ? 'Click to remove your reaction' : `${data.count} reactions`}
                                        onClick={() => userReacted && handleReaction(visit._id, type)}
                                    >
                                        {type} <span className="count">{data.count}</span>
                                        {userReacted && (
                                            <span className="reaction-remove-icon">
                                                <X size={10} strokeWidth={3} />
                                            </span>
                                        )}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default VisitPostCard;
