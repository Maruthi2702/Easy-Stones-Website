import { Wallet } from 'lucide-react';
import ReportSection from '../ReportSection';
import { ReportCell, MoneyCell } from '../ReportCell';
import { money } from '../../summaryFigures';
import { PAYMENT_METHODS, paymentsSaid } from '../../../../utils/dailyReportPayments';
import type { SheetEditors } from '../../sheetEditing';
import type { DayTotals, Report } from '../../types';

export type PaymentsSectionProps = {
  report: Report;
  totals: DayTotals;
  locked: boolean;
  setPath: SheetEditors['setPath'];
  declareNoPayments: SheetEditors['declareNoPayments'];
};

/** Payments taken, by method — or "Nothing taken today". */
export default function PaymentsSection({ report, totals, locked, setPath, declareNoPayments }: PaymentsSectionProps) {
  const paymentsUnsaid = report && !paymentsSaid(report.payments);

  return (
    <ReportSection
      title="Payments"
      icon={Wallet}
      source={{ kind: 'typed', label: paymentsUnsaid ? 'nothing recorded yet' : 'entered here' }}
      action={!locked && paymentsUnsaid && (
        <button className="dr-addrow-btn" onClick={declareNoPayments} title="Record that no money was taken today">
          Nothing taken today
        </button>
      )}
    >
      <table className="dr-table">
        <thead>
          <tr><th>Method</th><th className="dr-num">Transactions</th><th className="dr-num">Amount</th></tr>
        </thead>
        <tbody>
          {PAYMENT_METHODS.map(({ label, key }) => (
            <tr key={key}>
              <td>{label}</td>
              <td className="dr-num">
                <ReportCell value={report.payments[key].count} disabled={locked}
                  ariaLabel={`${label} transactions`}
                  onChange={(v) => setPath(`payments.${key}.count`, v)} />
              </td>
              <td className="dr-num">
                <MoneyCell value={report.payments[key].amount} disabled={locked}
                  ariaLabel={`${label} amount`}
                  onChange={(v) => setPath(`payments.${key}.amount`, v)} />
              </td>
            </tr>
          ))}
          <tr className="dr-total">
            <td>Total</td>
            <td className="dr-num">{paymentsUnsaid ? '—' : totals.payCount}</td>
            <td className="dr-num">{paymentsUnsaid ? '—' : money(totals.payAmount)}</td>
          </tr>
        </tbody>
      </table>
    </ReportSection>
  );
}
