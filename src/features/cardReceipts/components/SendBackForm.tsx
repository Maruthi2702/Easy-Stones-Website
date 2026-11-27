import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { formatMoney, usDate } from '../../../utils/cardReceipts';
import { SEND_BACK_REASONS, sendBackText } from '../../../utils/receiptApproval';
import type { Expense } from '../types';

const MAX = 500;

/** Send back…, from the opened receipt's ⋯ or a row in Waiting for me: a quick reason and/or a comment, both approvals cleared. */
export default function SendBackForm({ expense, onSendBack, onClose }: {
  expense: Expense; onSendBack: (comment: string, reason: string) => Promise<unknown>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // A reason alone is enough; Other (or no reason) needs the comment. The server checks the same rule.
  const problem = sendBackText(reason, comment).problem;
  return (
    <FormModal
      title="Send this receipt back?"
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (problem) return;
        setSaving(true);
        try { await onSendBack(comment.trim(), reason); } catch (e) { setError((e as Error).message); setSaving(false); }
      }}
      submitLabel="Send back"
      savingLabel="Sending…"
      saving={saving}
      dirtyCount={(reason ? 1 : 0) + (comment ? 1 : 0)}
      errors={submitted && problem ? { comment: problem } : {}}
      showErrors={submitted}
      fieldLabels={{ comment: 'Reason or comment' }}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      <FormSection>
        <p className="ccr-dialog-lead">{expense.holderName}’s {expense.merchant}, {formatMoney(expense.cents)} on {usDate(expense.date)}. They fix it and send it again; any approvals so far are cleared.</p>
        <FormField name="reason" id="ccr-sendback-reason" label="Reason">
          <FormPicker id="ccr-sendback-reason" value={reason} onChange={setReason}
            options={SEND_BACK_REASONS.map((r) => ({ value: r.key, label: r.label }))}
            placeholder="Pick a reason" sheetTitle="Reason" keepInForm />
        </FormField>
        <FormField name="comment" id="ccr-sendback-comment" label="Comment" required={!reason || reason === 'other'} error={submitted ? problem : ''}>
          <textarea id="ccr-sendback-comment" className="fm-input fm-textarea" rows={3} maxLength={MAX} autoCapitalize="sentences"
            value={comment} onChange={(e) => setComment(e.target.value)} placeholder={reason && reason !== 'other' ? 'Optional: what to fix' : 'Which customer was this for?'} />
        </FormField>
        <span className="ccr-counter">{comment.length} / {MAX}</span>
      </FormSection>
    </FormModal>
  );
}
