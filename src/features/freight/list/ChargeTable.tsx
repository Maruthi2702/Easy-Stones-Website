import { formatCents } from '../../../accounting/money';
import { plural, shortDate } from '../freightView';
import type { CarrierGroup } from '../freightView';
import { StatusCell } from '../parts/StatusCell';
import type { ChargeCells } from './chargeCells';

/** The charges as a table, one tbody per carrier with its total (desktop and tablet). */
export default function ChargeTable({ groups, showBranch, cells, onOpen }: {
  groups: CarrierGroup[]; showBranch: boolean; cells: ChargeCells; onOpen: (id: string) => void;
}) {
  const { selected, rowCheckbox, groupCheckbox, amountCell, terms, enterInvoice } = cells;
  return (
    <div className="fr-table-wrap">
      <table className="fr-table">
        <thead>
          <tr>
            <th className="chk-cell" aria-label="Select" />
            <th>Date</th><th>SO#</th><th>Customer</th>{showBranch ? <th>Branch</th> : null}<th>BOL #</th><th className="r">Amount</th><th>Status</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            <tr className="fr-grp">
              <td className="chk-cell">{groupCheckbox(g)}</td>
              <td colSpan={showBranch ? 5 : 4}>
                <span className="fr-grp-name">{g.name} {terms(g)} <span className="fr-sub">· {plural(g.items.length, 'charge')}</span> {enterInvoice(g)}</span>
              </td>
              <td className="r">{formatCents(g.cents)}</td>
              <td />
            </tr>
            {g.items.map((c) => (
              <tr key={c._id} className={`fr-row${selected.has(c._id) ? ' is-selected' : ''}`} onClick={() => onOpen(c._id)}>
                <td className="chk-cell">{rowCheckbox(c)}</td>
                <td>{shortDate(c.deliveryDate)}</td>
                <td className="fr-so">{c.soNumber || '—'}</td>
                <td>{c.customerName || c.description || '—'}</td>
                {showBranch ? <td>{c.location}</td> : null}
                <td>{c.bolNumber || '—'}</td>
                <td className="r">{amountCell(c)}</td>
                <td><StatusCell charge={c} showPaymentId={c.status === 'paid'} /></td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
