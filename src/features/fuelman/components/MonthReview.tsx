import { useCallback } from 'react';
import type { ExpenseLine, FuelMetadata, MissingIdentity, ReportDetail, ReviewDriver } from '../../../fuelman/types';
import { FUEL_MAN as P } from '../../../fuelman/permissions';
import { fuelApi } from '../api';
import { money, monthName } from '../format';
import { changeFrom, groupCharges, suggestionsFor } from '../monthReview';
import type { Decision } from '../forms/DecisionForm';
import { useFuelQuery } from '../useFuelQuery';
import { AbsenceItem, CardItem, ChargeItem, CheckList, LocationBars } from './reviewItems';
import { arrow, useReviewActions } from '../reviewActions';
// The typical month on one page: the total, what needs a person, what was checked, and how it
// compares with last month. Everything else lives under Details. (A first month, with many
// unmatched cards, is SetupReview.)
export default function MonthReview({ report, metadata, reload, onSaved, onAssign, onMissing, onClassify, onDecision, onDetails }: {
  report: ReportDetail; metadata: FuelMetadata; reload: number; onSaved: () => void; onAssign: (d: ReviewDriver) => void;
  onMissing: (m: MissingIdentity) => void; onClassify: (lines: ExpenseLine[]) => void; onDecision: (a: Decision) => void; onDetails: () => void;
}) {
  const actions = useReviewActions(report, onSaved);
  const canPublish = metadata.permissions.includes(P.APPROVE) && (!report.currentPublishedReportId || metadata.permissions.includes(P.REVERSE));
  const cards = suggestionsFor(report, metadata), absences = report.review.missing.filter(m => !m.resolved);
  const read = useCallback((signal: AbortSignal) => fuelApi.lines(report.id, { externalId: '', unknownOnly: true, search: '', category: '', priorOnly: false }, 1, 100, signal), [report.id]);
  const unknown = useFuelQuery(JSON.stringify([report.id, report.version, reload]), read);
  const groups = groupCharges(unknown.data?.items || []), unknownCount = unknown.data?.total ?? 0;
  const items = cards.length + absences.length + (unknownCount ? Math.max(groups.length, 1) : 0);
  const change = changeFrom(report.totalCents, report.compare?.previousTotalCents);
  const matched = report.compare?.carriedOverCount ?? 0;
  const anyLeft = items > 0 || !report.review.ready;
  return <div className="fuel-mr">
    <section className="fuel-mr-hero">
      <p className="fuel-mr-total">{money(report.totalCents)}</p>
      <p className="fuel-mr-lede"><strong>{matched ? 'Most of this was matched from last month.' : 'Here is this month.'}</strong>{' '}
        <span className="fuel-muted">{matched ? `${matched} of ${report.employeeCount} drivers were matched automatically` : `${report.employeeCount} drivers`}
        {report.review.allocatedCents === report.totalCents ? ', and the charges add up to the Fuelman report.' : '.'}</span></p>
      <p className="fuel-mr-chips">{change.direction !== 'none' && <span className="fuel-status posted">{arrow[change.direction]} {Math.abs(change.pct!)}% vs {monthName(report.compare!.previousMonth)}</span>}
        <span className="fuel-muted">{report.lineCount} charges</span></p>
    </section>

    <h3 className="fuel-mr-label">{items ? `Needs a look · ${items}` : 'Nothing needs a look'}</h3>
    {actions.error && <p className="fuel-error" role="alert">{actions.error}</p>}
    <section className="fuel-mr-todo">
      {cards.map((c, i) => <CardItem key={c.driver.externalId} n={i + 1} c={c} actions={actions} onChoose={onAssign} />)}
      {absences.map((m, i) => <AbsenceItem key={m.externalId} n={cards.length + i + 1} m={m} actions={actions} onMore={onMissing} />)}
      {unknown.loading && <p role="status" className="fuel-muted">Checking for unknown charges…</p>}
      {groups.map((g, i) => <ChargeItem key={g.key} n={cards.length + absences.length + i + 1} g={g} actions={actions} onMore={onClassify} />)}
      {unknownCount > 100 && <p className="fuel-muted">Showing the first 100 of {unknownCount} unknown charges. Sort these, then check again.</p>}
      {!items && !unknown.loading && <p className="fuel-muted">Every card, absence and charge is settled.</p>}
    </section>

    <h3 className="fuel-mr-label">Checked for you</h3>
    <CheckList report={report} />

    {!!report.review.locations.length && <><h3 className="fuel-mr-label">By location{report.compare ? `, compared with ${monthName(report.compare.previousMonth)}` : ''}</h3><LocationBars report={report} /></>}

    <div className="fuel-mr-dock">
      <p className="fuel-muted">Approving adds these to each location's {monthName(report.month)} expenses. No payment is created, and you can reverse it later with a note.</p>
      <div className="fuel-actions"><button onClick={onDetails}>Details</button>
        {canPublish && <button className="fuel-primary" disabled={anyLeft || report.periodClosed} onClick={() => onDecision('publish')}>{anyLeft ? `${items || 'Some'} to check` : `Approve ${monthName(report.month)}`}</button>}</div>
    </div>
  </div>;
}
