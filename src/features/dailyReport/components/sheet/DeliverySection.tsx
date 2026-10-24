import { Truck } from 'lucide-react';
import ReportSection from '../ReportSection';
import { ReportCell } from '../ReportCell';
import type { SheetEditors } from '../../sheetEditing';
import type { DayTotals, Report } from '../../types';

export type DeliverySectionProps = {
  report: Report;
  totals: DayTotals;
  locked: boolean;
  setPath: SheetEditors['setPath'];
  /** A slab figure typed by hand (kept in every save from now on). */
  touchCapacity: (key: string) => void;
};

/** Deliveries and pick-ups from the schedule, their slabs, returns and sinks. */
export default function DeliverySection({ report, totals, locked, setPath, touchCapacity }: DeliverySectionProps) {
  return (
    <ReportSection
      title="Delivery & Pick-Up Summary"
      icon={Truck}
      source={{ kind: 'auto', label: 'counted from the schedule' }}
      footnote="The count comes from the schedule; change the delivery board to change it. Slabs is how many went out on them."
    >
      <table className="dr-table">
        <thead>
          <tr><th /><th className="dr-num">Count</th><th className="dr-num">Slabs</th></tr>
        </thead>
        <tbody>
          {([['Deliveries', 'deliveries'], ['Pick-ups', 'pickups']] as [string, 'deliveries' | 'pickups'][]).map(([label, key]) => (
            <tr key={key}>
              <td>{label}</td>
              <td className="dr-num">
                <ReportCell value={report[key].assigned} derived readOnly disabled={locked}
                  title="From the schedule" ariaLabel={`${label} count`} onChange={() => {}} />
              </td>
              <td className="dr-num">
                <ReportCell value={report[key].capacity} derived disabled={locked}
                  ariaLabel={`${label} slabs`}
                  onChange={(v) => { touchCapacity(key); setPath(`${key}.capacity`, v); }} />
              </td>
            </tr>
          ))}
          <tr className="dr-total">
            <td>Total</td>
            <td className="dr-num">{totals.assigned}</td>
            <td className="dr-num">{totals.capacity}</td>
          </tr>
          {/* Returns sit below the Total on purpose: they came back in,
              so adding them to a total of what went out would misstate
              both. Both cells fill themselves in from the day's return
              tickets when there are any, and stay typeable either way —
              a return that never got a ticket still belongs on the
              sheet. */}
          <tr>
            <td>Returns</td>
            <td className="dr-num">
              <ReportCell value={report.returns} derived disabled={locked} ariaLabel="Returns"
                onChange={(v) => setPath('returns', v)} />
            </td>
            <td className="dr-num">
              <ReportCell value={report.returnsSlabs} derived disabled={locked}
                ariaLabel="Returns slabs"
                onChange={(v) => setPath('returnsSlabs', v)} />
            </td>
          </tr>
          <tr>
            <td>Sinks</td>
            <td className="dr-num">
              <ReportCell value={report.sinks} disabled={locked} ariaLabel="Sinks"
                onChange={(v) => setPath('sinks', v)} />
            </td>
            <td />
          </tr>
        </tbody>
      </table>
    </ReportSection>
  );
}
