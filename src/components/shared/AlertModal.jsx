import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import './AlertModal.css';

/**
 * The app's stand-in for window.alert() — every other message box in this
 * codebase is the browser's native alert(), which looks nothing like the
 * rest of the UI and can't be themed. This is deliberately generic (title +
 * message + OK) rather than built for one caller, so the next place that
 * wants to stop using alert() can reach for this instead of writing its own.
 *
 * Portaled to document.body rather than relying on this being top-level in
 * whatever renders it — the CustomSelect incident documented in CLAUDE.md is
 * exactly the failure mode of assuming that: a caller nested inside another
 * modal (this exists because AddCustomerModal's ZIP lookup needs it) must
 * still out-stack that modal, and a portal is what makes that not depend on
 * where in the tree this gets mounted.
 */
const AlertModal = ({ open, title = 'Notice', message, onClose }) => {
    if (!open) return null;

    return createPortal(
        <div className="modal-overlay alert-modal-overlay" onClick={onClose}>
            <div className="alert-modal" onClick={(e) => e.stopPropagation()}>
                <button className="alert-modal-close" onClick={onClose} aria-label="Close">
                    <X size={16} />
                </button>
                <div className="alert-modal-icon">
                    <AlertTriangle size={26} />
                </div>
                <h3 className="alert-modal-title">{title}</h3>
                {message && <p className="alert-modal-message">{message}</p>}
                <button className="alert-modal-ok" onClick={onClose}>OK</button>
            </div>
        </div>,
        document.body
    );
};

export default AlertModal;
