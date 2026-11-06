import { formatMoney, statusOf, usDate } from '../../../utils/cardReceipts';
import { categoryLabel, isPdfUrl, statusLine } from '../cardReceiptsView';
import type { Category, Expense } from '../types';

export function StatusChip({ status }: { status: string }) {
  const s = statusOf(status);
  return <span className={`ccr-chip is-${s?.colour || 'draft'}`}>{s?.label || status}</span>;
}

/** The small picture of the receipt on a row: the photo, "PDF", a dashed box when it's lost or missing. */
export function Thumb({ e }: { e: Expense }) {
  if (e.receiptUrl) {
    return isPdfUrl(e.receiptUrl)
      ? <span className="ccr-thumb is-pdf" aria-label="PDF receipt">PDF</span>
      : <img className="ccr-thumb" src={e.receiptUrl} alt="" loading="lazy" />;
  }
  return <span className={`ccr-thumb ${e.lostReason ? 'is-lost' : 'is-none'}`} aria-label={e.lostReason ? 'Lost receipt' : 'No receipt yet'} />;
}

const Tags = ({ e }: { e: Expense }) => (
  <>
    {e.lostReason ? <span className="ccr-tag">Lost receipt</span> : null}
    {e.recurring ? <span className="ccr-tag">Recurring</span> : null}
  </>
);

export type ExpenseListProps = {
  rows: Expense[];
  isPhone: boolean;
  categories: Category[];
  /** Show who holds the card (View all, Waiting for me). */
  showHolder: boolean;
  shownCents: number;
  shownCount: number;
  onOpen: (e: Expense) => void;
};

/**
 * The expenses: a table on desktop (Category and the receipt fold away under
 * 1024px), cards on a phone, and under them the total of what's listed. A row
 * opens the expense.
 */
export default function ExpenseList({ rows, isPhone, categories, showHolder, shownCents, shownCount, onOpen }: ExpenseListProps) {
  const total = (
    <>
      <span>{shownCount} {shownCount === 1 ? 'expense' : 'expenses'}</span>
      <span>{formatMoney(shownCents)}</span>
    </>
  );
  if (isPhone) {
    return (
      <div className="ccr-cards">
        {rows.map((e) => {
          const line = statusLine(e, categories);
          return (
            <button key={e.id} type="button" className="ccr-card" onClick={() => onOpen(e)}>
              <b>{e.merchant}</b>
              <span className="ccr-amt">{formatMoney(e.cents)}</span>
              <span className="ccr-card-meta">
                {usDate(e.date)}{showHolder ? ` · ${e.holderName}` : ''}{e.category ? ` · ${categoryLabel(categories, e.category)}` : ''}
                {line ? <><br />{line}</> : null}
              </span>
              <span style={{ justifySelf: 'end' }}><StatusChip status={e.status} /></span>
            </button>
          );
        })}
        <div className="ccr-shown" style={{ justifyContent: 'space-between' }}>{total}</div>
      </div>
    );
  }
  return (
    <div className="ccr-table-wrap">
      <table className="ccr-table">
        <thead>
          <tr>
            <th>Date</th>{showHolder ? <th>Cardholder</th> : null}<th>Merchant</th><th className="ccr-col-wide">Category</th>
            <th className="ccr-num">Amount</th><th>Status</th><th className="ccr-col-wide">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const line = statusLine(e, categories);
            return (
              <tr key={e.id} onClick={() => onOpen(e)}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="ccr-link-btn" onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                    style={{ all: 'unset', cursor: 'pointer' }} aria-label={`Open ${e.merchant} ${formatMoney(e.cents)}`}>
                    {usDate(e.date)}
                  </button>
                </td>
                {showHolder ? <td><div className="ccr-who"><b>{e.holderName}</b><span>{e.cardLabel}{e.location ? ` · ${e.location}` : ''}</span></div></td> : null}
                <td>{e.merchant}</td>
                <td className="ccr-col-wide">{e.category ? categoryLabel(categories, e.category) : <span className="ccr-muted">Not picked</span>}</td>
                <td className="ccr-num ccr-amt">{formatMoney(e.cents)}</td>
                <td>
                  <div className="ccr-status-cell"><StatusChip status={e.status} /><Tags e={e} /></div>
                  {line ? <div className="ccr-sub">{line}</div> : null}
                </td>
                <td className="ccr-col-wide"><Thumb e={e} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="ccr-shown">{total}</div>
    </div>
  );
}
