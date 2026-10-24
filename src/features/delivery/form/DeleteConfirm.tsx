export type DeleteConfirmProps = {
    title: string;
    /** Who or what goes, starting the sentence ("Pacific Granite", "The TRF-1 transfer"). */
    subject: string;
    onCancel: () => void;
    onDelete: () => void;
};

/** The Delivery form's "Delete …?" check, over the form. */
export default function DeleteConfirm({ title, subject, onCancel, onDelete }: DeleteConfirmProps) {
    return (
        <div
            className="fm-confirm-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
        >
            <div className="fm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="df-delete-title" data-fm-layer="" tabIndex={-1}>
                <h3 className="fm-confirm-title" id="df-delete-title">{title}</h3>
                <p className="fm-confirm-text">
                    {subject} will be removed from the schedule. This can’t be undone.
                </p>
                <div className="fm-confirm-actions">
                    <button type="button" className="fm-btn" autoFocus onClick={onCancel}>Cancel</button>
                    <button type="button" className="fm-btn fm-btn-danger" onClick={onDelete}>Delete</button>
                </div>
            </div>
        </div>
    );
}
