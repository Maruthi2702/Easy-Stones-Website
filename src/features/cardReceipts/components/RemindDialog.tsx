import { useEffect, useState } from 'react';
import { remindPreview } from '../cardReceiptsApi';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { remindDefaults } from '../cardReceiptsView';
import type { Expense, RemindBody, RemindGroups, RemindPreview, RemindResult } from '../types';

const MAX = 300;
const GROUPS: readonly { key: keyof RemindGroups; label: string }[] = [
  { key: 'approvers', label: 'Whoever still has to approve' },
  { key: 'holder', label: 'The cardholder' },
  { key: 'managers', label: 'Branch managers' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'admins', label: 'Admins' }
];

/** "Dana Whitfield, Maria Lopez", or why it's empty (it's you, or nobody holds it). */
function whoLine(g: RemindPreview['groups'][keyof RemindGroups] | undefined) {
  if (!g) return '';
  const names = g.names.slice(0, 3).join(', ') + (g.names.length > 3 ? ` +${g.names.length - 3} more` : '');
  if (!g.names.length) return g.self ? 'That’s you, so it’s skipped' : 'Nobody';
  return g.self ? `${names} (you’re skipped)` : names;
}

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
  const [preview, setPreview] = useState<RemindPreview | null>(null);
  const idsKey = expenses.map((e) => e.id).join(',');
  useEffect(() => {
    let live = true;
    remindPreview(idsKey.split(',')).then((p) => { if (live) setPreview(p); }).catch(() => { /* the form still works without names */ });
    return () => { live = false; };
  }, [idsKey]);

  const anyone = Object.values(to).some(Boolean);
  const anyWay = email || push;
  const n = expenses.length;
  const reach = preview ? new Set(GROUPS.filter((g) => to[g.key]).flatMap((g) => preview.groups?.[g.key]?.names ?? [])).size : 0;

  return (
    <FormModal
      title={!result ? 'Send reminder' : result.sent.people ? 'Reminder sent' : 'Nobody was reminded'}
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
      submitLabel={result ? 'Close' : reach ? `Send to ${reach} ${reach === 1 ? 'person' : 'people'}` : 'Send'}
      savingLabel="Sending…"
      saving={saving}
      submitDisabled={!result && (!anyone || !anyWay || !n || (!!preview?.groups && reach === 0))}
      dirtyCount={result ? 0 : message ? 1 : 0}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      {result ? (
        <FormSection>
          <RemindOutcome result={result} onAgain={() => setResult(null)} />
        </FormSection>
      ) : (
      <FormSection>
        <p className="ccr-dialog-lead">{n === 1 ? `${expenses[0].merchant} · ${expenses[0].holderName}` : `${n} receipts`}</p>
        {preview?.skipped?.length ? (
          <p className="ccr-remind-note">{preview.skipped.length === n ? 'None of these can be reminded' : `${preview.skipped.length} of these will be skipped`}: {preview.skipped.map((x) => `${x.merchant || 'A receipt'} (${x.reason.replace(/\.$/, '').toLowerCase()})`).join(', ')}.</p>
        ) : null}
        <fieldset className="ccr-remind-set">
          <legend className="fm-label">To</legend>
          {GROUPS.map((g) => (
            <label key={g.key} className="ccr-check ccr-remind-opt">
              <input type="checkbox" checked={to[g.key]} onChange={(e) => setTo((t) => ({ ...t, [g.key]: e.target.checked }))} />
              <span className="ccr-remind-text">{g.label}<span className="ccr-remind-who">{whoLine(preview?.groups?.[g.key])}</span></span>
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What Send reminder answered: who was reached, each receipt skipped with its reason, who only got one way. */
function RemindOutcome({ result, onAgain }: { result: RemindResult; onAgain: () => void }) {
  const { sent, skipped, noPhone, noEmail, noContact = [] } = result;
  return (
    <div className="ccr-remind-out" role="status">
      <p className={`ccr-remind-head ${sent.people ? 'ok' : 'none'}`}>
        <span className="ccr-remind-icon" aria-hidden="true">{sent.people ? '✓' : '!'}</span>
        {sent.people ? `${plural(sent.people, 'person', 'people')} reminded about ${plural(sent.receipts, 'receipt')}` : 'Nothing was sent'}
      </p>
      {skipped.length ? (
        <div className="ccr-remind-skips">
          <p className="ccr-remind-sub">Skipped {skipped.length}</p>
          {skipped.map((s) => (
            <div key={s.id} className="ccr-remind-skip"><strong>{s.merchant || 'A receipt'}</strong><span>{s.reason}</span></div>
          ))}
        </div>
      ) : null}
      {noPhone.length ? <p className="ccr-remind-note">No phone with the app: {noPhone.join(', ')} (email only).</p> : null}
      {noContact.length ? <p className="ccr-remind-note">Couldn’t be reached (no email address and no phone with the app): {noContact.join(', ')}.</p> : null}
      {noEmail.length ? <p className="ccr-remind-note">No email address: {noEmail.join(', ')} (phone only).</p> : null}
      {!sent.people ? <button type="button" className="ccr-btn" onClick={onAgain}>Choose who again</button> : null}
    </div>
  );
}
