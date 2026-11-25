import RowMenu from '../../../components/shared/RowMenu';
import type { RowMenuItem } from '../../../components/shared/RowMenu';
import { Check } from 'lucide-react';
import { formatMoney, isBigReceipt, statusOf, usDate } from '../../../utils/cardReceipts';
import { askIsOpen, categoryText, chipText, chipsShown, firstName, isPdfUrl, statusLine } from '../cardReceiptsView';
import { branchClass } from '../statements/statementsView';
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

/**
 * A row's background (2026-11-24; owner: only green): green = a line on the bank report answers it. That is a receipt
 * matched to its charge **and** a Missing receipt row, which is made from a report line (on the report by definition,
 * only the receipt is still to come). A receipt not on a report yet, or not known, stays plain.
 */
const rowTone = (e: Expense) => (e.onStatement === true ? 'is-ok' : '');
const toneTitle = (e: Expense) => (rowTone(e) ? (e.status === 'missing' ? 'On the bank report, receipt still to upload' : 'Matched with a line on the statement') : undefined);

const Tags = ({ e }: { e: Expense }) => (
  <>
    {e.lostReason ? <span className="ccr-tag">Lost receipt</span> : null}
    {e.recurring ? <span className="ccr-tag">Recurring</span> : null}
    {askIsOpen(e) ? <span className="ccr-tag is-ask">Asked {firstName(e.ask!.toName)}</span> : null}
  </>
);

/**
 * A table row's Status (2026-11-24, the Customers tab's look, as on Statements): a dot and the status word, then
 * a grey line — the approvals while it waits ("Accounting ✓ · Manager or Admin –", full words in its title) or
 * what's still owed — and its tags (Lost receipt, Recurring, Asked …).
 */
export function ExpenseStatus({ e, categories }: { e: Expense; categories: Category[] }) {
  const s = statusOf(e.status);
  const chips = e.status === 'waiting' ? chipsShown(e) : [];
  const detail = chips.length ? chips.map(chipText).join(' · ') : statusLine(e, categories);
  return (
    <span className="ccr-stage">
      <span className="ccr-stage-l"><span className={`ccr-sdot is-${s?.colour || 'draft'}`} aria-hidden="true" />{s?.label || e.status}<Tags e={e} /></span>
      {detail ? <span className="ccr-stage-d">{detail}</span> : null}
    </span>
  );
}

/** Ticking receipts for Send reminder…: who may remind, what's ticked. */
export type ListSelection = {
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Every remindable row the filters show (not just this page) is ticked. */
  allShown: boolean;
  onToggleAll: () => void;
  /** Phone: the cards are in Select mode (a tap ticks instead of opening). */
  active: boolean;
  /** Which rows have a checkbox (can be reminded about, voided or deleted). */
  selectable: (e: Expense) => boolean;
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
  /** Absent without Send reminders / Void any / Delete. */
  selection?: ListSelection | null;
  /** A desktop row's ⋯ (Void, Delete…); a row with no items shows none. Phone cards open the receipt, whose ⋯ has them. */
  rowActions?: (e: Expense) => RowMenuItem[];
};

/**
 * The expenses: a table on desktop (Category and the receipt fold away under
 * 1024px), cards on a phone, and under them the total of what's listed. A row
 * opens the expense. With Send reminders a checkbox column (a phone's Select
 * mode) ticks receipts that aren't approved yet.
 */
export default function ExpenseList({ rows, isPhone, categories, showHolder, shownCents, shownCount, onOpen, selection = null, rowActions }: ExpenseListProps) {
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
          const canTick = ticking && Boolean(selection?.selectable(e));
          const ticked = Boolean(selection?.selected.has(e.id));
          return (
            <button key={e.id} type="button" className={`ccr-card${ticking ? ' is-ticking' : ''}${ticked ? ' is-ticked' : ''}${rowTone(e) ? ` ${rowTone(e)}` : ''}`}
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
            <th>Date</th>{showHolder ? <th>Cardholder &amp; card</th> : null}<th>Merchant</th><th className="ccr-col-wide">Category</th>
            <th className="ccr-num">Amount</th><th>Status</th><th className="ccr-col-wide">Receipt</th>
            {rowActions ? <th className="ccr-act" aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const rowClass = [selection?.selected.has(e.id) ? 'is-ticked' : '', rowTone(e)].filter(Boolean).join(' ');
            return (
              <tr key={e.id} onClick={() => onOpen(e)} className={rowClass || undefined} title={toneTitle(e)}>
                {selection ? (
                  <td className="ccr-sel" onClick={(ev) => ev.stopPropagation()}>
                    {selection.selectable(e) ? (
                      <input type="checkbox" aria-label={`Select ${e.merchant} ${formatMoney(e.cents)}`}
                        checked={selection.selected.has(e.id)} onChange={() => selection.onToggle(e.id)} />
                    ) : null}
                  </td>
                ) : null}
                <td className="ccr-st-date">
                  <button type="button" className="ccr-link-btn" onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                    style={{ all: 'unset', cursor: 'pointer' }} aria-label={`Open ${e.merchant} ${formatMoney(e.cents)}`}>
                    {usDate(e.date)}
                  </button>
                </td>
                {showHolder ? (
                  <td>
                    <div className="ccr-st-who"><span className="ccr-av" aria-hidden="true">{(e.holderName || '?')[0].toUpperCase()}</span><span className="ccr-st-name">{e.holderName}</span></div>
                    <div className="ccr-st-card">{e.location ? <span className={`ccr-branch ${branchClass(e.location)}`}>{e.location}</span> : null}<span>{e.cardLabel}</span></div>
                  </td>
                ) : null}
                <td><div className="ccr-st-m">{e.merchant}</div></td>
                <td className="ccr-col-wide">{e.category ? categoryText(categories, e) : <span className="ccr-muted">Not picked</span>}</td>
                <td className={`ccr-num ccr-amt${isBigReceipt(e.cents) ? ' is-big' : ''}`} title={isBigReceipt(e.cents) ? '$150 or more' : undefined}>{formatMoney(e.cents)}</td>
                <td><ExpenseStatus e={e} categories={categories} /></td>
                <td className="ccr-col-wide"><Thumb e={e} /></td>
                {rowActions ? (
                  <td className="ccr-act" onClick={(ev) => ev.stopPropagation()}>
                    {(() => { const items = rowActions(e); return items.length ? <RowMenu label={`Actions for ${e.merchant} ${formatMoney(e.cents)}`} items={items} /> : null; })()}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="ccr-shown">{total}</div>
    </div>
  );
}
