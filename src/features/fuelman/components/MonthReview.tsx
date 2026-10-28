import { useCallback, useState } from 'react';
import type { ExpenseLine, FuelMetadata, MissingIdentity, MissingReason, ReportDetail, ReviewDriver } from '../../../fuelman/types';
import { FUEL_MAN as P } from '../../../fuelman/permissions';
import { fuelApi } from '../api';
import { categoryLabels, money, monthName } from '../format';
import { changeFrom, groupCharges, isSetupMonth, locationRows, suggestionsFor } from '../monthReview';
import type { Decision } from '../forms/DecisionForm';
import { useFuelQuery } from '../useFuelQuery';
// The typical month on one page: the total, what needs a person, what was checked, and how it
// compares with last month. Everything else lives under Details.
const QUICK_ABSENCE: { reason: MissingReason; label: string; note: string }[] = [
  { reason: 'no_activity', label: "Didn't use it", note: 'No card activity this month (monthly review)' },
  { reason: 'leave', label: 'On leave', note: 'On leave this month (monthly review)' },
  { reason: 'retired', label: 'Left', note: 'Left the company, card retired (monthly review)' },
];
const QUICK_CATEGORIES = ['supplies', 'fuel', 'def'] as const;
const arrow = { up: '▲', down: '▼', same: '•', none: '' } as const;
export default function MonthReview({ report, metadata, reload, onSaved, onSetup, onAssign, onMissing, onClassify, onDecision, onDetails }: {
  report: ReportDetail; metadata: FuelMetadata; reload: number; onSaved: () => void; onSetup: () => void; onAssign: (d: ReviewDriver) => void;
  onMissing: (m: MissingIdentity) => void; onClassify: (lines: ExpenseLine[]) => void; onDecision: (a: Decision) => void; onDetails: () => void;
}) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const canPublish = metadata.permissions.includes(P.APPROVE) && (!report.currentPublishedReportId || metadata.permissions.includes(P.REVERSE));
  const setupMonth = isSetupMonth(report), cards = suggestionsFor(report, metadata).filter(() => !setupMonth);
  const absences = report.review.missing.filter(m => !m.resolved);
  const read = useCallback((signal: AbortSignal) => fuelApi.lines(report.id, { externalId: '', unknownOnly: true, search: '', category: '', priorOnly: false }, 1, 100, signal), [report.id]);
  const unknown = useFuelQuery(JSON.stringify([report.id, report.version, reload]), read);
  const groups = groupCharges(unknown.data?.items || []), unknownCount = unknown.data?.total ?? 0;
  const items = (setupMonth ? 1 : cards.length) + absences.length + (unknownCount ? Math.max(groups.length, 1) : 0);
  const change = changeFrom(report.totalCents, report.compare?.previousTotalCents), rows = locationRows(report);
  const matched = report.compare?.carriedOverCount ?? 0;
  const save = async (id: string, action: string, body: Record<string, unknown>) => {
    setBusy(id); setError('');
    try { await fuelApi.command(report.id, action, { version: report.version, token: report.review.token, ...body }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const accept = (c: ReturnType<typeof suggestionsFor>[number]) => save(`card:${c.driver.externalId}`, 'assignments/batch', { note: '',
    assignments: [{ externalId: c.driver.externalId, driverKey: c.user!.key, from: c.driver.suggestedFrom, allocations: [{ location: c.location, percent: '100' }] }] });
  const absent = (m: MissingIdentity, q: typeof QUICK_ABSENCE[number]) => save(`away:${m.externalId}`, 'missing',
    { externalId: m.externalId, reason: q.reason, note: q.note, ...(q.reason === 'retired' ? { effectiveDate: report.start } : {}) });
  const sort = (g: { lines: ExpenseLine[] }, category: string) => save(`charge:${g.lines[0]!.index}`, 'classifications',
    { rows: g.lines.map(l => ({ index: l.index, category, note: 'Sorted in the monthly review' })) });
  const anyLeft = items > 0 || !report.review.ready;
  return <div className="fuel-mr">
    <section className="fuel-mr-hero">
      <p className="fuel-mr-total">{money(report.totalCents)}</p>
      <p className="fuel-mr-lede"><strong>{matched && !setupMonth ? 'Most of this was matched from last month.' : 'Here is this month.'}</strong>{' '}
        <span className="fuel-muted">{matched ? `${matched} of ${report.employeeCount} drivers were matched automatically` : `${report.employeeCount} drivers`}
        {report.review.allocatedCents === report.totalCents ? ', and the charges add up to the Fuelman report.' : '.'}</span></p>
      <p className="fuel-mr-chips">{change.direction !== 'none' && <span className="fuel-status posted">{arrow[change.direction]} {Math.abs(change.pct!)}% vs {monthName(report.compare!.previousMonth)}</span>}
        <span className="fuel-muted">{report.lineCount} charges</span></p>
    </section>

    <h3 className="fuel-mr-label">{items ? `Needs a look · ${items}` : 'Nothing needs a look'}</h3>
    {error && <p className="fuel-error" role="alert">{error}</p>}
    <section className="fuel-mr-todo">
      {setupMonth && <div className="fuel-mr-item"><span className="fuel-mr-n" aria-hidden="true">!</span><div><h4>{report.review.drivers.filter(d => !d.driverKey).length} cards need a driver and a location</h4><p>This looks like a first month. Match them together; it is remembered for every later month.</p></div>
        <div className="fuel-mr-acts"><button className="fuel-primary" onClick={onSetup}>Match drivers</button></div></div>}
      {cards.map((c, i) => <div className="fuel-mr-item" key={c.driver.externalId}><span className="fuel-mr-n" aria-hidden="true">{i + 1}</span>
        <div><h4>New card: {c.driver.name} <span className="fuel-muted">· #{c.driver.externalId} · {money(c.driver.totalCents)}</span></h4>
          <p>{c.user ? `Looks like ${c.user.name}${c.location ? `, home location ${c.location}` : ''}.` : 'Not seen before, and no driver in Users & Roles clearly matches.'}</p></div>
        <div className="fuel-mr-acts">{c.user && c.location && <button className="fuel-primary" disabled={!!busy} onClick={() => void accept(c)}>{busy === `card:${c.driver.externalId}` ? 'Saving…' : `Yes, ${c.user.name} → ${c.location}`}</button>}
          <button disabled={!!busy} onClick={() => onAssign(c.driver)}>{c.user && c.location ? 'Someone else' : 'Choose driver'}</button></div></div>)}
      {absences.map((m, i) => <div className="fuel-mr-item" key={m.externalId}><span className="fuel-mr-n" aria-hidden="true">{cards.length + (setupMonth ? 1 : 0) + i + 1}</span>
        <div><h4>{m.driverName} had no charges</h4><p>Expected because they fueled before. What happened?</p></div>
        <div className="fuel-mr-acts">{QUICK_ABSENCE.map(q => <button key={q.reason} disabled={!!busy} onClick={() => void absent(m, q)}>{q.label}</button>)}<button disabled={!!busy} onClick={() => onMissing(m)}>More…</button></div></div>)}
      {unknown.loading && <p role="status" className="fuel-muted">Checking for unknown charges…</p>}
      {groups.map((g, i) => <div className="fuel-mr-item" key={g.key}><span className="fuel-mr-n" aria-hidden="true">{cards.length + absences.length + (setupMonth ? 1 : 0) + i + 1}</span>
        <div><h4>“{g.label}” <span className="fuel-muted">· {g.lines.length} {g.lines.length === 1 ? 'charge' : 'charges'} · {money(g.totalCents)}</span></h4><p>Not fuel, DEF or a known supply{g.drivers > 1 ? `, on ${g.drivers} drivers' cards` : ''}. Where should {g.lines.length === 1 ? 'it' : 'they'} go?</p></div>
        <div className="fuel-mr-acts">{QUICK_CATEGORIES.map(c => <button key={c} disabled={!!busy} onClick={() => void sort(g, c)}>{categoryLabels[c]}</button>)}<button disabled={!!busy} onClick={() => onClassify(g.lines)}>More…</button></div></div>)}
      {unknownCount > 100 && <p className="fuel-muted">Showing the first 100 of {unknownCount} unknown charges. Sort these, then check again.</p>}
      {!items && !unknown.loading && <p className="fuel-muted">Every card, absence and charge is settled.</p>}
    </section>

    <h3 className="fuel-mr-label">Checked for you</h3>
    <ul className="fuel-mr-ticks">
      <li data-ok={report.review.unallocatedCents === 0 && !report.review.unassigned?.lineCount}>Charges add up to the Fuelman report</li>
      <li data-ok={!report.review.drivers.some(d => !d.driverKey)}>Every driver has a location</li>
      <li data-ok={!absences.length}>Absences are explained</li>
      <li data-ok={report.priorDateLineCount === 0}>{report.priorDateLineCount ? `${report.priorDateLineCount} charges are dated before ${monthName(report.month)}` : `No charges dated outside ${monthName(report.month)}`}</li>
    </ul>

    {!!rows.length && <><h3 className="fuel-mr-label">By location{report.compare ? `, compared with ${monthName(report.compare.previousMonth)}` : ''}</h3>
      <section className="fuel-mr-cmp">{rows.map(r => <div className="fuel-mr-loc" key={r.location}><strong>{r.location}</strong>
        <div className="fuel-mr-track" role="img" aria-label={`${r.location} ${money(r.cents)}${r.previous !== null ? `, last month ${money(r.previous)}` : ''}`}><i style={{ width: `${r.scale}%` }} />{r.previousScale !== null && <u style={{ left: `${r.previousScale}%` }} />}</div>
        <span className="fuel-mr-money">{money(r.cents)}</span>
        <span className={`fuel-status ${r.change.flagged ? 'draft' : ''}`}>{r.change.direction === 'none' ? '—' : `${arrow[r.change.direction]} ${Math.abs(r.change.pct!)}%`}</span></div>)}</section>
      {report.compare && <p className="fuel-muted">The white tick is {monthName(report.compare.previousMonth)}. Changes of 10% or more are flagged; nothing to fix, just a glance.</p>}</>}

    <div className="fuel-mr-dock">
      <p className="fuel-muted">Approving adds these to each location's {monthName(report.month)} expenses. No payment is created, and you can reverse it later with a note.</p>
      <div className="fuel-actions"><button onClick={onDetails}>Details</button>
        {canPublish && <button className="fuel-primary" disabled={anyLeft || report.periodClosed} onClick={() => onDecision('publish')}>{anyLeft ? `${items || 'Some'} to check` : `Approve ${monthName(report.month)}`}</button>}</div>
    </div>
  </div>;
}
