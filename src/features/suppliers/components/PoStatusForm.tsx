import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormSection } from '../../../components/shared/form/FormControls';
import type { Po } from '../types';

/** Close, cancel or reopen a PO. Cancelling needs a reason; the history keeps it. */
export default function PoStatusForm({ po, status, onSave, onClose }: { po: Po; status: Po['status']; onSave: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const need = status === 'cancelled';
  const errors = { reason: need && !reason.trim() ? 'Say why it’s being cancelled' : '' };
  const title = status === 'cancelled' ? 'Cancel PO' : status === 'closed' ? 'Close PO' : 'Reopen PO';
  const approved = po.coverage.reduce((s, c) => s + c.approved, 0);

  const submit = async () => {
    setSubmitted(true);
    if (errors.reason) return;
    setSaving(true);
    try { await onSave(reason.trim()); } catch (e) { setServerError((e as Error).message); setSaving(false); }
  };

  return (
    <FormModal title={<>{title} <span className="fm-title-sub">· {po.poNumber}</span></>} size="s" onClose={onClose} onSubmit={submit}
      submitLabel={title} submitTone={status === 'cancelled' ? 'danger' : 'primary'} saving={saving} dirtyCount={reason ? 1 : 0}
      errors={submitted ? errors : {}} showErrors={submitted} fieldLabels={{ reason: 'Why' }}
      footerNote={status === 'open' ? 'The supplier can offer blocks on it again.' : 'The supplier can’t offer anything more on it. Its blocks and photos stay on record.'}>
      {serverError ? <div className="sp-form-error" role="alert">{serverError}</div> : null}
      {status === 'cancelled' && approved ? <div className="sp-banner is-warn">{approved} slabs on it are already approved to load. Tell the supplier not to load them.</div> : null}
      {status !== 'open' ? (
        <FormSection>
          <FormField name="reason" id="sp-po-reason" label="Why" required={need} error={submitted ? errors.reason : ''}>
            <textarea id="sp-po-reason" className="fm-input fm-textarea" rows={3} maxLength={300} autoCapitalize="sentences" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </FormSection>
      ) : <p className="sp-sub">Reopen PO {po.poNumber}?</p>}
    </FormModal>
  );
}
