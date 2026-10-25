import { Users } from 'lucide-react';
import ReportSection from '../ReportSection';
import { ReportCell } from '../ReportCell';
import { n, total } from '../../reportFigures';
import type { SheetEditors } from '../../sheetEditing';
import type { DayTotals, Report } from '../../types';

export type VisitorsSectionProps = {
  report: Report;
  totals: DayTotals;
  locked: boolean;
  setPath: SheetEditors['setPath'];
};

/** Visitors: homeowners from the check-in log (read-only), fabricators and designers typed. */
export default function VisitorsSection({ report, totals, locked, setPath }: VisitorsSectionProps) {
  return (
    <ReportSection
      title="Visitors"
      icon={Users}
      source={{ kind: 'auto', label: `${n(report.visitors.homeowners)} from the check-in log` }}
      footnote="Homeowners are counted from today's check-in log. If someone didn't sign in, check them in on the kiosk."
    >
      <table className="dr-table">
        <tbody>
          {([
            ['Homeowners', 'visitors.homeowners', true],
            ['Fabricators', 'visitors.fabricators', false],
            ['Designers', 'visitors.designers', false]
          ] as [string, string, boolean][]).map(([label, path, derived]) => (
            <tr key={path}>
              <td>{label}</td>
              <td className="dr-num">
                {/* Homeowners is the check-in log's count, refreshed on
                    every load (applyDerived), so it can't be typed over —
                    a typed figure would just snap back. */}
                <ReportCell
                  value={report.visitors[path.split('.')[1] as 'homeowners']}
                  derived={derived}
                  readOnly={derived}
                  title={derived ? 'From the check-in log' : undefined}
                  disabled={locked}
                  ariaLabel={label}
                  onChange={(v) => setPath(path, v)}
                />
              </td>
            </tr>
          ))}
          <tr className="dr-total"><td>Total</td><td className="dr-num">{total(totals.visitors, report.visitors.fabricators, report.visitors.designers) === '—' && !totals.visitors ? '—' : totals.visitors}</td></tr>
        </tbody>
      </table>
    </ReportSection>
  );
}
