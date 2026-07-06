import React from 'react';
import { Smile, Edit2, Trash2, FileText, X } from 'lucide-react';
import { API_URL } from '../../config/api';

const getInitials = (name) => {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
};

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
    const isQuickNote = visit.purpose?.toLowerCase().includes('quick note');
    const isMeeting = visit.purpose?.toLowerCase().includes('meeting') || visit.purpose?.toLowerCase().includes('visit');
    const cardClass = isQuickNote ? 'quick-note-card' : (isMeeting ? 'meeting-card' : '');

    return (
        <div className={`visit-post-card ${cardClass}`}>
            <div className="post-content-area">
                <div className="post-header">
                    <div className="post-header-main-info">
                        <div className="author-avatar">
                            {getInitials(visit.createdByName || visit.creatorName)}
                        </div>
                        <div className="author-details-wrapper">
                            <span className="post-author">{visit.createdByName || visit.creatorName || 'Unknown User'}</span>
                            <span className="post-time">
                                {(() => {
                                    const dateVal = visit.date;
                                    if (!dateVal) return '-';
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
                        </div>
                    </div>

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
                    {visit.purpose && (
                        <div className={`post-purpose-badge ${visit.purpose.toLowerCase().includes('quick note') ? 'quick-note' : 'meeting'}`}>
                            {visit.purpose}
                        </div>
                    )}

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
