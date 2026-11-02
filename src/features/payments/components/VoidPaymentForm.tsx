import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { formatMoney, methodOf } from '../../../utils/paymentsReceived';
import type { Payment } from '../types';

/** Void a payment: a reason is required; it stays in the list, struck through, out of the totals. */
export default function VoidPaymentForm({ payment, onVoid, onClose }: {
  payment: Payment; onVoid: (reason: string) => Promise<unknown>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const error = reason.trim() ? '' : 'Say why it’s being voided';

  const submit = async () => {
    setSubmitted(true);
    if (error) { goToField('reason'); return; }
    setSaving(true);
    setServerError('');
    try { await onVoid(reason.trim()); } catch (err) { setServerError((err as Error).message); setSaving(false); }
  };

  return (
    <FormModal
      title={<>Void payment <span className="fm-title-sub">· {payment.customerName}</span></>}
      size="s"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Void payment"
      savingLabel="Voiding…"
      submitTone="danger"
      saving={saving}
      dirtyCount={reason.trim() ? 1 : 0}
      discardTitle="Close without voiding?"
      errors={submitted && error ? { reason: error } : {}}
      showErrors={submitted}
      fieldLabels={{ reason: 'Reason' }}
    >
      {serverError ? <div className="pay-form-error" role="alert">{serverError}</div> : null}
      <FormSection>
        <p className="pay-void-what">
          {methodOf(payment.method)?.short} · <strong className={payment.cents < 0 ? 'pay-neg' : undefined}>{formatMoney(payment.cents)}</strong>
          {payment.invoice ? ` · ${payment.invoice}` : ''}. It stays in the list, struck through, and drops out of the totals.
        </p>
        <FormField name="reason" id="pay-void-reason" label="Reason" required error={submitted ? error : ''}>
          <textarea id="pay-void-reason" className="fm-input" rows={3} maxLength={300} disabled={saving}
            autoCapitalize="sentences" value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
