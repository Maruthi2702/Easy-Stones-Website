import { Wallet } from 'lucide-react';
import ReportSection from '../ReportSection';
import { ReportCell, MoneyCell } from '../ReportCell';
import { money } from '../../summaryFigures';
import { PAYMENT_METHODS, paymentsSaid, paymentsFromPage } from '../../../../utils/dailyReportPayments';
import type { SheetEditors } from '../../sheetEditing';
import { usePaymentsSummary } from '../../../payments';
import { formatMoney } from '../../../../utils/paymentsReceived';
import type { DayTotals, Report } from '../../types';

export type PaymentsSectionProps = {
  report: Report;
  totals: DayTotals;
  locked: boolean;
  setPath: SheetEditors['setPath'];
  declareNoPayments: SheetEditors['declareNoPayments'];
};

const figure = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * Payments taken, by method — or "Nothing taken today".
 *
 * From PAYMENTS_FROM_PAGE_SINCE (2026-11-02) the figures come from the
 * Payments page (Operations → Payments) and can't be typed here: one row per
 * method, Return included (negative), the total the net. Days before it keep
 * the typed grid, with the Payments page's total under it when it has any.
 */
export default function PaymentsSection({ report, totals, locked, setPath, declareNoPayments }: PaymentsSectionProps) {
  const paymentsUnsaid = report && !paymentsSaid(report.payments);
  const fromPageDay = paymentsFromPage(report?.date);
  // Typed days only: the Payments page's total for the day, to compare.
  const pageSummary = usePaymentsSummary(fromPageDay ? null : report?.location, fromPageDay ? null : report?.date);
  const pageCents = pageSummary?.net ?? 0;
  const typedCents = Math.round((totals.payAmount || 0) * 100);
  const returned = Number(report?.payments?.return?.amount) || 0;

  if (fromPageDay) {
    return (
      <ReportSection
        title="Payments"
        icon={Wallet}
        source={{ kind: 'auto', label: paymentsUnsaid ? 'from the Payments page · nothing recorded yet' : 'from the Payments page' }}
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
                <td className="dr-num">{figure(report.payments?.[key]?.count)}</td>
                <td className={`dr-num${Number(report.payments?.[key]?.amount) < 0 ? ' dr-pay-neg' : ''}`}>
                  {report.payments?.[key]?.amount === null || report.payments?.[key]?.amount === undefined ? '—' : money(Number(report.payments[key].amount))}
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
        <div className="dr-pay-from">
          {returned ? <>{money(totals.payAmount - returned)} taken − {money(Math.abs(returned))} returned. </> : null}
          Entered on <b>Operations → Payments</b>; change them there. They lock when this day is submitted.
        </div>
      </ReportSection>
    );
  }

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
          {/* Return came with the Payments page; typed days never had it. */}
          {PAYMENT_METHODS.filter(({ key }) => key !== 'return').map(({ label, key }) => (
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
      {pageSummary && pageSummary.count > 0 ? (
        <div className={`dr-pay-compare ${!paymentsUnsaid && typedCents === pageCents ? 'is-match' : 'is-diff'}`} role="status">
          Payments page: <strong>{formatMoney(pageCents)}</strong> ({pageSummary.count} {pageSummary.count === 1 ? 'entry' : 'entries'}
          {pageSummary.returned ? `, ${formatMoney(pageSummary.returned)} returned` : ''}).{' '}
          {paymentsUnsaid ? 'Nothing typed above yet.' : typedCents === pageCents ? 'Matches the total above.' : `The total above differs by ${formatMoney(typedCents - pageCents)}.`}
        </div>
      ) : null}
    </ReportSection>
  );
}
