import { Package, Plus, X } from 'lucide-react';
import ReportSection from '../ReportSection';
import { ReportCell } from '../ReportCell';
import { groupContainers, groupSlabs } from '../../../../utils/dailyReportContainers';
import { n, outOfBand } from '../../reportFigures';
import type { SheetEditors } from '../../sheetEditing';
import type { DayTotals, Report, SlabRange } from '../../types';

export type ContainersSectionProps = {
  report: Report;
  totals: DayTotals;
  locked: boolean;
  slabRange: SlabRange | null;
  patch: SheetEditors['patch'];
  addContainer: SheetEditors['addContainer'];
  rowKeys: SheetEditors['rowKeys'];
};

/** Containers received: PO#, material and slabs, flagged when far outside the usual. */
export default function ContainersSection({ report, totals, locked, slabRange, patch, addContainer, rowKeys }: ContainersSectionProps) {
  /**
   * A slab count far outside what this branch usually sees (outOfBand).
   *
   * Checked per physical container, not per line: one PO split across a
   * couple of colors is a few small lines that are each "odd" on their own
   * but ordinary once added back together, so the threshold has to look at
   * the group's total, not any single line inside it.
   */
  const containerGroups = groupContainers(report?.containers || []);
  const oddContainerGroups = containerGroups.filter(g => outOfBand(slabRange, groupSlabs(g)));
  const oddContainerLines = new Set(oddContainerGroups.flatMap(g => g.lines));

  return (
    <ReportSection
      title="Containers"
      icon={Package}
      source={{ kind: 'typed', label: 'entered here' }}
      footnote={oddContainerGroups.length
        ? `${oddContainerGroups.map(groupSlabs).join(' and ')} ${oddContainerGroups.length === 1 ? 'is' : 'are'} well outside the usual ${slabRange!.low}–${slabRange!.high} slabs${slabRange!.fromHistory ? ' for this branch' : ' for a container'}. Keep it if that's right.`
        : 'Leave the PO# blank to continue the one above.'}
      footnoteTone={oddContainerGroups.length ? 'warn' : undefined}
      action={!locked && (
        <button className="dr-addrow-btn" onClick={addContainer}><Plus size={12} /> Add</button>
      )}
    >
      <table className="dr-table">
        <thead>
          <tr><th style={{ width: '22%' }}>PO#</th><th>Material</th><th className="dr-num">Slabs</th><th className="dr-x" /></tr>
        </thead>
        <tbody>
          {report.containers.length === 0 && (
            <tr><td colSpan={4} className="dr-none">No containers today.</td></tr>
          )}
          {report.containers.map((c, i) => (
            <tr key={i}>
              <td>
                <ReportCell value={c.poNumber} type="text" align="left" width={100} disabled={locked}
                  placeholder="PO number" ariaLabel="PO number"
                  onChange={(v) => patch(r => { r.containers[i].poNumber = v as string; return r; })} />
              </td>
              <td>
                <ReportCell value={c.material} type="text" align="left" disabled={locked}
                  placeholder="Material name" ariaLabel="Material"
                  onChange={(v) => patch(r => { r.containers[i].material = v as string; return r; })} />
              </td>
              <td className="dr-num">
                <ReportCell value={c.slabs} disabled={locked} ariaLabel="Container slabs"
                  className={oddContainerLines.has(c) ? 'is-odd' : ''}
                  onKeyDown={rowKeys('containers', i, addContainer, !c.poNumber && !c.material && !n(c.slabs))}
                  onChange={(v) => patch(r => { r.containers[i].slabs = v; return r; })} />
              </td>
              <td className="dr-x">
                {!locked && (
                  <button className="dr-rowdel" aria-label="Remove container line"
                    onClick={() => patch(r => { r.containers.splice(i, 1); return r; })}><X size={13} /></button>
                )}
              </td>
            </tr>
          ))}
          <tr className="dr-total">
            <td>Total</td><td />
            <td className="dr-num">{totals.containerSlabs}</td>
            <td className="dr-x" />
          </tr>
        </tbody>
      </table>
    </ReportSection>
  );
}
