import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ban, Bell, CornerUpLeft, FileText, HelpCircle, Maximize2, MessageSquareOff, MoreHorizontal, Pencil, RotateCcw, Trash2, Upload } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { billMismatch, billMismatchLine, formatMoney, isBigReceipt, usDate, fieldsOf } from '../../../utils/cardReceipts';
import WarnLines from './WarnLines';
import { approveProblem, holderKindOf } from '../../../utils/receiptApproval';
import { actionsOf, askIsOpen, categoryText, isPdfUrl, reminderLine, remindable, statusBandOf } from '../cardReceiptsView';
import type { StatusBand } from '../cardReceiptsView';
import type { DetailsBody } from '../cardReceiptsApi';
import FillDetailsSection from './FillDetailsSection';
import NearReceipts from './NearReceipts';
import ReceiptPreview from './ReceiptPreview';
import type { NearReceipts as NearList } from '../cardReceiptsApi';
import type { Category, Expense } from '../types';

export type ExpenseDrawerProps = {
  expense: Expense;
  categories: Category[];
  /** The viewer's day (GET /me), for "Reminded today". */
  today?: string;
  canEdit: boolean;
  /** Void receipt in ⋯: the holder's own rule, or the Void any receipt switch. */
  canVoid: boolean;
  /** Delete receipt in ⋯ (the Delete receipts switch). */
  canDelete?: boolean;
  /** The Send reminders switch. */
  canRemind?: boolean;
  onEdit: () => void;
  /** Attach the receipt to this expense (the "No receipt yet" box becomes a button). Absent = the box is plain text. */
  onUploadReceipt?: () => void;
  onVoid: () => void;
  onDelete?: () => void;
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
  /** A Missing receipt row's close receipts (review B2); with onUseReceipt, offered to its holder. */
  nearReceipts?: (missingId: string) => Promise<NearList>;
  /** "This is my receipt": the charge is answered by that receipt. */
  onUseReceipt?: (receiptId: string) => Promise<unknown>;
  onClose: () => void;
};

const when = (at: string) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ANSWER_MIN = 2;
const ANSWER_MAX = 500;

/** One saved value as a plain row: the label, then the value on the right. */
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <div className="ccr-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

