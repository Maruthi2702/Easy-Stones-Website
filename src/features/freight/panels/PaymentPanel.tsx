import { AlertTriangle } from 'lucide-react';
import { Drawer } from '../parts/Drawer';
import { Loading } from '../parts/Loading';
import { CopyButton } from '../parts/CopyButton';
import { formatCents } from '../../../accounting/money';
import { shortDate, paymentMethodText } from '../freightView';
import { getPayment } from '../freightApi';
import { useLoad } from './useLoad';
import { dateTime } from './panelText';
import type { Loose } from '../../../types/records';
import type { FreightActions } from '../types';

/** A payment: the PAY- id, how it was paid, and every charge it covered. */
export function PaymentPanel({ paymentId, onClose, act }: { paymentId: string; onClose: () => void; act: FreightActions }) {
  const { data: p, error } = useLoad(() => getPayment(paymentId), [paymentId]);
  return (
    <Drawer label={`Payment ${paymentId}`} kicker="Payment" onClose={onClose}>
      {error ? <div className="fr-note error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div> : null}
      {!p && !error ? <Loading /> : null}
      {p ? (
        <>
          <div className="fr-dh">
            <div className="fr-grow" style={{ minWidth: 0 }}>
              <div className="fr-dh-kicker">{p.carrier?.name || 'Carrier'} · {p.charges.length} charge{p.charges.length === 1 ? '' : 's'}{p.invoice ? ` · invoice #${p.invoice.invoiceNumber}` : ''}</div>
              <h2 className="fr-dh-title">{formatCents(p.totalCents)}</h2>
              <div className="fr-idline">
                <span className="fr-mono">{p.paymentId}</span>
                <CopyButton value={p.paymentId} label="Copy payment ID" />
              </div>
            </div>
            <span className="fr-pill paid">Paid</span>
          </div>
          <section className="fr-sec" aria-label="Payment details">
            <h3>Payment</h3>
            <dl className="fr-kv">
              <dt>Paid on</dt><dd>{shortDate(p.paidOn)}</dd>
              <dt>Method</dt><dd>{paymentMethodText(p)}</dd>
              <dt>Recorded</dt><dd>{dateTime(p.recordedAt)}{p.recordedBy?.name ? ` by ${p.recordedBy.name}` : ''}</dd>
              <dt>Approval</dt><dd>{p.approvedInSameStep ? 'Approved and paid in one step' : 'Approved before payment'}</dd>
            </dl>
          </section>
          <section className="fr-sec" aria-label="Charges this paid">
            <h3>Charges this paid</h3>
            {p.charges.map((c: Loose) => (
              <div className="fr-crow" key={c._id}>
                <button type="button" onClick={() => act.openCharge(String(c._id))}><b>SO# {c.soNumber || '—'}</b> · {c.customerName || 'No customer'}</button>
                <b>{formatCents(c.amountCents)}</b>
                <span className="fr-crow-sub">{shortDate(c.deliveryDate)}{c.bolNumber ? ` · ${c.bolNumber}` : ''} · {c.location}</span>
              </div>
            ))}
          </section>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--fr-muted)' }}>Search this payment ID or the reference on 3rd-Party Freight to find these charges again. Each history line has its own TX- ID.</p>
        </>
      ) : null}
    </Drawer>
  );
}
