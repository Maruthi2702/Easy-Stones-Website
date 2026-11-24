import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { remindDefaults, remindSummary } from '../cardReceiptsView';
import type { Expense, RemindBody, RemindGroups, RemindResult } from '../types';

const MAX = 300;
const GROUPS: readonly { key: keyof RemindGroups; label: string }[] = [
  { key: 'holder', label: 'Cardholder' },
  { key: 'managers', label: 'Branch manager' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'admins', label: 'Admins' },
  { key: 'approvers', label: 'Whoever must approve' }
];

export type RemindDialogProps = {
  /** The receipts ticked (or the one open). */
  expenses: readonly Expense[];
  onSend: (body: RemindBody) => Promise<RemindResult>;
  onClose: () => void;
};

/**
 * Send reminder… about one receipt or several (POST /expenses/remind,
 * src/routes/cardReceiptReminders.ts). Who it goes to starts ticked by what the
 * receipts need — missing / draft / sent back → the cardholder, waiting →
 * whoever must approve, both when they're mixed — by email and phone
 * notification. The server skips a receipt reminded today, approved, or not the
 * sender's to remind, and says so; its answer replaces the form until Close.
 */
export default function RemindDialog({ expenses, onSend, onClose }: RemindDialogProps) {
  const [to, setTo] = useState<RemindGroups>(() => remindDefaults(expenses));
  const [email, setEmail] = useState(true);
  const [push, setPush] = useState(true);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RemindResult | null>(null);

  const anyone = Object.values(to).some(Boolean);
  const anyWay = email || push;
  const n = expenses.length;

  return (
    <FormModal
      title={result ? 'Reminder sent' : 'Send reminder'}
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        if (result) { onClose(); return; }
        if (!anyone || !anyWay || message.length > MAX) return;
        setSaving(true);
        setError('');
        try {
          const r = await onSend({ ids: expenses.map((e) => e.id), to, email, push, ...(message.trim() ? { message: message.trim() } : {}) });
          setResult(r);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
      submitLabel={result ? 'Close' : 'Send'}
      savingLabel="Sending…"
      saving={saving}
      submitDisabled={!result && (!anyone || !anyWay || !n)}
      dirtyCount={result ? 0 : message ? 1 : 0}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      {result ? (
        <FormSection>
          <p className="ccr-dialog-lead" role="status">{remindSummary(result)}</p>
        </FormSection>
      ) : (
      <FormSection>
        <p className="ccr-dialog-lead">{n === 1 ? `${expenses[0].merchant} · ${expenses[0].holderName}` : `${n} receipts`}</p>
        <fieldset className="ccr-remind-set">
          <legend className="fm-label">To</legend>
          {GROUPS.map((g) => (
            <label key={g.key} className="ccr-check ccr-remind-opt">
              <input type="checkbox" checked={to[g.key]} onChange={(e) => setTo((t) => ({ ...t, [g.key]: e.target.checked }))} /> {g.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="ccr-remind-set">
          <legend className="fm-label">How</legend>
          <label className="ccr-check ccr-remind-opt"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email</label>
          <label className="ccr-check ccr-remind-opt"><input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} /> Phone notification</label>
        </fieldset>
        <FormField name="message" id="ccr-remind-message" label="Message">
          <textarea id="ccr-remind-message" className="fm-input fm-textarea" rows={2} maxLength={MAX} autoCapitalize="sentences"
            value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional" />
        </FormField>
        <span className="ccr-counter">{message.length} / {MAX}</span>
      </FormSection>
      )}
    </FormModal>
  );
}