/** The one thin strip under the title: the state, who it waits on, and the approvals so far. */
function Band({ band }: { band: StatusBand }) {
  return (
    <div className={`ccr-band is-${band.tone}`}>
      <span className="ccr-band-ico" aria-hidden="true"><b>{band.icon}</b></span>
      <div className="ccr-band-txt"><strong>{band.title}</strong>{band.sub ? <small>{band.sub}</small> : null}</div>
      {band.segs.length ? <div className="ccr-band-segs" aria-hidden="true">{band.segs.map((x, i) => <i key={i} className={x} />)}</div> : null}
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
  expense: e, categories, today = '', canEdit, canVoid, canDelete = false, canRemind = false,
  onEdit, onUploadReceipt, onVoid, onDelete, onApprove, onAnswer, onSendBack, onAsk, onWithdrawAsk, onReopen, onRemind, onFillDetails, nearReceipts, onUseReceipt, onClose
}: ExpenseDrawerProps) {
  const [comment, setComment] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<'' | 'approve' | 'answer' | 'back' | 'withdraw'>('');
  const [error, setError] = useState('');
  // "View full size": the big, zoomable receipt takes this same window's place until Back (or ✕ / Esc).
  const [viewing, setViewing] = useState(false);
  const fields = fieldsOf(categories.find((c) => c.name === e.category), e.subcategory);
  const band = statusBandOf(e, categories);
  const act = actionsOf(e);
  const reminded = reminderLine(e.reminders, today);

  useEffect(() => { setComment(''); setAnswer(''); setError(''); setViewing(false); }, [e.id]);

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
  // A Missing receipt row is a charge on the Amex statement: it gets its receipt (or a lost reason), never voided.
  const editLabel = e.status === 'missing' ? 'Add receipt' : e.status === 'draft' || e.status === 'sent_back' ? 'Finish it' : 'Edit receipt';
  const showRemind = canRemind && remindable(e);

  const main = act.answer
    ? { label: 'Answer & approve', saving: 'Approving…', disabled: answerLen < ANSWER_MIN || answerLen > ANSWER_MAX, kind: 'answer' as const, run: () => run('answer', () => onAnswer(answer.trim())) }
    : act.approve
      ? { label: 'Approve receipt', saving: 'Approving…', disabled: Boolean(problem), kind: 'approve' as const, run: () => run('approve', () => onApprove(comment.trim())) }
      : canEdit ? { label: editLabel, saving: '', disabled: false, kind: '' as const, run: onEdit } : null;

  // Approve / Answer is the main button for an approver, so Edit has no button of its own: it goes in ⋯ (2026-11-26, Admin and
  // Accounting fix a category or a missing fee before or instead of approving). Otherwise Edit is already the main button.
  const editInMenu = canEdit && !e.voided && (act.answer || act.approve);
  const items = [
    editInMenu ? (
      <button key="edit" type="button" role="menuitem" className="ccr-more-item" disabled={Boolean(busy)} onClick={onEdit}>
        <Pencil size={18} aria-hidden="true" />{editLabel}
      </button>
    ) : null,
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
    ) : null,
    canDelete && onDelete ? (
      <button key="delete" type="button" role="menuitem" className="ccr-more-item is-danger" onClick={onDelete}>
        <Trash2 size={18} aria-hidden="true" />Delete receipt…
      </button>
    ) : null
  ].filter(Boolean);
  const more = items.length ? <MoreMenu>{items}</MoreMenu> : null;

  const ask = e.ask;
  const bigView = viewing && Boolean(e.receiptUrl);

  return (
    <FormModal
      title={<span className="ccr-ttl2"><span className="ccr-ttl2-name"><span className="ccr-ttl2-pre">Receipt · </span>{e.merchant}</span></span>}
      size={bigView ? 'l' : 'm'}
      onClose={bigView ? () => setViewing(false) : onClose}
      onSubmit={() => { if (!bigView && main && !main.disabled && !busy) main.run(); }}
      submitLabel={main?.label}
      savingLabel={main?.saving || undefined}
      saving={Boolean(main?.kind) && busy === main?.kind}
      submitDisabled={Boolean(main?.disabled) || (Boolean(busy) && busy !== main?.kind)}
      hideSubmit={!main}
      hideFooter={bigView}
      headerActions={bigView ? null : more}
    >
      {bigView && e.receiptUrl ? <ReceiptPreview url={e.receiptUrl} variant="viewer" onClose={() => setViewing(false)} /> : <>
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      {e.voided ? <div className="ccr-note is-error">Voided by {e.voided.by || 'someone'}: {e.voided.reason}</div> : null}
      {ask ? (
        <div className={`ccr-ask${askIsOpen(e) ? ' is-open' : ''}`}>
          <p><b>{ask.byName} asked {ask.toName}:</b> {ask.question}</p>
          {ask.answeredAt ? <p><b>{ask.toName} answered:</b> {ask.answer}</p> : null}
        </div>
      ) : null}
      {needsCategory ? <div className="ccr-note is-warn"><AlertTriangle size={16} aria-hidden="true" /><span>Pick a category first — fill it in below, then approve.</span></div> : null}

      <FormSection>
        <div className="ccr-view-top">
          {e.receiptUrl ? (
            <figure className="ccr-receipt">
              <button type="button" className={`ccr-receipt-img${isPdfUrl(e.receiptUrl) ? ' is-pdf' : ''}`} onClick={() => setViewing(true)}
                aria-label={isPdfUrl(e.receiptUrl) ? `View the PDF receipt from ${e.merchant}` : `View the receipt from ${e.merchant} full size`}>
                {isPdfUrl(e.receiptUrl)
                  ? <span className="ccr-pdf-tile"><FileText size={44} aria-hidden="true" /><b>PDF receipt</b></span>
                  : <img src={e.receiptUrl} alt="" />}
                <span className="ccr-receipt-zoom"><Maximize2 size={14} aria-hidden="true" />{isPdfUrl(e.receiptUrl) ? 'View PDF' : 'View full size'}</span>
              </button>
            </figure>
          ) : e.lostReason ? (
            <div className="ccr-lost">
              <span className="ccr-lost-k">Lost receipt</span>
              <span className="ccr-sub">{e.mine ? 'Your reason' : `${e.holderName.split(' ')[0]}’s reason`}</span>
              <p>“{e.lostReason}”</p>
            </div>
          ) : (
            onUploadReceipt && canEdit && !e.voided ? (
              <button type="button" className="ccr-lost ccr-lost-upload" onClick={onUploadReceipt}>
                <span className="ccr-lost-k"><Upload size={16} aria-hidden="true" /> Upload receipt</span>
                <span className="ccr-sub">No receipt yet. Take a photo or pick a file.</span>
              </button>
            ) : <div className="ccr-lost"><span className="ccr-lost-k">No receipt yet</span></div>
          )}
          <div className="ccr-view-fields">
            <dl className="ccr-rows">
              <Row label="Date">{usDate(e.date)}</Row>
              <Row label="Cardholder">{e.holderName} · {e.cardLabel}</Row>
              {e.addedByName ? <Row label="Added by">{e.addedByName}</Row> : null}
              <Row label="Category">{e.category ? categoryText(categories, e) : <span className="ccr-muted">Not picked</span>}</Row>
              {fields.customer || e.customerName ? <Row label="Customer">{e.customerName || <span className="ccr-muted">Not chosen</span>}</Row> : null}
              <Row label="Branch">{e.location || '—'}</Row>
              {e.attendees.length ? <Row label={`Who attended (${e.attendees.length})`}>{e.attendees.join(', ')}</Row> : null}
              {e.purpose ? <Row label="Business purpose">{e.purpose}</Row> : null}
              {e.note && !act.fillDetails ? <Row label="Note">{e.note}</Row> : null}
              {e.recurring ? <Row label="Recurring">Yes, every month</Row> : null}
              {e.approval ? <Row label="Accounting approval">{e.approval.byName} · {when(e.approval.at)}{e.approval.comment ? ` · “${e.approval.comment}”` : ''}</Row> : null}
              {e.secondApproval ? <Row label="Second approval">{e.secondApproval.byName} · {when(e.secondApproval.at)}{e.secondApproval.comment ? ` · “${e.secondApproval.comment}”` : ''}</Row> : null}
            </dl>
            <dl className="ccr-sum">
              {e.subtotalCents != null ? <Row label="Subtotal">{formatMoney(e.subtotalCents)}</Row> : null}
              {e.feesCents != null ? <Row label="Fees">{formatMoney(e.feesCents)}</Row> : null}
              {e.taxCents != null ? <Row label="Tax">{formatMoney(e.taxCents)}</Row> : null}
              {e.tipCents != null ? <Row label="Tip">{formatMoney(e.tipCents)}</Row> : null}
              <div className={`ccr-row is-total${isBigReceipt(e.cents) ? ' is-big' : ''}`}><dt>Total</dt><dd title={isBigReceipt(e.cents) ? '$150 and up' : undefined}>{formatMoney(e.cents)}</dd></div>
            </dl>
            <WarnLines lines={[billMismatchLine(billMismatch(e))]} />
          </div>
        </div>
      </FormSection>

      {e.status === 'missing' && e.mine && canEdit && !e.voided && nearReceipts && onUseReceipt
        ? <NearReceipts missing={e} load={nearReceipts} onUse={onUseReceipt} /> : null}

      {act.fillDetails ? <FillDetailsSection expense={e} categories={categories} onSave={onFillDetails} /> : null}

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
              placeholder={needsComment ? 'Why you accept it without a receipt' : 'Optional note with your approval. Required to send back.'} />
          </FormField>
        </FormSection>
      ) : null}

      {band || reminded ? (
        <FormSection>
          <div className="ccr-state">
            {band ? <Band band={band} /> : null}
            {reminded ? <p className="ccr-reminded"><Bell size={13} aria-hidden="true" />{reminded}</p> : null}
          </div>
        </FormSection>
      ) : null}

      <FormSection>
        <details className="ccr-hist ccr-act-wrap" open>
          <summary className="ccr-act-h">Activity · {e.history.length + 1}</summary>
          <ul className="ccr-act">
            {[...e.history].reverse().map((h, i) => (
              <li key={i}><em aria-hidden="true" /><div><b>{h.by || 'Someone'} {h.action}</b>{h.changes ? <span className="ccr-act-chg">{h.changes}</span> : null}<small>{when(h.at)}</small></div></li>
            ))}
            <li><em aria-hidden="true" /><div><b>{e.addedByName || e.holderName} added the receipt{e.addedByName ? ` for ${e.holderName}` : ''}</b><small>{when(e.createdAt)}</small></div></li>
          </ul>
        </details>
      </FormSection>
      </>}
    </FormModal>
  );
}
