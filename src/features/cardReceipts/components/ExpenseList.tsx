import { Check } from 'lucide-react';
import { formatMoney, isBigReceipt, statusOf, usDate } from '../../../utils/cardReceipts';
import { askIsOpen, categoryText, chipShort, chipText, chipsShown, firstName, isPdfUrl, remindable, statusLine } from '../cardReceiptsView';
import type { Category, Expense } from '../types';

export function StatusChip({ status }: { status: string }) {
  const s = statusOf(status);
  return <span className={`ccr-chip is-${s?.colour || 'draft'}`}>{s?.label || status}</span>;
}

/** The approvals a receipt needs, as chips: "Accounting ✓ Maria" · "Manager or Admin — waiting". */
export function ApprovalChips({ e }: { e: Expense }) {
  const chips = chipsShown(e);
  if (!chips.length) return null;
  return (
    <span className="ccr-appr">
      {chips.map((c) => (
        <span key={c.key} className={`ccr-appr-chip${c.done ? ' is-done' : ''}`}>{chipText(c)}</span>
      ))}
    </span>
  );
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
    {askIsOpen(e) ? <span className="ccr-tag is-ask">Asked {firstName(e.ask!.toName)}</span> : null}
  </>
);

/** The short approvals line for a table row ("Acct ✓ · Mgr –"), with the full words as its title. */
const ChipsShort = ({ e }: { e: Expense }) => {
  const chips = e.status === 'waiting' ? chipsShown(e) : [];
  if (!chips.length) return null;
  return <div className="ccr-sub ccr-appr-short" title={chips.map(chipText).join(' · ')}>{chips.map(chipShort).join(' · ')}</div>;
};

/** Ticking receipts for Send reminder…: who may remind, what's ticked. */
export type ListSelection = {
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Every remindable row the filters show (not just this page) is ticked. */
  allShown: boolean;
  onToggleAll: () => void;
  /** Phone: the cards are in Select mode (a tap ticks instead of opening). */
  active: boolean;
};

export type ExpenseListProps = {
  rows: Expense[];
  isPhone: boolean;
  categories: Category[];
  /** Show who holds the card (View all, Waiting for me). */
  showHolder: boolean;
  shownCents: number;
  shownCount: number;
  onOpen: (e: Expense) => void;
  /** Absent without Send reminders. */
  selection?: ListSelection | null;
};

/**
 * The expenses: a table on desktop (Category and the receipt fold away under
 * 1024px), cards on a phone, and under them the total of what's listed. A row
 * opens the expense. With Send reminders a checkbox column (a phone's Select
 * mode) ticks receipts that aren't approved yet.
 */
export default function ExpenseList({ rows, isPhone, categories, showHolder, shownCents, shownCount, onOpen, selection = null }: ExpenseListProps) {
  const total = (
    <>
      <span>{shownCount} {shownCount === 1 ? 'expense' : 'expenses'}</span>
      <span>{formatMoney(shownCents)}</span>
    </>
  );
  if (isPhone) {
    const ticking = Boolean(selection?.active);
    return (
      <div className="ccr-cards">
        {rows.map((e) => {
          const line = statusLine(e, categories);
          const chips = e.status === 'waiting' ? chipsShown(e) : [];
          const canTick = ticking && remindable(e);
          const ticked = Boolean(selection?.selected.has(e.id));
          return (
            <button key={e.id} type="button" className={`ccr-card${ticking ? ' is-ticking' : ''}${ticked ? ' is-ticked' : ''}`}
              disabled={ticking && !canTick}
              aria-pressed={ticking ? ticked : undefined}
              onClick={() => (ticking ? selection!.onToggle(e.id) : onOpen(e))}>
              {ticking ? <span className="ccr-card-tick" aria-hidden="true">{ticked ? <Check size={14} strokeWidth={3} /> : null}</span> : null}
              <b>{e.merchant}</b>
              <span className={`ccr-amt${isBigReceipt(e.cents) ? ' is-big' : ''}`} title={isBigReceipt(e.cents) ? '$150 or more' : undefined}>{formatMoney(e.cents)}</span>
              <span className="ccr-card-meta">
                {usDate(e.date)}{showHolder ? ` · ${e.holderName}` : ''}{e.category ? ` · ${categoryText(categories, e)}` : ''}
                {line ? <><br />{line}</> : null}
                {chips.length ? <><br /><span className="ccr-appr-line">{chips.map(chipText).join(' · ')}</span></> : null}
                {askIsOpen(e) ? <><br /><span className="ccr-tag is-ask">Asked {firstName(e.ask!.toName)}</span></> : null}
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
            {selection ? (
              <th className="ccr-sel">
                <input type="checkbox" aria-label="Select all shown" checked={selection.allShown} onChange={selection.onToggleAll} />
              </th>
            ) : null}
            <th>Date</th>{showHolder ? <th>Cardholder</th> : null}<th>Merchant</th><th className="ccr-col-wide">Category</th>
            <th className="ccr-num">Amount</th><th>Status</th><th className="ccr-col-wide">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const line = statusLine(e, categories);
            return (
              <tr key={e.id} onClick={() => onOpen(e)} className={selection?.selected.has(e.id) ? 'is-ticked' : undefined}>
                {selection ? (
                  <td className="ccr-sel" onClick={(ev) => ev.stopPropagation()}>
                    {remindable(e) ? (
                      <input type="checkbox" aria-label={`Select ${e.merchant} ${formatMoney(e.cents)}`}
                        checked={selection.selected.has(e.id)} onChange={() => selection.onToggle(e.id)} />
                    ) : null}
                  </td>
                ) : null}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="ccr-link-btn" onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                    style={{ all: 'unset', cursor: 'pointer' }} aria-label={`Open ${e.merchant} ${formatMoney(e.cents)}`}>
                    {usDate(e.date)}
                  </button>
                </td>
                {showHolder ? <td><div className="ccr-who"><b>{e.holderName}</b><span>{e.cardLabel}{e.location ? ` · ${e.location}` : ''}</span></div></td> : null}
                <td>{e.merchant}</td>
                <td className="ccr-col-wide">{e.category ? categoryText(categories, e) : <span className="ccr-muted">Not picked</span>}</td>
                <td className={`ccr-num ccr-amt${isBigReceipt(e.cents) ? ' is-big' : ''}`} title={isBigReceipt(e.cents) ? '$150 or more' : undefined}>{formatMoney(e.cents)}</td>
                <td>
                  <div className="ccr-status-cell"><StatusChip status={e.status} /><Tags e={e} /></div>
                  <ChipsShort e={e} />
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
