import { Flag } from 'lucide-react';
import { STATUS_PILL, openFlagsOf } from '../freightView';
import type { Loose } from '../../../types/records';
import type { FreightCharge } from '../types';

/** The status pill, a flag chip when it needs review, and "On invoice". */
export function StatusCell({ charge, showPaymentId = false }: { charge: FreightCharge; showPaymentId?: boolean }) {
  const pill = STATUS_PILL[charge.status] || { label: charge.status, tone: 'void' };
  const flags = openFlagsOf(charge);
  return (
    <div>
      <div className="fr-status">
        {flags.length > 0 ? (
          <span className="fr-flag" title={flags.map((f: Loose) => f.detail).join('; ')}>
            <Flag size={12} aria-hidden="true" />Needs review
          </span>
        ) : null}
        <span className={`fr-pill ${pill.tone}`}>{pill.label}</span>
        {charge.invoiceId && charge.status !== 'paid' ? <span className="fr-terms invoice">On invoice</span> : null}
      </div>
      {showPaymentId && charge.payment?.paymentId ? <span className="fr-pid fr-mono">{charge.payment.paymentId}</span> : null}
    </div>
  );
}
