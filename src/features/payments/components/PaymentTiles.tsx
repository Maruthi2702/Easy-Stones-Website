import { RECEIVED_METHODS, formatMoney, type paymentTotals } from '../../../utils/paymentsReceived';

type Totals = ReturnType<typeof paymentTotals>;

/**
 * One tile per method and the day's total. A tile is also the quickest
 * method filter: tap it to list only that method, again (or Total) for all.
 */
export default function PaymentTiles({ totals, method, onMethod }: {
  totals: Totals; method: string; onMethod: (method: string) => void;
}) {
  return (
    <div className="pay-tiles">
      {RECEIVED_METHODS.map((m) => {
        const t = totals.byMethod[m.key];
        const on = method === m.key;
        const noun = m.key === 'return' ? (t.count === 1 ? 'return' : 'returns') : (t.count === 1 ? 'payment' : 'payments');
        return (
          <button key={m.key} type="button" className={`pay-tile${on ? ' is-on' : ''}`} aria-pressed={on}
            title={on ? 'Show every method' : `Show only ${m.short}`} onClick={() => onMethod(on ? 'all' : m.key)}>
            <span className="pay-tile-k">{m.short}</span>
            <span className={`pay-tile-v${t.cents < 0 ? ' pay-neg' : ''}`}>{formatMoney(t.cents)}</span>
            <span className="pay-tile-c">{t.count} {noun}</span>
          </button>
        );
      })}
      <button type="button" className={`pay-tile is-total${method === 'all' ? ' is-on' : ''}`} aria-pressed={method === 'all'}
        title="Show every method" onClick={() => onMethod('all')}>
        <span className="pay-tile-k">Total for the day</span>
        <span className="pay-tile-v">{formatMoney(totals.net)}</span>
        <span className="pay-tile-c">
          {totals.count} {totals.count === 1 ? 'entry' : 'entries'}
          {totals.returned ? ` · ${formatMoney(totals.taken)} taken, ${formatMoney(totals.returned)} returned` : ''}
        </span>
      </button>
    </div>
  );
}
