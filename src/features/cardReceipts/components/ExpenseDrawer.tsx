import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil, Ban, X } from 'lucide-react';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';
import { formatMoney, usDate, fieldsOf } from '../../../utils/cardReceipts';
import { categoryLabel, isPdfUrl, statusLine } from '../cardReceiptsView';
import { StatusChip } from './ExpenseList';
import type { Category, Expense } from '../types';

export type ExpenseDrawerProps = {
  expense: Expense;
  categories: Category[];
  /** "2 of 5" and the arrows step through the list it was opened from. */
  position: { index: number; count: number } | null;
  onStep: (by: number) => void;
  canEdit: boolean;
  onEdit: () => void;
  onVoid: () => void;
  onApprove: (comment: string) => Promise<unknown>;
  onSendBack: (comment: string) => Promise<unknown>;
  onClose: () => void;
};

const when = (at: string) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * An expense opened: the receipt beside what was saved, and — for someone who
 * may approve it — a comment with Send back / Approve. A lost receipt shows
 * the cardholder's reason, and Approve stays off until a comment is written.
 * The cardholder sees Edit and Void while it isn't approved.
 */
export default function ExpenseDrawer({ expense: e, categories, position, onStep, canEdit, onEdit, onVoid, onApprove, onSendBack, onClose }: ExpenseDrawerProps) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'' | 'approve' | 'back'>('');
  const [error, setError] = useState('');
  const fields = fieldsOf(categories.find((c) => c.name === e.category));
  const line = statusLine(e, categories);

  useEffect(() => { lockPage(); return () => unlockPage(); }, []);
  useEffect(() => { setComment(''); setError(''); }, [e.id]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  return (
    <>
      <div className="ccr-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="ccr-drawer" role="dialog" aria-modal="true" aria-label={`${e.merchant} ${formatMoney(e.cents)}`}>
        <header className="ccr-drawer-h">
          <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2>{e.merchant}</h2>
              <StatusChip status={e.status} />
            </div>
            <span className="ccr-sub" style={{ fontSize: 13 }}>{usDate(e.date)} · {e.holderName} · {e.cardLabel}{e.location ? ` · ${e.location}` : ''}</span>
          </div>
          <div className="ccr-drawer-nav">
            {position && position.count > 1 ? (
              <>
                <span className="ccr-sub">{position.index + 1} of {position.count}</span>
                <button type="button" className="ccr-round is-small" aria-label="Previous" onClick={() => onStep(-1)} disabled={position.index === 0}><ChevronLeft size={16} /></button>
                <button type="button" className="ccr-round is-small" aria-label="Next" onClick={() => onStep(1)} disabled={position.index >= position.count - 1}><ChevronRight size={16} /></button>
              </>
            ) : null}
            <button type="button" className="ccr-x" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
          </div>
        </header>

        <div className="ccr-drawer-b">
          {e.voided ? <div className="ccr-note is-error">Voided by {e.voided.by || 'someone'}: {e.voided.reason}</div> : null}
          {e.status === 'sent_back' && e.sentBack ? (
            <div className="ccr-note is-warn"><AlertTriangle size={16} aria-hidden="true" /><span><b>Sent back by {e.sentBack.byName}:</b> {e.sentBack.comment}</span></div>
          ) : line ? <div className="ccr-note">{line}</div> : null}

          <div className="ccr-drawer-grid">
            {e.receiptUrl ? (
              <figure className="ccr-receipt">
                {isPdfUrl(e.receiptUrl)
                  ? <a className="ccr-btn" href={e.receiptUrl} target="_blank" rel="noreferrer">Open the PDF receipt</a>
                  : <a href={e.receiptUrl} target="_blank" rel="noreferrer"><img src={e.receiptUrl} alt={`Receipt from ${e.merchant}`} /></a>}
                <figcaption style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="ccr-sub">Uploaded {when(e.createdAt)}</span>
                  <a href={e.receiptUrl} target="_blank" rel="noreferrer">Full size</a>
                </figcaption>
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

            <dl className="ccr-dl">
              <div><dt>Amount</dt><dd className="ccr-big">{formatMoney(e.cents)}</dd></div>
              <div><dt>Category</dt><dd>{e.category ? categoryLabel(categories, e.category) : <span className="ccr-muted">Not picked</span>}</dd></div>
              {e.subtotalCents != null || e.taxCents != null || e.tipCents != null ? (
                <div className="is-wide"><dt>On the receipt</dt><dd>
                  {[e.subtotalCents != null ? `Subtotal ${formatMoney(e.subtotalCents)}` : '', e.taxCents != null ? `Tax ${formatMoney(e.taxCents)}` : '', e.tipCents != null ? `Tip ${formatMoney(e.tipCents)}` : '']
                    .filter(Boolean).join(' · ')}
                </dd></div>
              ) : null}
              {fields.customer || e.customerName ? <div className="is-wide"><dt>Customer</dt><dd>{e.customerName || <span className="ccr-muted">Not chosen</span>}</dd></div> : null}
              {fields.attendees || e.attendees.length ? <div className="is-wide"><dt>Who attended ({e.attendees.length})</dt><dd>{e.attendees.join(', ') || <span className="ccr-muted">Nobody added</span>}</dd></div> : null}
              {e.purpose ? <div className="is-wide"><dt>Business purpose</dt><dd>{e.purpose}</dd></div> : null}
              {e.note ? <div className="is-wide"><dt>Note</dt><dd>{e.note}</dd></div> : null}
              {e.recurring ? <div><dt>Recurring</dt><dd>Yes, every month</dd></div> : null}
              <div><dt>Branch</dt><dd>{e.location || '—'}</dd></div>
              {e.approval ? <div className="is-wide"><dt>Approved</dt><dd>{e.approval.byName} · {when(e.approval.at)}{e.approval.comment ? ` · “${e.approval.comment}”` : ''}</dd></div> : null}
            </dl>
          </div>

          {e.history.length ? (
            <details>
              <summary className="ccr-sub" style={{ fontWeight: 600, cursor: 'pointer' }}>History</summary>
              <ul className="ccr-history" style={{ marginTop: 8 }}>
                {[...e.history].reverse().map((h, i) => (
                  <li key={i}>{when(h.at)} · {h.by || 'Someone'} {h.action}{h.changes ? `: ${h.changes}` : ''}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        {e.canDecide ? (
          <footer className="ccr-drawer-f">
            <label htmlFor="ccr-comment">
              Comment {needsComment ? <span style={{ color: '#f87171' }}>*</span> : <span className="ccr-muted" style={{ fontWeight: 500 }}>(needed to send back)</span>}
            </label>
            <textarea id="ccr-comment" rows={2} maxLength={500} value={comment} onChange={(ev) => setComment(ev.target.value)}
              placeholder={needsComment ? 'Why you accept it without a receipt' : 'Write a comment'} />
            {error ? <div className="ccr-note is-error" role="alert">{error}</div> : null}
            <div className="ccr-drawer-actions">
              <button type="button" className="ccr-btn warn" disabled={Boolean(busy) || !comment.trim()} onClick={() => decide('back')}
                title={comment.trim() ? undefined : 'Write what needs fixing first'}>{busy === 'back' ? 'Sending…' : 'Send back'}</button>
              <button type="button" className="ccr-btn gold" style={{ minWidth: 140 }} disabled={Boolean(busy) || (needsComment && !comment.trim())} onClick={() => decide('approve')}
                title={needsComment && !comment.trim() ? 'A lost receipt needs your comment' : undefined}>{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
            </div>
          </footer>
        ) : canEdit ? (
          <footer className="ccr-drawer-f">
            <div className="ccr-drawer-actions">
              <button type="button" className="ccr-btn" onClick={onVoid}><Ban size={16} aria-hidden="true" /> Void</button>
              <button type="button" className="ccr-btn gold" onClick={onEdit}><Pencil size={16} aria-hidden="true" /> {e.status === 'draft' || e.status === 'sent_back' ? 'Finish it' : 'Edit'}</button>
            </div>
          </footer>
        ) : null}
      </aside>
    </>
  );
}
