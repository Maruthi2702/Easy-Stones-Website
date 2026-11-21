import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ban, CornerUpLeft, MoreHorizontal } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, FormRow } from '../../../components/shared/form/FormControls';
import { formatMoney, isBigReceipt, usDate, fieldsOf } from '../../../utils/cardReceipts';
import { categoryText, isPdfUrl, statusLine } from '../cardReceiptsView';
import { StatusChip } from './ExpenseList';
import type { Category, Expense } from '../types';

export type ExpenseDrawerProps = {
  expense: Expense;
  categories: Category[];
  canEdit: boolean;
  onEdit: () => void;
  onVoid: () => void;
  onApprove: (comment: string) => Promise<unknown>;
  onSendBack: (comment: string) => Promise<unknown>;
  onClose: () => void;
};

const when = (at: string) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

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
 * the main one. An approver's Send back, a cardholder's Void.
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
 * form shell with the receipt and everything saved as read-only fields. The
 * main button is the one thing to do — Approve receipt for someone who may
 * approve it, else Edit receipt for the cardholder — and the ⋯ holds the rest
 * (Send back / Void). An approver's comment is a field; a lost receipt needs
 * it to approve, and Send back always does.
 */
export default function ExpenseDrawer({ expense: e, categories, canEdit, onEdit, onVoid, onApprove, onSendBack, onClose }: ExpenseDrawerProps) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'' | 'approve' | 'back'>('');
  const [error, setError] = useState('');
  const fields = fieldsOf(categories.find((c) => c.name === e.category), e.subcategory);
  const line = statusLine(e, categories);

  useEffect(() => { setComment(''); setError(''); }, [e.id]);

  const decide = async (kind: 'approve' | 'back') => {
    setBusy(kind);
    setError('');
    try {
      await (kind === 'approve' ? onApprove(comment.trim()) : onSendBack(comment.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };
  const needsComment = Boolean(e.lostReason);
  const canVoid = canEdit && !e.canDecide && e.status !== 'missing';
  // A Missing receipt row is a charge on the Amex statement: it gets its receipt (or a lost reason), never voided.
  const editLabel = e.status === 'missing' ? 'Add receipt' : e.status === 'draft' || e.status === 'sent_back' ? 'Finish it' : 'Edit receipt';

  const main = e.canDecide
    ? { label: 'Approve receipt', saving: 'Approving…', disabled: needsComment && !comment.trim(), run: () => decide('approve') }
    : canEdit ? { label: editLabel, saving: '', disabled: false, run: onEdit } : null;

  const more = e.canDecide || canVoid ? (
    <MoreMenu>
      {e.canDecide ? (
        <button type="button" role="menuitem" className="ccr-more-item" disabled={Boolean(busy) || !comment.trim()}
          title={comment.trim() ? undefined : 'Write what needs fixing in the comment first'} onClick={() => decide('back')}>
          <CornerUpLeft size={18} aria-hidden="true" />{busy === 'back' ? 'Sending…' : 'Send back'}
        </button>
      ) : null}
      {canVoid ? (
        <button type="button" role="menuitem" className="ccr-more-item is-danger" onClick={onVoid}>
          <Ban size={18} aria-hidden="true" />Void receipt
        </button>
      ) : null}
    </MoreMenu>
  ) : null;

  const uploaded = `Uploaded ${when(e.createdAt)} · ${e.holderName}`;

  return (
    <FormModal
      title={`Receipt · ${e.merchant}`}
      size="m"
      onClose={onClose}
      onSubmit={() => { if (main && !main.disabled && !busy) main.run(); }}
      submitLabel={main?.label}
      savingLabel={main?.saving || undefined}
      saving={busy === 'approve'}
      submitDisabled={Boolean(main?.disabled) || busy === 'back'}
      hideSubmit={!main}
      headerActions={more}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      {e.voided ? <div className="ccr-note is-error">Voided by {e.voided.by || 'someone'}: {e.voided.reason}</div> : null}
      {e.status === 'sent_back' && e.sentBack ? (
        <div className="ccr-note is-warn"><AlertTriangle size={16} aria-hidden="true" /><span><b>Sent back by {e.sentBack.byName}:</b> {e.sentBack.comment}</span></div>
      ) : line ? <div className="ccr-note">{line}</div> : null}

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
            <FormRow>
              <Ro label="Date">{usDate(e.date)}</Ro>
              <Ro label="Cardholder">{e.holderName} · {e.cardLabel}</Ro>
            </FormRow>
            <Ro label="Category">{e.category ? categoryText(categories, e) : <span className="ccr-muted">Not picked</span>}</Ro>
            {fields.customer || e.customerName ? <Ro label="Customer">{e.customerName || <span className="ccr-muted">Not chosen</span>}</Ro> : null}
          </div>
        </div>
      </FormSection>

      <FormSection>
        <FormRow>
          <Ro label="Subtotal">{e.subtotalCents != null ? formatMoney(e.subtotalCents) : '—'}</Ro>
          <Ro label="Tax">{e.taxCents != null ? formatMoney(e.taxCents) : '—'}</Ro>
        </FormRow>
        <FormRow>
          <Ro label="Tip">{e.tipCents != null ? formatMoney(e.tipCents) : '—'}</Ro>
          <Ro label="Branch">{e.location || '—'}</Ro>
        </FormRow>
        {fields.attendees || e.attendees.length ? <Ro label={`Who attended (${e.attendees.length})`}>{e.attendees.join(', ') || <span className="ccr-muted">Nobody added</span>}</Ro> : null}
        {e.purpose ? <Ro label="Business purpose">{e.purpose}</Ro> : null}
        {e.note ? <Ro label="Note">{e.note}</Ro> : null}
        {e.recurring ? <Ro label="Recurring">Yes, every month</Ro> : null}
        {e.approval ? <Ro label="Approved">{e.approval.byName} · {when(e.approval.at)}{e.approval.comment ? ` · “${e.approval.comment}”` : ''}</Ro> : null}
      </FormSection>

      {e.canDecide ? (
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
