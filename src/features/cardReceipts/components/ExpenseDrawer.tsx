import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ban, Bell, CornerUpLeft, HelpCircle, MessageSquareOff, MoreHorizontal, RotateCcw } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, FormRow } from '../../../components/shared/form/FormControls';
import { formatMoney, isBigReceipt, usDate, fieldsOf } from '../../../utils/cardReceipts';
import { approveProblem, holderKindOf } from '../../../utils/receiptApproval';
import { actionsOf, askIsOpen, categoryText, isPdfUrl, reminderLine, remindable, statusLine } from '../cardReceiptsView';
import type { DetailsBody } from '../cardReceiptsApi';
import { ApprovalChips, StatusChip } from './ExpenseList';
import FillDetailsSection from './FillDetailsSection';
import type { Category, Expense } from '../types';

export type ExpenseDrawerProps = {
  expense: Expense;
  categories: Category[];
  /** The viewer's day (GET /me), for "Reminded today". */
  today?: string;
  canEdit: boolean;
  /** The Send reminders switch. */
  canRemind?: boolean;
  onEdit: () => void;
  onVoid: () => void;
  onApprove: (comment: string) => Promise<unknown>;
  onAnswer: (answer: string) => Promise<unknown>;
  onSendBack: (comment: string) => Promise<unknown>;
  /** Opens "Ask manager / Admin…". */
  onAsk: () => void;
  onWithdrawAsk: () => Promise<unknown>;
  /** Opens "Reopen…". */
  onReopen: () => void;
  /** Opens "Send reminder…" for this receipt. */
  onRemind: () => void;
  onFillDetails: (body: DetailsBody) => Promise<unknown>;
  onClose: () => void;
};

const when = (at: string) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ANSWER_MIN = 2;
const ANSWER_MAX = 500;

/** One read-only value: the form template's dashed, grey field. */
function Ro({ label, children, big = false, wide = false }: { label: React.ReactNode; children: React.ReactNode; big?: boolean; wide?: boolean }) {
  return (
    <div className={`fm-field${wide ? ' ccr-ro-wide' : ''}`}>
      <span className="fm-label">{label}</span>
      <div className={`ccr-ro${big ? ' is-big' : ''}`}>{children}</div>
    </div>
  );
}

/**
 * The ⋯ beside the ✕ (FORM_TEMPLATE's headerActions): the actions that aren't
 * the main one. Send back, Ask, Withdraw question, Reopen, Send reminder, Void.
 */
function MoreMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => { if (!ref.current?.contains(ev.target as Node)) setOpen(false); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  return (
    <div className="ccr-more" ref={ref}>
      <button type="button" className="ccr-more-btn" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open ? <div className="ccr-more-menu" role="menu" onClick={() => setOpen(false)}>{children}</div> : null}
    </div>
  );
}

/**
 * An expense opened (design: claude.ai artifact **View Receipt Redesign**,
 * https://claude.ai/artifact/Utw6Z6FzkP5YAxCTJ18y4H, on FORM_TEMPLATE.md): the
 * form shell with the receipt and everything saved as read-only fields, its
 * approvals as chips ("Accounting ✓ Maria" · "Manager or Admin — waiting") and
 * any question asked about it.
 *
 * The main button is the one thing to do, by priority (the server's `actions`,
 * src/utils/receiptApproval.ts): **Answer & approve** for the person a question
 * went to, **Approve receipt** for an approver, else the cardholder's Edit. The
 * ⋯ holds the rest. A lost receipt needs the approver's comment; Send back
 * always does. An Admin's own receipt is filled in by Accounting here first.
 */
