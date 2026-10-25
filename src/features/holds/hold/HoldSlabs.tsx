import type { Dispatch, SetStateAction } from 'react';
import { Pencil, AlertTriangle, Check, Repeat, Plus } from 'lucide-react';
import { holdTotals, formatMoney, formatSf } from '../../../holds/holdRules';
import { formatCents } from '../../../accounting/money';
import { sharedPrice, lineAmount, slabCount } from '../../../utils/holdView';
import type { HoldLine, LotGroup } from '../types';

/** A product's lines on the hold, by bundle (lotGroups). */
export type LineGroup = LotGroup<HoldLine>;

function LotNote({ group }: { group: LineGroup }) {
  if (group.slabs < 2) return null;
  return group.mixedLots ? (
    <span className="hl-lot warn"><AlertTriangle size={13} aria-hidden="true" />{group.bundles.length} bundles · colour may vary</span>
  ) : (
    <span className="hl-lot ok"><Check size={13} aria-hidden="true" />One bundle · colours match</span>
  );
}

type HoldSlabsProps = {
  groups: LineGroup[];
  /** The hold's lines, with the prices being typed when the price editor is open. */
  pricedLines: HoldLine[];
  totals: { slabs: number; sfHundredths: number; pricedCents: number; missingPrices: number };
  act: { prices: boolean; slabs: boolean };
  offered: unknown[];
  draft: Record<string, string> | null;
  setDraft: Dispatch<SetStateAction<Record<string, string> | null>>;
  priceErrors: Record<string, string>;
  busy: boolean;
  selected: Set<string>;
  selectable: boolean;
  onAddFromCart: () => void;
  startPrices: () => void;
  onCancelPrices: () => void;
  savePrices: () => void;
  toggle: (slabKey: string) => void;
  toggleGroup: (group: LineGroup) => void;
  setGroupPrice: (group: LineGroup, value: string) => void;
  onSwap: (line: HoldLine) => void;
};

/**
 * The Slabs tab: Add from cart and the price editor's buttons, each product's
 * slabs with their prices (inputs while editing), ticks and Swap, and the totals.
 */
