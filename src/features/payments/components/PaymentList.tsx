import { Pencil, Ban } from 'lucide-react';
import RowMenu from '../../../components/shared/RowMenu';
import type { RowMenuItem } from '../../../components/shared/RowMenu';
import { formatMoney, methodOf } from '../../../utils/paymentsReceived';
import { referenceText, timeLabel } from '../paymentsView';
import type { Payment } from '../types';

export type PaymentListProps = {
  rows: Payment[];
  isPhone: boolean;
  /** "Credit Card · 2 entries" — what the total line is a total of. */
  shownLabel: string;
  shownCents: number;
  shownCount: number;
  canEdit: boolean;
  canVoid: boolean;
  onEdit: (p: Payment) => void;
  onVoid: (p: Payment) => void;
};

const MethodChip = ({ method }: { method: string }) => (
  <span className={`pay-chip${method === 'return' ? ' is-return' : ''}`}>{methodOf(method)?.short || method}</span>
);

/**
 * The day's payments: a table on desktop, cards on a phone, and under them
 * the total of what's listed. A voided payment stays, struck through, with
 * who voided it and why. Edit / Void are in the row's ⋯ (none on a locked day).
 */
export default function PaymentList({ rows, isPhone, shownLabel, shownCents, shownCount, canEdit, canVoid, onEdit, onVoid }: PaymentListProps) {
  const menu = (p: Payment) => {
    if (p.voided) return null;
    const items: RowMenuItem[] = [];
    if (canEdit) items.push({ key: 'edit', label: 'Edit', icon: Pencil, onClick: () => onEdit(p) });
    if (canVoid) items.push({ key: 'void', label: 'Void…', icon: Ban, danger: true, onClick: () => onVoid(p) });
    return items.length ? <RowMenu items={items} label={`Actions for ${p.customerName} ${formatMoney(p.cents)}`} /> : null;
  };
  const voidLine = (p: Payment) => (p.voided ? <div className="pay-sub">Voided by {p.voided.by || 'someone'}: {p.voided.reason}</div> : null);
  const total = (
    <>
      <span>{shownLabel} · {shownCount} {shownCount === 1 ? 'entry' : 'entries'}</span>
      <strong className={shownCents < 0 ? 'pay-neg' : undefined}>{formatMoney(shownCents)}</strong>
    </>
  );

  if (isPhone) {
    return (
      <div className="pay-cards">
        {rows.map((p) => (
          <div key={p.id} className={`pay-card${p.voided ? ' is-void' : ''}`}>
            <div className="pay-card-main">
              <div className="pay-co">{p.customerName}</div>
              <div className="pay-sub">{timeLabel(p.createdAt)} · {p.invoice || 'No invoice #'}</div>
            </div>
            <div className={`pay-amt${p.cents < 0 ? ' pay-neg' : ''}`}>{formatMoney(p.cents)}</div>
            <div className="pay-card-meta">
              <MethodChip method={p.method} /> {referenceText(p)}
              {p.note && !p.voided ? <div className="pay-sub">{p.note}</div> : null}
              {voidLine(p)}
            </div>
            <div className="pay-card-menu">{menu(p)}</div>
          </div>
        ))}
        <div className="pay-card pay-shown">{total}</div>
      </div>
    );
  }

  return (
    <div className="pay-table-wrap">
      <table className="pay-table">
        <thead>
          <tr>
            <th>Time</th><th>Company</th><th>Method</th><th className="pay-num">Amount</th>
            <th>Invoice / SO #</th><th>Reference</th><th>Note</th><th>Entered by</th><th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={p.voided ? 'is-void' : undefined}>
              <td className="pay-sub pay-nowrap">{timeLabel(p.createdAt)}</td>
              <td><div className="pay-co">{p.customerName}</div></td>
              <td><MethodChip method={p.method} />{p.voided ? <span className="pay-void-tag">Voided</span> : null}</td>
              <td className={`pay-num pay-amt${p.cents < 0 ? ' pay-neg' : ''}`}>{formatMoney(p.cents)}</td>
              <td>{p.invoice || <span className="pay-muted">—</span>}</td>
              <td>{referenceText(p) || <span className="pay-muted">—</span>}</td>
              <td className="pay-note-cell">
                {p.note}
                {voidLine(p)}
                {p.history.filter((h) => h.action === 'edited').length ? <div className="pay-sub">Edited {p.history.filter((h) => h.action === 'edited').length}×</div> : null}
              </td>
              <td className="pay-sub pay-nowrap">{p.enteredBy}</td>
              <td className="pay-menu-cell">{menu(p)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pay-shown">
            <td colSpan={3}>{shownLabel} · {shownCount} {shownCount === 1 ? 'entry' : 'entries'}</td>
            <td className={`pay-num${shownCents < 0 ? ' pay-neg' : ''}`}><strong>{formatMoney(shownCents)}</strong></td>
            <td colSpan={5} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
