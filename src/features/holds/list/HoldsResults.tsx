import { Loader2 } from 'lucide-react';
import { formatMoney, formatSf } from '../../../holds/holdRules';
import { productSummary, expiryLine, longDate, dayMonth, dateOf, slabCount } from '../../../utils/holdView';
import type { Hold } from '../types';
import type { HoldList } from '../useHoldsList';

const EMPTY: Record<string, [string, string]> = {
  active: ['No active holds', 'Tick slabs on the Inventory screen, then hold them from the cart.'],
  expiring: ['Nothing expiring soon', 'Holds that end in the next 3 days show here.'],
  expired: ['No expired holds', 'An expired hold keeps its slabs for 7 more days, then lets them go.'],
  released: ['Nothing released', 'Released holds stay here, with who released them and why.'],
  all: ['No holds yet', 'Tick slabs on the Inventory screen, then hold them from the cart.']
};

/** A hold's totals (holdTotals in src/holds/holdRules.ts). */
export type HoldTotals = { slabs: number; sfHundredths: number; pricedCents: number; missingPrices: number; totalCents: number | null };

/** A hold's total, or what's priced so far when some slabs have no price. */
function TotalCell({ totals }: { totals: HoldTotals }) {
  if (totals.totalCents !== null) return <b>{formatMoney(totals.totalCents)}</b>;
  if (totals.missingPrices === totals.slabs) return <span className="hl-miss">No prices yet</span>;
  return (
    <span>
      <b>{formatMoney(totals.pricedCents)}</b>
      <span className="hl-sub hl-miss">{totals.missingPrices} without a price</span>
    </span>
  );
}

type HoldsResultsProps = {
  data: HoldList | null;
  error: string;
  tab: string;
  /** A search or branch is narrowing the list. */
  filtered: boolean;
  shownScope: string;
  onOpen: (id: string) => void;
};

/** The list's card: loading, empty, or the holds — a table on wide screens, cards on phones. */
export default function HoldsResults({ data, error, tab, filtered, shownScope, onOpen }: HoldsResultsProps) {
  const items: Hold[] = data?.items || [];
  const now = new Date();
  return (
    <div className={`hl-card${items.length ? ' has-cards' : ''}`}>
      {!data && !error ? <div className="hl-loading"><Loader2 size={28} className="hl-spin" aria-label="Loading" /></div> : null}
      {data && !items.length ? (
        <div className="hl-empty">
          <h3>{filtered ? 'No holds match' : EMPTY[tab][0]}</h3>
          {filtered ? 'Try another search or branch.' : EMPTY[tab][1]}
        </div>
      ) : null}
      {items.length ? (
        <>
          <div className="hl-table-wrap">
            <table className="hl-table">
              <thead>
                <tr>
                  <th>Hold #</th><th>Held</th><th>Customer / job</th><th>Branch · rep</th><th>Slabs</th><th className="r">Total</th><th>Hold until</th>
                </tr>
              </thead>
              <tbody>
                {items.map((h) => {
                  const exp = expiryLine(h, now);
                  return (
                    <tr key={h._id} className="hl-row" tabIndex={0} onClick={() => onOpen(String(h._id))}
                      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(String(h._id)); }}>
                      <td className="hl-num">#{h.number}</td>
                      <td>{dateOf(h.createdAt)}</td>
                      <td className="hl-cust">
                        <span className="hl-name">{h.customer?.name || '—'}</span>
                        <span className="hl-sub">{h.job || productSummary(h.products)}</span>
                      </td>
                      <td>{h.branch}<span className="hl-sub">{h.createdBy?.name || ''}</span></td>
                      <td>{slabCount(h.totals.slabs)}<span className="hl-sub">{formatSf(h.totals.sfHundredths)}</span></td>
                      <td className="r"><TotalCell totals={h.totals} /></td>
                      <td>{longDate(h.expiresOn)}<span className={`hl-sub hl-exp ${exp.tone}`}>{exp.text}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="hl-cards">
            {items.map((h) => {
              const exp = expiryLine(h, now);
              return (
                <button key={h._id} type="button" className="hl-ccard" onClick={() => onOpen(String(h._id))}>
                  <span className="hl-ccard-top">
                    <b>Hold #{h.number}</b>
                    <span className={`hl-exp-chip ${exp.tone}`}>{exp.tone === 'ok' ? dayMonth(h.expiresOn) : exp.text}</span>
                    <span className="hl-grow" />
                    <TotalCell totals={h.totals} />
                  </span>
                  <span className="hl-ccard-name">{h.customer?.name || '—'}</span>
                  <span className="hl-ccard-meta">
                    {[slabCount(h.totals.slabs), formatSf(h.totals.sfHundredths), h.createdBy?.name, shownScope !== 'mine' ? h.branch : null].filter(Boolean).join(' · ')}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