export default function HoldSlabs({
  groups, pricedLines, totals, act, offered, draft, setDraft, priceErrors, busy, selected, selectable,
  onAddFromCart, startPrices, onCancelPrices, savePrices, toggle, toggleGroup, setGroupPrice, onSwap
}: HoldSlabsProps) {
  return (
    <>
      {(act.prices || offered.length > 0) ? (
        <div className="hl-slab-tools">
          {offered.length > 0 && !draft ? (
            <button type="button" className="hl-btn" onClick={onAddFromCart}><Plus size={16} aria-hidden="true" />Add from cart ({offered.length})</button>
          ) : null}
          <span className="hl-grow" />
          {act.prices && !draft ? <button type="button" className="hl-btn" onClick={startPrices}><Pencil size={16} aria-hidden="true" />Edit prices</button> : null}
          {draft ? (
            <>
              <button type="button" className="hl-btn" disabled={busy} onClick={onCancelPrices}>Cancel</button>
              <button type="button" className="hl-btn gold" disabled={busy} onClick={savePrices}>{busy ? 'Saving…' : 'Save prices'}</button>
            </>
          ) : null}
        </div>
      ) : null}
      {Object.keys(priceErrors).length ? (
        <div className="hl-note error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>Enter each price like 12.50 — or leave it blank for no price yet.</span></div>
      ) : null}

      {groups.map((g) => {
        const groupTotals = holdTotals(pricedLines.filter((l) => l.product === g.product));
        const groupAll = g.lines.every((l) => selected.has(l.slabKey));
        return (
          <section key={g.product} className="hl-group">
            <div className="hl-group-head">
              {selectable ? (
                <input type="checkbox" className="hl-chk" checked={groupAll} aria-label={`Select every ${g.product} slab`} onChange={() => toggleGroup(g)} />
              ) : null}
              <div className="hl-group-name">
                <b>{g.product}</b>
                <span className="hl-muted">{slabCount(g.slabs)} · {formatSf(g.sfHundredths)}</span>
                <LotNote group={g} />
              </div>
              {draft ? (
                <label className="hl-price-all">
                  <span>Price / SF for all</span>
                  <input className="hl-price" inputMode="decimal" placeholder="$0.00" value={sharedPrice(g.lines, draft)}
                    onChange={(e) => setGroupPrice(g, e.target.value)} aria-label={`Price per SF for every ${g.product} slab`} />
                </label>
              ) : null}
              <span className="hl-group-total">
                {groupTotals.totalCents !== null ? formatMoney(groupTotals.totalCents) : groupTotals.pricedCents ? `${formatMoney(groupTotals.pricedCents)} so far` : <span className="hl-miss">No price</span>}
              </span>
            </div>
            <div className={`hl-slabs${selectable ? ' has-chk' : ''}${act.slabs && !draft ? ' has-swap' : ''}`}>
              <div className="hl-slab hl-slab-head" aria-hidden="true">
                {selectable ? <span /> : null}
                <span className="hl-s-serial">Serial #</span><span className="hl-s-barcode">Barcode</span><span className="hl-s-bundle">Bundle</span>
                <span className="hl-s-slab">Slab · block</span><span className="hl-s-bin">Bin</span><span className="hl-s-size">Size</span>
                <span className="r">$/SF</span><span className="r">Amount</span>
                {act.slabs && !draft ? <span /> : null}
              </div>
              {g.lines.map((l) => {
                const amount = lineAmount(l, draft);
                return (
                  <div key={l.slabKey} className={`hl-slab${selected.has(l.slabKey) ? ' is-selected' : ''}`}>
                    {selectable ? (
                      <span className="hl-s-chk"><input type="checkbox" className="hl-chk" checked={selected.has(l.slabKey)} onChange={() => toggle(l.slabKey)} aria-label={`Select ${l.serial || l.slabKey}`} /></span>
                    ) : null}
                    <span className="hl-s-serial"><b>{l.serial || l.slabKey}</b>{l.note ? <span className="hl-s-note">{l.note}</span> : null}</span>
                    <span className="hl-s-barcode">{l.barcode || '—'}</span>
                    <span className="hl-s-bundle">{l.bundle || '—'}</span>
                    <span className="hl-s-slab">{[l.slabNumber, l.block].filter(Boolean).join(' · ') || '—'}</span>
                    <span className="hl-s-bin">{l.bin || '—'}</span>
                    <span className="hl-s-size">{[l.dimensions, formatSf(l.sfHundredths)].filter(Boolean).join(' · ')}</span>
                    <span className="hl-s-price r">
                      {draft ? (
                        <input className={`hl-price${priceErrors[l.slabKey] ? ' bad' : ''}`} inputMode="decimal" placeholder="$0.00" value={draft[l.slabKey] ?? ''}
                          aria-invalid={Boolean(priceErrors[l.slabKey])} aria-label={`Price per SF for ${l.serial || l.slabKey}`}
                          onChange={(e) => setDraft((d) => ({ ...d, [l.slabKey]: e.target.value }))} />
                      ) : l.priceCentsPerSf !== null && l.priceCentsPerSf !== undefined ? `${formatCents(l.priceCentsPerSf)}` : <span className="hl-miss">—</span>}
                    </span>
                    <span className="hl-s-amount r">{amount !== null ? formatMoney(amount) : <span className="hl-miss">No price</span>}</span>
                    {act.slabs && !draft ? (
                      <span className="hl-s-swap">
                        <button type="button" className="hl-btn sm" onClick={() => onSwap(l)} aria-label={`Swap ${l.serial || l.slabKey}`}>
                          <Repeat size={14} aria-hidden="true" /><span className="hl-btn-label">Swap</span>
                        </button>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="hl-totals">
        <div><span>Subtotal · {slabCount(totals.slabs)} · {formatSf(totals.sfHundredths)}</span><b>{formatMoney(totals.pricedCents)}</b></div>
        <div className="hl-total-line">
          <span>{totals.missingPrices ? 'Total so far' : 'Total'}</span>
          <b>{totals.missingPrices === totals.slabs ? '—' : formatMoney(totals.pricedCents)}</b>
        </div>
        {totals.missingPrices ? <div className="hl-miss">{slabCount(totals.missingPrices)} {totals.missingPrices === 1 ? 'has' : 'have'} no price yet</div> : null}
      </div>
    </>
  );
}
