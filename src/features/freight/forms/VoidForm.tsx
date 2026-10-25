import { useState } from 'react';
import type { ReactNode } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { ServerError } from './formParts';

/** Void a charge or invoice: a reason is required, and the record stays. */
export default function VoidForm({ title, submitLabel, onVoid, onClose }: {
  title: ReactNode; submitLabel: ReactNode; onVoid: (reason: string) => Promise<unknown>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const error = reason.trim() ? '' : 'Say why it’s being voided.';

  const submit = async () => {
    setSubmitted(true);
    if (error) { goToField('reason'); return; }
    setSaving(true);
    setServerError('');
    try { await onVoid(reason.trim()); } catch (err) { setServerError((err as Error).message); setSaving(false); }
  };

  return (
    <FormModal
      title={title}
      size="s"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={submitLabel}
      savingLabel="Voiding…"
      saving={saving}
      dirtyCount={reason.trim() ? 1 : 0}
      discardTitle="Close without voiding?"
      errors={submitted && error ? { reason: error } : {}}
      showErrors={submitted}
      fieldLabels={{ reason: 'Reason' }}
    >
      <ServerError message={serverError} />
      <FormSection>
        <FormField name="reason" id="fr-reason" label="Reason" required error={submitted ? error : ''}>
          <textarea id="fr-reason" className="fm-input" rows={3} value={reason} maxLength={300} disabled={saving}
            autoCapitalize="sentences" onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
