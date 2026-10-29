import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { deleteSummary } from './profileHeaderRules';
import { companyOf } from '../../../utils/customerList';
import type { Loose } from '../../../types/records';
import './CustomerProfile.css';

export type DeleteCustomerDialogProps = {
    customer: Loose;
    /** The delete is on its way. */
    deleting?: boolean;
    onKeep: () => void;
    onDelete: () => void;
};

/**
 * "Delete <customer>?" — the profile's own check before Delete customer
 * (canvas "Delete confirmation"): what goes with the customer, Keep customer
 * (focused first, so Enter never deletes) and a red Delete customer. A bottom
 * sheet on a phone. Esc keeps the customer.
 */
export default function DeleteCustomerDialog({ customer, deleting = false, onKeep, onDelete }: DeleteCustomerDialogProps) {
    const keepRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        keepRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deleting) { e.stopPropagation(); onKeep(); } };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [deleting, onKeep]);

    return createPortal(
        <div className="cl cp">
            <div className="cp-cf-back" onClick={deleting ? undefined : onKeep} aria-hidden="true" />
            <div className="cp-cf-wrap">
                <div className="cp-cf" role="alertdialog" aria-modal="true" aria-labelledby="cp-cf-title" aria-describedby="cp-cf-text">
                    <h2 id="cp-cf-title">Delete {companyOf(customer)}?</h2>
                    <p id="cp-cf-text">{deleteSummary(customer)}</p>
                    <div className="cp-cf-act">
                        <button type="button" ref={keepRef} className="cl-btn" disabled={deleting} onClick={onKeep}>Keep customer</button>
                        <button type="button" className="cl-btn danger" disabled={deleting} onClick={onDelete}>{deleting ? 'Deleting…' : 'Delete customer'}</button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
