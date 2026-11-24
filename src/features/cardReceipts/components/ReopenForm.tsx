import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { formatMoney, usDate } from '../../../utils/cardReceipts';
import type { Expense } from '../types';

const MIN = 5;
const MAX = 300;

/** Reopen… (Accounting or an Admin): an approved receipt goes back to waiting, both approvals cleared. */
export default function ReopenForm({ expense, onReopen, onClose }: {
  expense: Expense; onReopen: (reason: string) => Promise<unknown>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const len = reason.trim().length;
  const problem = len < MIN ? `Say why it’s being reopened (at least ${MIN} characters)` : len > MAX ? `Keep it to ${MAX} characters` : '';
  return (
    <FormModal
      title="Reopen this receipt?"
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (problem) return;
        setSaving(true);
        try { await onReopen(reason.trim()); } catch (e) { setError((e as Error).message); setSaving(false); }
      }}
      submitLabel="Reopen receipt"
      savingLabel="Reopening…"
      saving={saving}
      dirtyCount={reason ? 1 : 0}
      errors={submitted && problem ? { reason: problem } : {}}
      showErrors={submitted}
      fieldLabels={{ reason: 'Reason' }}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      <FormSection>
        <p className="ccr-dialog-lead">{expense.merchant}, {formatMoney(expense.cents)} on {usDate(expense.date)}. It goes back to Waiting for approval and both approvals are cleared.</p>
        <FormField name="reason" id="ccr-reopen-reason" label="Reason" required error={submitted ? problem : ''}>
          <textarea id="ccr-reopen-reason" className="fm-input fm-textarea" rows={3} maxLength={MAX} autoCapitalize="sentences"
            value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong category, approved by mistake…" />
        </FormField>
        <span className="ccr-counter">{reason.length} / {MAX}</span>
      </FormSection>
    </FormModal>
  );
}
