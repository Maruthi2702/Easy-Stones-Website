import { CheckCircle2, X } from 'lucide-react';
import type { FreightToast } from '../types';

/** The toast after an action; a payment's shows its PAY- id and View payment. */
export default function ToastBar({ toast, onViewPayment, onDismiss }: {
  toast: FreightToast; onViewPayment: (paymentId: string) => void; onDismiss: () => void;
}) {
  return (
    <div className="fr-toast" role="status">
      <CheckCircle2 size={18} className="ok" aria-hidden="true" />
      <span>{toast.text}{toast.paymentId ? <> · <span className="fr-mono">{toast.paymentId}</span></> : null}</span>
      {toast.paymentId ? <button type="button" className="fr-btn sm" onClick={() => onViewPayment(toast.paymentId!)}>View payment</button> : null}
      <button type="button" className="fr-search-clear" aria-label="Dismiss" onClick={onDismiss}><X size={14} /></button>
    </div>
  );
}
