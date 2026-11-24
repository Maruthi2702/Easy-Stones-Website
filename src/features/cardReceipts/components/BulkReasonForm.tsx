import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { formatMoney } from '../../../utils/cardReceipts';
import type { Expense } from '../types';

/**
 * Void or delete the ticked receipts with one reason (Void any receipt / Delete receipts). Each goes through the same route as a
 * single one, so a receipt the server refuses (a bank charge, say) is listed here and the rest still go.
 */
export default function BulkReasonForm({ mode, expenses, onRun, onClose }: {
  mode: 'void' | 'delete';
  expenses: Expense[];
  /** Runs them one by one; answers who couldn't be done, with the server's words. */
  onRun: (reason: string) => Promise<string[]>;
  onClose: () => void;
}) {
  const del = mode === 'delete';
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const min = del ? 5 : 1;
  const problem = reason.trim().length >= min ? '' : del ? 'Say why they’re being deleted (a few words)' : 'Say why they’re being voided';
  const n = expenses.length;
  const total = expenses.reduce((s, e) => s + e.cents, 0);
  return (
    <FormModal
      title={del ? `Delete ${n} receipt${n === 1 ? '' : 's'}?` : `Void ${n} receipt${n === 1 ? '' : 's'}?`}
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (problem) return;
        setSaving(true);
        const left = await onRun(reason.trim());
        setSaving(false);
        if (!left.length) return;
        setFailed(left);
      }}
      submitLabel={del ? `Delete ${n}` : `Void ${n}`}
      submitTone="danger"
      saving={saving}
      dirtyCount={reason ? 1 : 0}
      errors={submitted && problem ? { reason: problem } : {}}
      showErrors={submitted}
      fieldLabels={{ reason: 'Reason' }}
    >
      {failed.length ? (
        <div className="ccr-form-error" role="alert">
          {failed.length} couldn’t be {del ? 'deleted' : 'voided'}; the rest were:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{failed.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      ) : null}
      <FormSection>
        <p style={{ margin: 0 }}>
          {n} receipt{n === 1 ? '' : 's'}, {formatMoney(total)} in all. {del
            ? 'They’re removed from every list for good. A copy of each is kept with your name and the reason. To keep them in the history, void them instead.'
            : 'They stay in the history, marked voided.'}
        </p>
        <FormField name="reason" id="ccr-bulk-reason" label="Reason" required error={submitted ? problem : ''}>
          <textarea id="ccr-bulk-reason" className="fm-input fm-textarea" rows={3} maxLength={300} autoCapitalize="sentences"
            value={reason} onChange={(e) => setReason(e.target.value)} placeholder={del ? 'Test receipts, uploaded by mistake…' : 'Uploaded twice…'} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
