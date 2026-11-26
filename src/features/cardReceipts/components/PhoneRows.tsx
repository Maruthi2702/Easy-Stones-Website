import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Check } from 'lucide-react';
import { formatMoney, isBigReceipt, statusOf } from '../../../utils/cardReceipts';
import { statementKindLabel } from '../../../utils/statementRows';
import { actionsOf, askIsOpen, categoryText, chipShort, chipsShown, firstName, statusLine } from '../cardReceiptsView';
import { approveButton, groupByDay, shortStatus } from '../phoneList';
import type { Category, Expense } from '../types';
import type { ListSelection } from './ExpenseList';

/** What a row in Waiting for me can do without opening the receipt. */
export type QuickActions = {
  approve: (e: Expense) => void;
  sendBack: (e: Expense) => void;
  withdraw: (e: Expense) => void;
  /** The receipt whose approval is being saved: its buttons wait. */
  busyId: string;
};

const HOLD_MS = 450;
const MOVE_PX = 10;

/**
 * The phone's list (owner's design, 2026-11-26; variant B on the canvas): a heading per day with that day's total, then
 * that day's receipts in one rounded box. A row is the cardholder and card ID, the merchant, and the category on the
 * left; the amount and the status as coloured words (with what's still owed under them) on the right. No avatar, no
 * Select button: press and hold a row to start selecting several, then tap to tick. In Waiting for me a row also has
 * Send back / Approve buttons.
 */
export default function PhoneRows({ rows, today, categories, showHolder, selection, onOpen, quick }: {
  rows: Expense[]; today: string; categories: Category[]; showHolder: boolean;
  selection?: ListSelection | null; onOpen: (e: Expense) => void; quick?: QuickActions;
}) {
  const ticking = Boolean(selection?.active);
  const timer = useRef(0);
  const fired = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const stop = () => { window.clearTimeout(timer.current); origin.current = null; };

  const down = (e: Expense, ev: PointerEvent) => {
    if (!selection?.onStart || selection.active || !selection.selectable(e)) return;
    fired.current = false;
    origin.current = { x: ev.clientX, y: ev.clientY };
    timer.current = window.setTimeout(() => { fired.current = true; origin.current = null; selection.onStart!(e.id); }, HOLD_MS);
  };
  const move = (ev: PointerEvent) => {
    if (origin.current && Math.hypot(ev.clientX - origin.current.x, ev.clientY - origin.current.y) > MOVE_PX) stop();
  };
  const press = (e: Expense) => {
    if (fired.current) { fired.current = false; return; }
    if (ticking) { if (selection!.selectable(e)) selection!.onToggle(e.id); return; }
    onOpen(e);
  };

  return (
    <div className="ccr-pdays">
      {groupByDay(rows, today).map((g) => (
        <section key={g.day} className="ccr-pday" aria-label={g.heading}>
          <h2 className="ccr-day"><span>{g.heading}</span><span className="ccr-day-total">{formatMoney(g.cents)}</span></h2>
          <div className="ccr-pbox">
            {g.rows.map((e) => {
              const s = statusOf(e.status);
              const colour = s?.colour || 'draft';
              const chips = e.status === 'waiting' ? chipsShown(e) : [];
              const detail = chips.length ? chips.map(chipShort).join(' · ') : statusLine(e, categories);
              const ticked = Boolean(selection?.selected.has(e.id));
              const canTick = ticking && Boolean(selection?.selectable(e));
              const big = isBigReceipt(e.cents);
              const act = actionsOf(e);
              const button = quick ? approveButton(e) : null;
              const showActs = Boolean(quick && (button || act.sendBack || (act.withdrawAsk && !act.answer)));
              const busy = quick?.busyId === e.id;
              return (
                <div key={e.id} role="button" tabIndex={0}
                  className={`ccr-pr${ticking ? ' is-ticking' : ''}${ticked ? ' is-ticked' : ''}${e.onStatement === true ? ' is-ok' : ''}${ticking && !canTick ? ' is-off' : ''}`}
                  aria-pressed={ticking ? ticked : undefined}
                  onClick={() => press(e)}
                  onKeyDown={(ev: KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); press(e); } }}
                  onPointerDown={(ev) => down(e, ev)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}
                  onContextMenu={(ev) => { if (selection?.onStart) ev.preventDefault(); }}>
                  {ticking ? <span className="ccr-card-tick" aria-hidden="true">{ticked ? <Check size={14} strokeWidth={3} /> : null}</span> : null}
                  <span className="ccr-pr-main">
                    {showHolder ? <span className="ccr-pr-l1"><b>{e.holderName}</b>{e.cardLabel ? <span className="ccr-pr-id">{e.cardLabel}</span> : null}</span> : null}
                    <span className={`ccr-pr-m${showHolder ? '' : ' is-first'}`}>
                      {e.merchant}{e.statementKind ? <span className="ccr-tag" style={{ marginLeft: 8 }}>{statementKindLabel(e.statementKind)}</span> : null}
                    </span>
                    <span className="ccr-pr-l3">
                      {e.category ? <span className="ccr-tag">{categoryText(categories, e)}</span> : null}
                      {e.lostReason ? <span className="ccr-tag">Lost receipt</span> : null}
                      {e.recurring ? <span className="ccr-tag">Recurring</span> : null}
                      {askIsOpen(e) ? <span className="ccr-tag is-ask">Asked {firstName(e.ask!.toName)}</span> : null}
                    </span>
                  </span>
                  <span className="ccr-pr-r">
                    <span className={`ccr-amt${big ? ' is-big' : ''}`} title={big ? '$150 or more' : undefined}>{formatMoney(e.cents)}</span>
                    <span className={`ccr-pr-st is-${colour}`}>{shortStatus(e.status)}</span>
                    {detail ? <span className="ccr-pr-d" title={detail}>{detail}</span> : null}
                  </span>
                  {showActs ? (
                    <span className="ccr-pr-acts" onClick={(ev) => ev.stopPropagation()} onPointerDown={(ev) => ev.stopPropagation()}>
                      {act.withdrawAsk && !act.approve && !act.answer ? (
                        <button type="button" className="ccr-btn" disabled={busy} onClick={() => quick!.withdraw(e)}>Withdraw question</button>
                      ) : (
                        <>
                          {act.sendBack ? <button type="button" className="ccr-btn" disabled={busy} onClick={() => quick!.sendBack(e)}>Send back</button> : null}
                          {button ? (
                            <button type="button" className="ccr-btn gold" disabled={busy} onClick={() => (button.direct ? quick!.approve(e) : onOpen(e))}>
                              {busy ? 'Approving…' : button.label}
                            </button>
                          ) : null}
                        </>
                      )}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
