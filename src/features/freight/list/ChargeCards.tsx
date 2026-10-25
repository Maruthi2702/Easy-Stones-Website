import { Fragment } from 'react';
import { formatCents } from '../../../accounting/money';
import { openFlagsOf, shortDate } from '../freightView';
import type { CarrierGroup } from '../freightView';
import { StatusCell } from '../parts/StatusCell';
import type { ChargeCells } from './chargeCells';

/** The charges as cards under each carrier's heading (phones; Freight.css shows one or the other). */
export default function ChargeCards({ groups, showBranch, cells, onOpen }: {
  groups: CarrierGroup[]; showBranch: boolean; cells: ChargeCells; onOpen: (id: string) => void;
}) {
  const { selected, rowCheckbox, groupCheckbox, amountCell, terms, enterInvoice } = cells;
  return (
    <div className="fr-cards">
      {groups.map((g) => (
        <Fragment key={g.key}>
          <div className="fr-cards-grp">
            {groupCheckbox(g)}
            <b>{g.name}</b>{terms(g)}{enterInvoice(g)}
            <span className="fr-grow" />
            <b>{formatCents(g.cents)}</b>
          </div>
          <div className="fr-cards-grid">
            {g.items.map((c) => (
              <div key={c._id} className={`fr-ccard${selected.has(c._id) ? ' is-selected' : ''}${openFlagsOf(c).length ? ' flagged' : ''}`}
                onClick={() => onOpen(c._id)}>
                {rowCheckbox(c)}
                <div className="fr-ccard-main">
                  <div className="fr-ccard-top"><b>SO# {c.soNumber || '—'}</b><span className="fr-grow" /><b>{amountCell(c)}</b></div>
                  <div className="fr-ccard-name">{c.customerName || c.description || '—'}</div>
                  <div className="fr-ccard-meta">{[shortDate(c.deliveryDate), showBranch ? c.location : null, c.bolNumber].filter(Boolean).join(' · ')}</div>
                  <StatusCell charge={c} showPaymentId={c.status === 'paid'} />
                </div>
              </div>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
