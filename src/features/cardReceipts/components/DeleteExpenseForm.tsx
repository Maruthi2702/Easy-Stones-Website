import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { formatMoney, usDate } from '../../../utils/cardReceipts';
import type { Expense } from '../types';

/** Delete for good, with a reason (Delete receipts, admins). A copy is kept with who deleted it and why. */
export default function DeleteExpenseForm({ expense, onDelete, onClose }: {
  expense: Expense; onDelete: (reason: string) => Promise<unknown>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const problem = reason.trim() ? '' : 'Say why it’s being deleted';
  return (
    <FormModal
      title="Delete this receipt?"
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (problem) return;
        setSaving(true);
        try { await onDelete(reason.trim()); } catch (e) { setError((e as Error).message); setSaving(false); }
      }}
      submitLabel="Delete receipt"
      submitTone="danger"
      saving={saving}
      dirtyCount={reason ? 1 : 0}
      errors={submitted && problem ? { reason: problem } : {}}
      showErrors={submitted}
      fieldLabels={{ reason: 'Reason' }}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      <FormSection>
        <p style={{ margin: 0 }}>{expense.merchant}, {formatMoney(expense.cents)} on {usDate(expense.date)}. It’s removed from every list for good. A copy is kept with your name and the reason. To keep it in the history, void it instead.</p>
        <FormField name="reason" id="ccr-delete-reason" label="Reason" required error={submitted ? problem : ''}>
          <textarea id="ccr-delete-reason" className="fm-input fm-textarea" rows={3} maxLength={300} autoCapitalize="sentences"
            value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Test receipt, uploaded by mistake…" />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
