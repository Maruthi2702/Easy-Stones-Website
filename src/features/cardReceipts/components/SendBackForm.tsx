import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { formatMoney, usDate } from '../../../utils/cardReceipts';
import type { Expense } from '../types';

const MIN = 1;
const MAX = 500;

/** Send back… from a row in Waiting for me (the drawer's Send back, asked on its own): a comment saying what needs fixing, both approvals cleared. */
export default function SendBackForm({ expense, onSendBack, onClose }: {
  expense: Expense; onSendBack: (comment: string) => Promise<unknown>; onClose: () => void;
}) {
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const len = comment.trim().length;
  const problem = len < MIN ? 'Say what needs fixing' : len > MAX ? `Keep it to ${MAX} characters` : '';
  return (
    <FormModal
      title="Send this receipt back?"
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (problem) return;
        setSaving(true);
        try { await onSendBack(comment.trim()); } catch (e) { setError((e as Error).message); setSaving(false); }
      }}
      submitLabel="Send back"
      savingLabel="Sending…"
      saving={saving}
      dirtyCount={comment ? 1 : 0}
      errors={submitted && problem ? { comment: problem } : {}}
      showErrors={submitted}
      fieldLabels={{ comment: 'Comment' }}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      <FormSection>
        <p className="ccr-dialog-lead">{expense.holderName}’s {expense.merchant}, {formatMoney(expense.cents)} on {usDate(expense.date)}. They fix it and send it again; any approvals so far are cleared.</p>
        <FormField name="comment" id="ccr-sendback-comment" label="Comment" required error={submitted ? problem : ''}>
          <textarea id="ccr-sendback-comment" className="fm-input fm-textarea" rows={3} maxLength={MAX} autoCapitalize="sentences"
            value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Which customer was this for?" />
        </FormField>
        <span className="ccr-counter">{comment.length} / {MAX}</span>
      </FormSection>
    </FormModal>
  );
}
