import { AlertCircle, X } from 'lucide-react';

/** "Delete this scheduled activity?" */
export default function DeleteActivityDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Delete Schedule</h2>
                    <button type="button" className="close-btn" onClick={onClose}><X size={20} /></button>
                </div>
                <div className="modal-body pl-confirm">
                    <AlertCircle size={44} className="pl-confirm-icon" />
                    <p className="pl-confirm-title">Delete this scheduled activity?</p>
                    <p className="pl-confirm-note">This action cannot be undone.</p>
                </div>
                <div className="modal-footer">
                    <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                    <button type="button" onClick={onConfirm} className="btn-primary pl-danger-btn">Delete</button>
                </div>
            </div>
        </div>
    );
}
