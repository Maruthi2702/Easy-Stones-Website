import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { formatMoney, usDate } from '../../../utils/cardReceipts';
import type { Expense } from '../types';

/** Void, with a reason: the expense stays in its history, never deleted. */
export default function VoidExpenseForm({ expense, onVoid, onClose }: {
  expense: Expense; onVoid: (reason: string) => Promise<unknown>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const problem = reason.trim() ? '' : 'Say why it’s being voided';
  return (
    <FormModal
      title="Void this expense?"
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (problem) return;
        setSaving(true);
        try { await onVoid(reason.trim()); } catch (e) { setError((e as Error).message); setSaving(false); }
      }}
      submitLabel="Void expense"
      submitTone="danger"
      saving={saving}
      dirtyCount={reason ? 1 : 0}
      errors={submitted && problem ? { reason: problem } : {}}
      showErrors={submitted}
      fieldLabels={{ reason: 'Reason' }}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      <FormSection>
        <p style={{ margin: 0 }}>{expense.merchant}, {formatMoney(expense.cents)} on {usDate(expense.date)}. It stays in the list’s history, marked voided.</p>
        <FormField name="reason" id="ccr-void-reason" label="Reason" required error={submitted ? problem : ''}>
          <textarea id="ccr-void-reason" className="fm-input fm-textarea" rows={3} maxLength={300} autoCapitalize="sentences"
            value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Uploaded twice, wrong card…" />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
