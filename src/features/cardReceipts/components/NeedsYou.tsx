import { formatMoney } from '../../../utils/cardReceipts';
import { shortWeekday } from '../phoneList';
import { statusLine, TODO_SHOWN } from '../cardReceiptsView';
import type { Category, Expense } from '../types';

/**
 * The phone's "Needs you" card (owner's design, 2026-11-26): the missing-receipt banner and the To do list as one card.
 * Each row is something the cardholder has to finish — a Missing receipt (Upload receipt), a Draft or one Sent back
 * (Finish it) — with its own button; a tap opens the receipt either way.
 */
export default function NeedsYou({ todo, categories, expanded, onToggle, onOpen }: {
  todo: Expense[]; categories: Category[]; expanded: boolean; onToggle: () => void; onOpen: (e: Expense) => void;
}) {
  if (!todo.length) return null;
  const shown = expanded ? todo : todo.slice(0, TODO_SHOWN);
  const total = todo.reduce((s, e) => s + e.cents, 0);
  return (
    <section className="ccr-need" aria-label="Needs you">
      <h2 className="ccr-day"><span>Needs you · {todo.length}</span><span className="ccr-day-total">{formatMoney(total)}</span></h2>
      <div className="ccr-pbox is-need">
        {shown.map((e) => (
          <div key={e.id} className="ccr-pr is-solo" role="button" tabIndex={0} onClick={() => onOpen(e)}
            onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e); } }}>
            <span className="ccr-pr-main">
              <span className="ccr-pr-m is-first">{e.merchant}</span>
              <span className="ccr-pr-d is-line">{e.status === 'missing' ? 'Missing receipt' : e.status === 'sent_back' ? 'Sent back' : 'Draft'} · {shortWeekday(e.date).replace(/^\w+, /, '')}{statusLine(e, categories) ? ` · ${statusLine(e, categories)}` : ''}</span>
            </span>
            <span className="ccr-pr-r"><span className="ccr-amt">{formatMoney(e.cents)}</span></span>
            <span className="ccr-pr-acts" onClick={(ev) => ev.stopPropagation()}>
              <button type="button" className={`ccr-btn${e.status === 'missing' ? ' gold' : ''}`} onClick={() => onOpen(e)}>
                {e.status === 'missing' ? 'Upload receipt' : 'Finish it'}
              </button>
            </span>
          </div>
        ))}
      </div>
      {todo.length > TODO_SHOWN ? (
        <button type="button" className="ccr-btn ccr-todo-more" onClick={onToggle}>{expanded ? 'Show fewer' : `Show all ${todo.length}`}</button>
      ) : null}
    </section>
  );
}
