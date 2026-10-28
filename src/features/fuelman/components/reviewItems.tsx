import type { ExpenseLine, MissingIdentity, ReportDetail, ReviewDriver } from '../../../fuelman/types';
import { categoryLabels, money, monthName } from '../format';
import { locationRows } from '../monthReview';
import type { CardSuggestion, ChargeGroup } from '../monthReview';
import { QUICK_ABSENCE, QUICK_CATEGORIES, arrow } from '../reviewActions';
import type { Actions } from '../reviewActions';
// Pieces of the monthly review that the one-page summary and the first-month flow share.
export function CardItem({ n, c, actions, onChoose }: { n: number; c: CardSuggestion; actions: Actions; onChoose: (d: ReviewDriver) => void }) {
  const { busy } = actions;
  return <div className="fuel-mr-item"><span className="fuel-mr-n" aria-hidden="true">{n}</span>
    <div><h4>New card: {c.driver.name} <span className="fuel-muted">· #{c.driver.externalId} · {money(c.driver.totalCents)}</span></h4>
      <p>{c.user ? `Looks like ${c.user.name}${c.location ? `, home location ${c.location}` : ''}.` : 'Not seen before, and no driver in Users & Roles clearly matches.'}</p></div>
    <div className="fuel-mr-acts">{c.user && c.location && <button className="fuel-primary" disabled={!!busy} onClick={() => void actions.accept(c)}>{busy === `card:${c.driver.externalId}` ? 'Saving…' : `Yes, ${c.user.name} → ${c.location}`}</button>}
      <button disabled={!!busy} onClick={() => onChoose(c.driver)}>{c.user && c.location ? 'Someone else' : 'Choose driver'}</button></div></div>;
}
export function AbsenceItem({ n, m, actions, onMore }: { n: number; m: MissingIdentity; actions: Actions; onMore: (m: MissingIdentity) => void }) {
  return <div className="fuel-mr-item"><span className="fuel-mr-n" aria-hidden="true">{n}</span>
    <div><h4>{m.driverName} had no charges</h4><p>Expected because they fueled before. What happened?</p></div>
    <div className="fuel-mr-acts">{QUICK_ABSENCE.map(q => <button key={q.reason} disabled={!!actions.busy} onClick={() => void actions.absent(m, q)}>{q.label}</button>)}
      <button disabled={!!actions.busy} onClick={() => onMore(m)}>More…</button></div></div>;
}
export function ChargeItem({ n, g, actions, onMore }: { n: number; g: ChargeGroup; actions: Actions; onMore: (lines: ExpenseLine[]) => void }) {
  return <div className="fuel-mr-item"><span className="fuel-mr-n" aria-hidden="true">{n}</span>
    <div><h4>“{g.label}” <span className="fuel-muted">· {g.lines.length} {g.lines.length === 1 ? 'charge' : 'charges'} · {money(g.totalCents)}</span></h4>
      <p>Not fuel, DEF or a known supply{g.drivers > 1 ? `, on ${g.drivers} drivers' cards` : ''}. Where should {g.lines.length === 1 ? 'it' : 'they'} go?</p></div>
    <div className="fuel-mr-acts">{QUICK_CATEGORIES.map(c => <button key={c} disabled={!!actions.busy} onClick={() => void actions.sort(g, c)}>{categoryLabels[c]}</button>)}
      <button disabled={!!actions.busy} onClick={() => onMore(g.lines)}>More…</button></div></div>;
}
export function LocationBars({ report }: { report: ReportDetail }) {
  const rows = locationRows(report);
  if (!rows.length) return null;
  return <><section className="fuel-mr-cmp">{rows.map(r => <div className="fuel-mr-loc" key={r.location}><strong>{r.location}</strong>
    <div className="fuel-mr-track" role="img" aria-label={`${r.location} ${money(r.cents)}${r.previous !== null ? `, last month ${money(r.previous)}` : ''}`}><i style={{ width: `${r.scale}%` }} />{r.previousScale !== null && <u style={{ left: `${r.previousScale}%` }} />}</div>
    <span className="fuel-mr-money">{money(r.cents)}</span>
    <span className={`fuel-status ${r.change.flagged ? 'draft' : ''}`}>{r.change.direction === 'none' ? '—' : `${arrow[r.change.direction]} ${Math.abs(r.change.pct!)}%`}</span></div>)}</section>
    {report.compare && <p className="fuel-muted">The white tick is {monthName(report.compare.previousMonth)}. Changes of 10% or more are flagged; nothing to fix, just a glance.</p>}</>;
}
export function CheckList({ report }: { report: ReportDetail }) {
  const absences = report.review.missing.filter(m => !m.resolved);
  return <ul className="fuel-mr-ticks">
    <li data-ok={report.review.unallocatedCents === 0 && !report.review.unassigned?.lineCount}>Charges add up to the Fuelman report</li>
    <li data-ok={!report.review.drivers.some(d => !d.driverKey)}>Every driver has a location</li>
    <li data-ok={!absences.length}>Absences are explained</li>
    <li data-ok={report.priorDateLineCount === 0}>{report.priorDateLineCount ? `${report.priorDateLineCount} charges are dated before ${monthName(report.month)}` : `No charges dated outside ${monthName(report.month)}`}</li>
  </ul>;
}
