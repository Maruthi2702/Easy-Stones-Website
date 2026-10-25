import { Loader, Trash2 } from 'lucide-react';

export type DeleteConfirmModalProps = {
    request: { message: string; isDeleting?: boolean };
    onConfirm: () => void;
    onCancel: () => void;
};

/** "Confirm Deletion": the Sales page's one delete check (contacts, visits, resources, team files). */
export default function DeleteConfirmModal({ request, onConfirm, onCancel }: DeleteConfirmModalProps) {
    return (
        <div className="delete-confirmation-overlay" onClick={onCancel}>
            <div className="delete-confirmation-modal" onClick={(e) => e.stopPropagation()}>
                <div className="delete-modal-icon">
                    <Trash2 size={48} color="#ef4444" />
                </div>
                <h3>Confirm Deletion</h3>
                <p>{request.message}</p>
                <div className="delete-modal-actions">
                    <button
                        className="btn-cancel"
                        onClick={onCancel}
                        disabled={request.isDeleting}
                    >
                        Cancel
                    </button>
                    <button
                        className="btn-delete"
                        onClick={onConfirm}
                        disabled={request.isDeleting}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}
                    >
                        {request.isDeleting ? (
                            <>
                                <Loader size={16} className="animate-spin" />
                                Deleting...
                            </>
                        ) : (
                            'Delete'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
