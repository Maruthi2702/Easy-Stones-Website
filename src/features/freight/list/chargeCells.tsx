import { Receipt } from 'lucide-react';
import { formatCents } from '../../../accounting/money';
import { isSelectable } from '../freightView';
import type { CarrierGroup } from '../freightView';
import type { Carrier, FreightCharge } from '../types';
import type { FreightSelection } from '../useFreightSelection';

/**
 * The pieces the table and the phone cards share: a row's and a carrier
 * group's checkbox, the amount (or "No price"), the carrier's terms, and a
 * per-invoice carrier's Enter invoice button.
 */
export function chargeCells({ selection, busy, canAdd, onNewInvoice }: {
  selection: FreightSelection; busy: boolean; canAdd: boolean; onNewInvoice: (carrier: Carrier | null) => void;
}) {
  const { selected, toggle, toggleGroup, groupState } = selection;
  const rowCheckbox = (c: FreightCharge, extra = {}) => (
    <input type="checkbox" className="fr-chk" checked={selected.has(c._id)} disabled={!isSelectable(c) || busy}
      aria-label={`Select SO# ${c.soNumber || '—'}`} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c)} {...extra} />
  );
  const groupCheckbox = (g: CarrierGroup) => {
    const s = groupState(g);
    return (
      <input type="checkbox" className="fr-chk" checked={s.all} disabled={s.none || busy} aria-label={`Select ${g.name}`}
        ref={(el) => { if (el) el.indeterminate = s.some; }} onChange={() => toggleGroup(g)} />
    );
  };
  const amountCell = (c: FreightCharge) => (c.amountCents > 0 ? formatCents(c.amountCents) : <span className="fr-miss">No price</span>);
  const terms = (g: CarrierGroup) => (g.unmatched
    ? <span className="fr-terms unmatched">Carrier not recognised</span>
    : <span className={`fr-terms${g.perInvoice ? ' invoice' : ''}`}>{g.perInvoice ? 'Paid per invoice' : 'Paid per delivery'}</span>);
  const enterInvoice = (g: CarrierGroup) => (g.perInvoice && canAdd && g.items.some((c) => c.status === 'draft' && !c.invoiceId) ? (
    <button type="button" className="fr-btn sm" onClick={(e) => { e.stopPropagation(); onNewInvoice(g.carrier); }}>
      <Receipt size={14} aria-hidden="true" />Enter invoice
    </button>
  ) : null);
  return { selected, rowCheckbox, groupCheckbox, amountCell, terms, enterInvoice };
}

export type ChargeCells = ReturnType<typeof chargeCells>;
