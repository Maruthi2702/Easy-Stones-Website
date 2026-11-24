import { useEffect, useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { formatMoney, usDate } from '../../../utils/cardReceipts';
import type { AskTarget, Expense } from '../types';

const MIN = 5;
const MAX = 500;
const roleWord = (role: string) => {
  const r = String(role || '').trim();
  return r ? r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, ' ') : '';
};

export type AskFormProps = {
  expense: Expense;
  /** GET /expenses/:id/ask-targets: who this question may go to. */
  loadTargets: (id: string) => Promise<{ people: AskTarget[] }>;
  onAsk: (to: string, question: string) => Promise<unknown>;
  onClose: () => void;
};

/**
 * "Ask manager / Admin…" (Accounting or an Admin): a question about a receipt
 * to the cardholder's branch manager / director or an Admin. The person asked
 * answers with a comment, which approves; asking takes back an Accounting
 * approval already given (src/utils/receiptApproval.ts).
 */
export default function AskForm({ expense, loadTargets, onAsk, onClose }: AskFormProps) {
  const [people, setPeople] = useState<AskTarget[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [to, setTo] = useState('');
  const [question, setQuestion] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    loadTargets(expense.id)
      .then((r) => { if (live) { setPeople(r.people); if (r.people.length === 1) setTo(r.people[0].id); } })
      .catch((e: Error) => { if (live) { setPeople([]); setLoadError(e.message); } });
    return () => { live = false; };
  }, [expense.id, loadTargets]);

  const len = question.trim().length;
  const problems = {
    to: to ? '' : 'Choose who to ask',
    question: len < MIN ? `Write the question (at least ${MIN} characters)` : len > MAX ? `Keep it to ${MAX} characters` : ''
  };
  const bad = Boolean(problems.to || problems.question);

  return (
    <FormModal
      title="Ask manager / Admin"
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (bad) return;
        setSaving(true);
        setError('');
        try { await onAsk(to, question.trim()); } catch (e) { setError((e as Error).message); setSaving(false); }
      }}
      submitLabel="Send question"
      savingLabel="Sending…"
      saving={saving}
      submitDisabled={people !== null && !people.length}
      dirtyCount={(to ? 1 : 0) + (question ? 1 : 0)}
      errors={submitted ? Object.fromEntries(Object.entries(problems).filter(([, v]) => v)) : {}}
      showErrors={submitted}
      fieldLabels={{ to: 'Ask', question: 'Question' }}
    >
      {error || loadError ? <div className="ccr-form-error" role="alert">{error || loadError}</div> : null}
      <FormSection>
        <p className="ccr-dialog-lead">{expense.merchant}, {formatMoney(expense.cents)} on {usDate(expense.date)} · {expense.holderName}. They answer with a comment, which approves it.</p>
        <FormField name="to" id="ccr-ask-to" label="Ask" required error={submitted ? problems.to : ''}>
          <FormPicker id="ccr-ask-to" value={to} onChange={setTo}
            options={(people || []).map((p) => ({ value: p.id, label: p.name, description: [roleWord(p.role), p.branch].filter(Boolean).join(' · '), keywords: `${p.name} ${p.branch}` }))}
            placeholder={people === null ? 'Loading…' : people.length ? 'Choose a person' : 'Nobody can be asked'}
            disabled={!people?.length} sheetTitle="Ask" keepInForm />
        </FormField>
        <FormField name="question" id="ccr-ask-question" label="Question" required error={submitted ? problems.question : ''}>
          <textarea id="ccr-ask-question" className="fm-input fm-textarea" rows={3} maxLength={MAX} autoCapitalize="sentences"
            value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What do you need to know?" />
        </FormField>
        <span className="ccr-counter">{question.length} / {MAX}</span>
      </FormSection>
    </FormModal>
  );
}
