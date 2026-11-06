import { STATUSES, formatMoney, statusTotals } from '../../../utils/cardReceipts';

type Totals = ReturnType<typeof statusTotals>;

/**
 * One tile per status and the period's total. A tile is also the quickest
 * status filter: tap it to list only that status, again (or Total) for all.
 * Missing receipt shows once the statement check is built; until then it only
 * appears when something holds it.
 */
export default function StatusTiles({ totals, status, onStatus, totalLabel }: {
  totals: Totals; status: string; onStatus: (status: string) => void; totalLabel: string;
}) {
  const shown = STATUSES.filter((s) => s.key !== 'missing' || totals.byStatus.missing!.count > 0);
  return (
    <div className="ccr-tiles">
      {shown.map((s) => {
        const t = totals.byStatus[s.key]!;
        const on = status === s.key;
        return (
          <button key={s.key} type="button" className={`ccr-tile${on ? ' is-on' : ''}`} aria-pressed={on}
            title={on ? 'Show every status' : `Show only ${s.label}`} onClick={() => onStatus(on ? 'all' : s.key)}>
            <span className="ccr-tile-k"><span className={`ccr-dot is-${s.colour}`} aria-hidden="true" />{s.label}</span>
            <span className="ccr-tile-v">{formatMoney(t.cents)}</span>
            <span className="ccr-tile-c">{t.count} {t.count === 1 ? 'expense' : 'expenses'}</span>
          </button>
        );
      })}
      <button type="button" className={`ccr-tile is-total${status === 'all' ? ' is-on' : ''}`} aria-pressed={status === 'all'}
        title="Show every status" onClick={() => onStatus('all')}>
        <span className="ccr-tile-k">{totalLabel}</span>
        <span className="ccr-tile-v">{formatMoney(totals.cents)}</span>
        <span className="ccr-tile-c">{totals.count} {totals.count === 1 ? 'expense' : 'expenses'}{totals.holders > 1 ? ` · ${totals.holders} cardholders` : ''}</span>
      </button>
    </div>
  );
}
