import { useCallback, useMemo, useState } from 'react';
import type { ExpenseLine, FuelMetadata, MissingIdentity, ReportDetail, ReviewDriver } from '../../../fuelman/types';
import { FUEL_MAN as P } from '../../../fuelman/permissions';
import { FormSearchPicker } from '../../../components/shared/form/FormControls';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import { fuelApi } from '../api';
import { driverChoices, suggestedLocation, userDrivers } from '../driverChoices';
import { money, monthName } from '../format';
import { groupCharges, suggestionsFor } from '../monthReview';
import type { CardSuggestion } from '../monthReview';
import { currentStep, reviewSteps } from '../progressSteps';
import type { StepKey } from '../progressSteps';
import type { Decision } from '../forms/DecisionForm';
import { useFuelQuery } from '../useFuelQuery';
import { AbsenceItem, ChargeItem, CheckList, LocationBars } from './reviewItems';
import { useReviewActions } from '../reviewActions';
// A first month, one step at a time (design: Fuel Man redesign canvas, boards 2 to 5 and the phone screens).
// Many cards need matching once; after this the monthly page only shows the exceptions.
const TITLES: Record<StepKey, [string, string]> = {
  match: ['Who is each card?', 'The report lists Fuelman employee numbers. Confirm the driver and the location their fuel is charged to. This is remembered for every later month.'],
  missing: ["Who didn't fuel this month?", "These drivers were matched in an earlier report but have no charges this month. Tell us why, so a missing card is never overlooked. This does not change anyone's website access."],
  unknown: ['What are these charges?', "Most charges are sorted automatically. These aren't fuel, DEF or a known supply. Similar ones are grouped, so one answer covers the group."],
  approve: ['Check the totals, then approve', "Approving adds these amounts to each location's expenses. No payment is created, and you can reverse it later with a note."],
};
interface Pick { driverKey: string; location: string }
export default function SetupReview({ report, metadata, reload, onSaved, onMissing, onClassify, onDecision, onDetails }: {
  report: ReportDetail; metadata: FuelMetadata; reload: number; onSaved: () => void;
  onMissing: (m: MissingIdentity) => void; onClassify: (lines: ExpenseLine[]) => void; onDecision: (a: Decision) => void; onDetails: () => void;
}) {
  const steps = reviewSteps(report), [chosen, setChosen] = useState<StepKey | ''>(''), step = chosen || currentStep(steps) || 'approve', index = steps.findIndex(s => s.key === step);
  const actions = useReviewActions(report, onSaved), pager = usePagination();
  const [picks, setPicks] = useState<Record<string, Pick>>({}), [manual, setManual] = useState<Set<string>>(new Set());
  const users = userDrivers(metadata), options = useMemo(() => driverChoices(users), [users]);
  const cards = suggestionsFor(report, metadata), absences = report.review.missing.filter(m => !m.resolved);
  const ready = cards.filter(c => picks[c.driver.externalId]?.driverKey && picks[c.driver.externalId]?.location);
  const offered = cards.filter(c => c.user && c.location && !manual.has(c.driver.externalId) && !ready.includes(c));
  const read = useCallback((signal: AbortSignal) => fuelApi.lines(report.id, { externalId: '', unknownOnly: true, search: '', category: '', priorOnly: false }, 1, 100, signal), [report.id]);
  const unknown = useFuelQuery(JSON.stringify([report.id, report.version, reload]), read), groups = groupCharges(unknown.data?.items || []);
  const canPublish = metadata.permissions.includes(P.APPROVE) && (!report.currentPublishedReportId || metadata.permissions.includes(P.REVERSE));
  const start = (pager.currentPage - 1) * pager.rowsPerPage;
  const setPick = (id: string, patch: Partial<Pick>) => setPicks(old => ({ ...old, [id]: { ...(old[id] ?? { driverKey: '', location: '' }), ...patch } }));
  const chooseDriver = (c: CardSuggestion, key: string) => setPick(c.driver.externalId, { driverKey: key, location: picks[c.driver.externalId]?.location || suggestedLocation(users.find(u => u.key === key), metadata.locations) });
  const rowsToSave = [...offered.map(c => ({ c, driverKey: c.user!.key, location: c.location })), ...ready.map(c => ({ c, ...picks[c.driver.externalId]! }))].slice(0, 100);
  const saveRows = () => actions.save('match', 'assignments/batch', { note: '', assignments: rowsToSave.map(r => ({ externalId: r.c.driver.externalId, driverKey: r.driverKey, from: r.c.driver.suggestedFrom, allocations: [{ location: r.location, percent: '100' }] })) });
  const go = (key: StepKey) => { setChosen(key); pager.resetPage(); };
  const next = steps[index + 1], back = steps[index - 1];
  return <div className="fuel-sr">
    <ol className="fuel-sr-steps" aria-label="Steps to approve">
      {steps.map((s, i) => <li key={s.key} className={`${s.done ? 'done' : ''} ${s.key === step ? 'now' : ''}`} aria-current={s.key === step ? 'step' : undefined}>
        <button type="button" onClick={() => go(s.key)}><b>{s.done ? '✓' : i + 1}</b><span><strong>{({ match: 'Match drivers', missing: 'Explain absences', unknown: 'Unknown charges', approve: 'Approve' } as const)[s.key]}</strong><small>{s.key === 'unknown' && !s.done ? `${unknown.data?.total ?? ''} ${unknown.data ? 'charges' : ''}`.trim() || s.status : s.status}</small></span></button></li>)}
    </ol>
    <div className="fuel-sr-phone" aria-hidden="true"><div><strong>{index + 1} {({ match: 'Match drivers', missing: 'Explain absences', unknown: 'Unknown charges', approve: 'Approve' } as const)[step]}</strong><span>Step {index + 1} of 4</span></div>
      <div className="fuel-mr-track"><i style={{ width: `${(index + 1) * 25}%` }} /></div></div>

    <div className="fuel-sr-main">
      <div className="fuel-section-heading"><div><h2>{TITLES[step][0]}</h2><p className="fuel-muted">{TITLES[step][1]}</p></div><button onClick={onDetails}>Details</button></div>
      {actions.error && <p className="fuel-error" role="alert">{actions.error}</p>}

      {step === 'match' && <>
        <div className="fuel-sr-rows">{cards.slice(start, start + pager.rowsPerPage).map(c => {
          const id = c.driver.externalId, pick = picks[id], suggest = c.user && c.location && !manual.has(id) && !ready.includes(c);
          return <article className="fuel-sr-row" key={id}>
            <div className="fuel-sr-who"><strong>{c.driver.name}</strong><small>Employee #{id} · {money(c.driver.totalCents)} this month</small></div>
            {suggest ? <><div className="fuel-sr-suggest"><span className="fuel-status draft">Suggested</span> <strong>{c.user!.name}</strong> → <strong>{c.location}</strong>{c.since && <small> · same as {monthName(c.since.slice(0, 7))}</small>}</div>
              <div className="fuel-mr-acts"><button className="fuel-primary" disabled={!!actions.busy} onClick={() => void actions.accept(c)}>Accept</button><button disabled={!!actions.busy} onClick={() => setManual(old => new Set(old).add(id))}>Change</button></div></>
              : <><div className="fuel-sr-fields fm-tokens">
                <div><label htmlFor={`sr-d-${id}`}>Driver</label><FormSearchPicker id={`sr-d-${id}`} value={pick?.driverKey || ''} options={options} placeholder="Choose a driver" onChange={v => chooseDriver(c, v)} /></div>
                <div><label htmlFor={`sr-l-${id}`}>Charge to</label><LocationPicker id={`sr-l-${id}`} value={pick?.location || ''} options={metadata.locations} noneLabel="Choose a location" onChange={v => setPick(id, { location: v })} /></div></div>
                <div className="fuel-mr-acts"><span className={`fuel-status${ready.includes(c) ? ' posted' : ''}`}>{ready.includes(c) ? 'Ready to save' : pick?.driverKey || c.user ? 'Pick a location' : 'Choose a driver'}</span></div></>}
          </article>;
        })}</div>
        {!cards.length && <p className="fuel-empty">Every card has a driver and a location.</p>}
        <Pagination {...pager} totalPages={pageCount(cards.length, pager.rowsPerPage)} totalCount={cards.length} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
      </>}
      {step === 'missing' && <section className="fuel-mr-todo">{absences.map((m, i) => <AbsenceItem key={m.externalId} n={i + 1} m={m} actions={actions} onMore={onMissing} />)}
        {!absences.length && <p className="fuel-muted">Nobody is missing this month.</p>}</section>}
      {step === 'unknown' && <section className="fuel-mr-todo">{unknown.loading && <p role="status" className="fuel-muted">Checking for unknown charges…</p>}
        {groups.map((g, i) => <ChargeItem key={g.key} n={i + 1} g={g} actions={actions} onMore={onClassify} />)}
        {!unknown.loading && !groups.length && <p className="fuel-muted">No unknown charges.</p>}</section>}
      {step === 'approve' && <>
        <p className="fuel-mr-total fuel-sr-total">{money(report.review.allocatedCents)}</p>
        <h3 className="fuel-mr-label">Each location will carry</h3><LocationBars report={report} />
        <h3 className="fuel-mr-label">Checks</h3><CheckList report={report} />
      </>}

      <div className="fuel-mr-dock">
        <p className="fuel-muted">{step === 'match' ? `${offered.length + ready.length} ready · ${cards.length - offered.length - ready.length} still need you. Only matched drivers are saved.`
          : step === 'approve' ? `Approving adds these to each location's ${monthName(report.month)} expenses.` : 'You can change any answer until you approve.'}</p>
        <div className="fuel-actions">
          {back && <button onClick={() => go(back.key)}>‹ Back</button>}
          {step === 'match' && rowsToSave.length > 0 && <button className="fuel-primary" disabled={!!actions.busy} onClick={() => void saveRows()}>{actions.busy === 'match' ? 'Saving…' : offered.length && !ready.length ? `Accept ${offered.length} suggestion${offered.length === 1 ? '' : 's'}` : `Save ${rowsToSave.length} match${rowsToSave.length === 1 ? '' : 'es'}`}</button>}
          {step === 'approve' ? canPublish && <button className="fuel-primary" disabled={!report.review.ready || report.periodClosed} onClick={() => onDecision('publish')}>{report.review.ready ? `Approve ${monthName(report.month)}` : 'Some steps are not done'}</button>
            : next && <button className={step !== 'match' || !rowsToSave.length ? 'fuel-primary' : ''} onClick={() => go(next.key)}>Next: {({ missing: 'explain absences', unknown: 'unknown charges', approve: 'approve' } as Record<string, string>)[next.key]}</button>}
        </div>
      </div>
    </div>
  </div>;
}