export default function ExpenseDrawer({
  expense: e, categories, today = '', canEdit, canRemind = false,
  onEdit, onVoid, onApprove, onAnswer, onSendBack, onAsk, onWithdrawAsk, onReopen, onRemind, onFillDetails, onClose
}: ExpenseDrawerProps) {
  const [comment, setComment] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<'' | 'approve' | 'answer' | 'back' | 'withdraw'>('');
  const [error, setError] = useState('');
  const fields = fieldsOf(categories.find((c) => c.name === e.category), e.subcategory);
  const line = statusLine(e, categories);
  const act = actionsOf(e);
  const reminded = reminderLine(e.reminders, today);

  useEffect(() => { setComment(''); setAnswer(''); setError(''); }, [e.id]);

  const run = async (kind: typeof busy, fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError('');
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  };

  const adminsOwn = holderKindOf(e.holderRole) === 'admin';
  const problem = act.approve ? approveProblem({
    userId: e.userId, holderRole: e.holderRole, location: e.location, cents: e.cents, status: e.status, voided: e.voided,
    approval: e.approval, secondApproval: e.secondApproval, ask: e.ask, lostReason: e.lostReason, receiptUrl: e.receiptUrl, category: e.category
  }, comment) : '';
  const needsCategory = Boolean(act.approve && adminsOwn && !e.category);
  const needsComment = Boolean(act.approve && e.lostReason && !e.receiptUrl && !adminsOwn);
  const answerLen = answer.trim().length;
  const canVoid = canEdit && !e.canDecide && e.status !== 'missing';
  // A Missing receipt row is a charge on the Amex statement: it gets its receipt (or a lost reason), never voided.
  const editLabel = e.status === 'missing' ? 'Add receipt' : e.status === 'draft' || e.status === 'sent_back' ? 'Finish it' : 'Edit receipt';
  const showRemind = canRemind && remindable(e);

  const main = act.answer
    ? { label: 'Answer & approve', saving: 'Approving…', disabled: answerLen < ANSWER_MIN || answerLen > ANSWER_MAX, kind: 'answer' as const, run: () => run('answer', () => onAnswer(answer.trim())) }
    : act.approve
      ? { label: 'Approve receipt', saving: 'Approving…', disabled: Boolean(problem), kind: 'approve' as const, run: () => run('approve', () => onApprove(comment.trim())) }
      : canEdit ? { label: editLabel, saving: '', disabled: false, kind: '' as const, run: onEdit } : null;

  const items = [
    act.sendBack ? (
      <button key="back" type="button" role="menuitem" className="ccr-more-item" disabled={Boolean(busy) || !comment.trim()}
        title={comment.trim() ? undefined : 'Write what needs fixing in the comment first'} onClick={() => run('back', () => onSendBack(comment.trim()))}>
        <CornerUpLeft size={18} aria-hidden="true" />{busy === 'back' ? 'Sending…' : 'Send back'}
      </button>
    ) : null,
    act.ask ? (
      <button key="ask" type="button" role="menuitem" className="ccr-more-item" disabled={Boolean(busy)} onClick={onAsk}>
        <HelpCircle size={18} aria-hidden="true" />Ask manager / Admin…
      </button>
    ) : null,
    act.withdrawAsk ? (
      <button key="withdraw" type="button" role="menuitem" className="ccr-more-item" disabled={Boolean(busy)} onClick={() => run('withdraw', onWithdrawAsk)}>
        <MessageSquareOff size={18} aria-hidden="true" />{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw question'}
      </button>
    ) : null,
    act.reopen ? (
      <button key="reopen" type="button" role="menuitem" className="ccr-more-item" disabled={Boolean(busy)} onClick={onReopen}>
        <RotateCcw size={18} aria-hidden="true" />Reopen…
      </button>
    ) : null,
    showRemind ? (
      <button key="remind" type="button" role="menuitem" className="ccr-more-item" disabled={Boolean(busy)} onClick={onRemind}>
        <Bell size={18} aria-hidden="true" />Send reminder…
      </button>
    ) : null,
    canVoid ? (
      <button key="void" type="button" role="menuitem" className="ccr-more-item is-danger" onClick={onVoid}>
        <Ban size={18} aria-hidden="true" />Void receipt
      </button>
    ) : null
  ].filter(Boolean);
  const more = items.length ? <MoreMenu>{items}</MoreMenu> : null;

  const uploaded = `Uploaded ${when(e.createdAt)} · ${e.holderName}`;
  const ask = e.ask;

  return (
    <FormModal
      title={`Receipt · ${e.merchant}`}
      size="m"
      onClose={onClose}
      onSubmit={() => { if (main && !main.disabled && !busy) main.run(); }}
      submitLabel={main?.label}
      savingLabel={main?.saving || undefined}
      saving={Boolean(main?.kind) && busy === main?.kind}
      submitDisabled={Boolean(main?.disabled) || (Boolean(busy) && busy !== main?.kind)}
      hideSubmit={!main}
      headerActions={more}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      {e.voided ? <div className="ccr-note is-error">Voided by {e.voided.by || 'someone'}: {e.voided.reason}</div> : null}
      {e.status === 'sent_back' && e.sentBack ? (
        <div className="ccr-note is-warn"><AlertTriangle size={16} aria-hidden="true" /><span><b>Sent back by {e.sentBack.byName}:</b> {e.sentBack.comment}</span></div>
      ) : line ? <div className="ccr-note">{line}</div> : null}
      {ask ? (
        <div className={`ccr-ask${askIsOpen(e) ? ' is-open' : ''}`}>
          <p><b>{ask.byName} asked {ask.toName}:</b> {ask.question}</p>
          {ask.answeredAt ? <p><b>{ask.toName} answered:</b> {ask.answer}</p> : null}
        </div>
      ) : null}
      {needsCategory ? <div className="ccr-note is-warn"><AlertTriangle size={16} aria-hidden="true" /><span>Pick a category first — fill it in below, then approve.</span></div> : null}
      {reminded ? <p className="ccr-reminded">{reminded}</p> : null}

      <FormSection>
        <div className="ccr-view-top">
          {e.receiptUrl ? (
            <figure className="ccr-receipt">
              {isPdfUrl(e.receiptUrl)
                ? <a className="ccr-btn" href={e.receiptUrl} target="_blank" rel="noreferrer">Open the PDF receipt</a>
                : <a className="ccr-receipt-img" href={e.receiptUrl} target="_blank" rel="noreferrer"><img src={e.receiptUrl} alt={`Receipt from ${e.merchant}`} /></a>}
              <a className="ccr-receipt-full" href={e.receiptUrl} target="_blank" rel="noreferrer">View full size</a>
            </figure>
          ) : e.lostReason ? (
            <div className="ccr-lost">
              <span className="ccr-lost-k">Lost receipt</span>
              <span className="ccr-sub">{e.mine ? 'Your reason' : `${e.holderName.split(' ')[0]}’s reason`}</span>
              <p>“{e.lostReason}”</p>
            </div>
          ) : (
            <div className="ccr-lost"><span className="ccr-lost-k">No receipt yet</span></div>
          )}
          <div className="ccr-view-fields">
            <FormRow>
              <Ro label="Amount" big><span className={isBigReceipt(e.cents) ? 'ccr-big is-big' : undefined}>{formatMoney(e.cents)}</span></Ro>
              <Ro label="Status"><StatusChip status={e.status} /></Ro>
            </FormRow>
            {e.chips?.length && (e.status === 'waiting' || e.status === 'approved') ? <Ro label="Approvals"><ApprovalChips e={e} /></Ro> : null}
            <FormRow>
              <Ro label="Date">{usDate(e.date)}</Ro>
              <Ro label="Cardholder">{e.holderName} · {e.cardLabel}</Ro>
            </FormRow>
            <Ro label="Category">{e.category ? categoryText(categories, e) : <span className="ccr-muted">Not picked</span>}</Ro>
            {fields.customer || e.customerName ? <Ro label="Customer">{e.customerName || <span className="ccr-muted">Not chosen</span>}</Ro> : null}
          </div>
        </div>
      </FormSection>

      {act.fillDetails ? <FillDetailsSection expense={e} categories={categories} onSave={onFillDetails} /> : null}

      <FormSection>
        <FormRow>
          <Ro label="Subtotal">{e.subtotalCents != null ? formatMoney(e.subtotalCents) : '—'}</Ro>
          <Ro label="Tax">{e.taxCents != null ? formatMoney(e.taxCents) : '—'}</Ro>
        </FormRow>
        <FormRow>
          <Ro label="Tip">{e.tipCents != null ? formatMoney(e.tipCents) : '—'}</Ro>
          <Ro label="Branch">{e.location || '—'}</Ro>
        </FormRow>
        {e.attendees.length ? <Ro label={`Who attended (${e.attendees.length})`}>{e.attendees.join(', ')}</Ro> : null}
        {e.purpose ? <Ro label="Business purpose">{e.purpose}</Ro> : null}
        {e.note && !act.fillDetails ? <Ro label="Note">{e.note}</Ro> : null}
        {e.recurring ? <Ro label="Recurring">Yes, every month</Ro> : null}
        {e.approval ? <Ro label="Accounting approval">{e.approval.byName} · {when(e.approval.at)}{e.approval.comment ? ` · “${e.approval.comment}”` : ''}</Ro> : null}
        {e.secondApproval ? <Ro label="Second approval">{e.secondApproval.byName} · {when(e.secondApproval.at)}{e.secondApproval.comment ? ` · “${e.secondApproval.comment}”` : ''}</Ro> : null}
      </FormSection>

      {act.answer ? (
        <FormSection>
          <FormField name="answer" id="ccr-answer" label="Your answer" required>
            <textarea id="ccr-answer" className="fm-input fm-textarea" rows={3} maxLength={ANSWER_MAX} autoCapitalize="sentences"
              value={answer} onChange={(ev) => setAnswer(ev.target.value)} placeholder="Answering approves the receipt" />
          </FormField>
          <span className="ccr-counter">{answer.length} / {ANSWER_MAX}</span>
        </FormSection>
      ) : null}

      {act.approve || act.sendBack ? (
        <FormSection>
          <FormField name="comment" id="ccr-comment" label="Comment" required={needsComment}>
            <textarea id="ccr-comment" className="fm-input fm-textarea" rows={2} maxLength={500} autoCapitalize="sentences"
              value={comment} onChange={(ev) => setComment(ev.target.value)}
              placeholder={needsComment ? 'Why you accept it without a receipt' : 'Needed to send it back'} />
          </FormField>
        </FormSection>
      ) : null}

      <FormSection>
        <details open className="ccr-hist">
          <summary>History</summary>
          <ul className="ccr-history">
            <li>{uploaded}</li>
            {[...e.history].reverse().map((h, i) => (
              <li key={i}>{when(h.at)} · {h.by || 'Someone'} {h.action}{h.changes ? `: ${h.changes}` : ''}</li>
            ))}
          </ul>
        </details>
      </FormSection>
    </FormModal>
  );
}
