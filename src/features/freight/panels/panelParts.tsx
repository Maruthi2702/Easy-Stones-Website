import { Flag } from 'lucide-react';
import { CopyButton } from '../parts/CopyButton';
import { openFlagsOf, shortDate, paymentMethodText, STATUS_PILL } from '../freightView';
import type { Loose } from '../../../types/records';
import type { FreightActions, FreightUser } from '../types';
import { dateTime } from './panelText';

/** What every side panel gets from the page. */
export type PanelProps = { id: string; user: FreightUser; reloadKey: number; onClose: () => void; act: FreightActions };

/** A charge's open review flags: it can't be approved or paid until they're marked reviewed. */
export function FlagNotes({ record, canReview, onReview }: { record: Loose; canReview: boolean; onReview: () => void }) {
  const flags = openFlagsOf(record);
  if (!flags.length) return null;
  return (
    <div className="fr-note flag" role="alert">
      <Flag size={18} aria-hidden="true" />
      <div className="fr-grow">
        <b>{record.status === 'draft' ? 'Needs review' : `Delivery changed after it was ${STATUS_PILL[record.status]?.label.toLowerCase()}`}</b>
        {flags.map((f: Loose) => <div key={f._id}>{f.detail}</div>)}
        <div style={{ marginTop: 4, fontSize: 13 }}>It can’t be approved or paid until someone marks it reviewed (or voids it).</div>
      </div>
      {canReview ? <button type="button" className="fr-btn sm" onClick={onReview}>Mark reviewed</button> : null}
    </div>
  );
}

/** The payment box on a paid charge or invoice: its PAY- id (opens the payment), date, method, who recorded it. */
export function PaymentBox({ payment, onOpen }: { payment: Loose | null | undefined; onOpen: (paymentId: string) => void }) {
  if (!payment?.paymentId) return null;
  return (
    <section className="fr-sec" aria-label="Payment">
      <h3>Payment</h3>
      <div className="fr-idline" style={{ marginTop: 0, marginBottom: 10 }}>
        <button type="button" className="fr-link fr-mono" onClick={() => onOpen(payment.paymentId)}>{payment.paymentId}</button>
        <CopyButton value={payment.paymentId} label="Copy payment ID" />
      </div>
      <dl className="fr-kv">
        <dt>Paid on</dt><dd>{shortDate(payment.paidOn)}</dd>
        <dt>Method</dt><dd>{paymentMethodText(payment)}</dd>
        <dt>Recorded</dt><dd>{dateTime(payment.recordedAt)}{payment.recordedBy?.name ? ` by ${payment.recordedBy.name}` : ''}</dd>
      </dl>
    </section>
  );
}
