import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Loader, Target, Upload } from 'lucide-react';
import { useSalesGoals } from '../../../api/salesGoals';
import type { GoalPerson, GoalsAnswer } from '../../../api/salesGoals';
import { annualGoal, focusMonth, monthLine, monthPace, moneyCompact, MONTH_SHORT, sumCents, yearLine } from '../../../utils/salesGoals';
import type { AsOf, MonthLine, YearLine } from '../../../utils/salesGoals';
import GoalBar from './GoalBar';
import MonthlyGoals from './MonthlyGoals';
import SetGoalsModal from './SetGoalsModal';
import RepSalesImportModal from './RepSalesImportModal';
import './GoalsView.css';

/**
 * Dashboard → Sales Visits → Goals (owner's design, 2026-11-25; claude.ai artifact "Sales Dash — Rep
 * Sales & Goals"): the By rep table with sales against goals for the month and the year, a bar and
 * pace mark on each, a "Weekly visits" column held for the weekly visit goal, and an arrow on every
 * row that opens that person's twelve months. What it shows is exactly what the server sent: a rep's
 * own row, a team's with Team goals. Set goals (Users & Roles) adds the button that sets them.
 */
const WORD = { met: 'Goal met', onpace: 'On pace', behind: 'Behind', under: 'Under', none: '', upcoming: '' } as const;

function SalesCell({ sales, goal, pct, state, pace, wordFor }: {
    sales: number; goal: number | null; pct: number | null; state: MonthLine['state'] | YearLine['state']; pace: number; wordFor: string;
}) {
    if (state === 'upcoming') return <div className="gl-cell"><span className="gl-nogoal">Upcoming</span></div>;
    if (goal == null) {
        return <div className="gl-cell"><span className="gl-cell-top"><b>{moneyCompact(sales)}</b></span><span className="gl-nogoal">No goal set</span></div>;
    }
    const good = state === 'met' || state === 'onpace';
    return (
        <div className="gl-cell">
            <span className="gl-cell-top gl-amt"><b>{moneyCompact(sales)}</b> <i>of {moneyCompact(goal)}</i></span>
            <span className="gl-cell-bar">
                <GoalBar pct={pct} state={state} pace={pace} label={`${wordFor}: ${pct}% of the goal`} />
                <b className={good ? 'gl-ok' : 'gl-bad'}>{pct}%</b>
                <em className={good ? 'gl-ok' : 'gl-bad'}>{WORD[state as keyof typeof WORD]}</em>
            </span>
        </div>
    );
}

export default function GoalsView() {
    const [year, setYear] = useState<number | null>(null);
    const { data, loading, error, reload, patchPerson } = useSalesGoals(year);
    const [openId, setOpenId] = useState<string | null>(null);
    const [setting, setSetting] = useState(false);
    const [importing, setImporting] = useState(false);

    const rows = useMemo(() => (data ? buildRows(data) : []), [data]);

    if (!data) {
        return (
            <div className="dfx-empty">
                {error
                    ? <span role="alert">{error} <button type="button" className="dfx-link" onClick={reload}>Try again</button></span>
                    : <span><Loader size={16} className="animate-spin" /> Loading…</span>}
            </div>
        );
    }

    const shownYear = data.year;
    const years = [...data.years].sort((a, b) => a - b);
    const at = years.indexOf(shownYear);
    const focus = focusMonth(data.asOf, shownYear);
    const showTotal = rows.length > 1;
    const total = showTotal ? totalsOf(rows, data.asOf, shownYear, focus) : null;

    return (
        <div className="gl" aria-busy={loading}>
            <div className="gl-bar-top">
                <div className="gl-year" role="group" aria-label="Year">
                    <button type="button" aria-label="Previous year" disabled={at <= 0} onClick={() => setYear(years[at - 1])}><ChevronLeft size={16} /></button>
                    <span>{shownYear}</span>
                    <button type="button" aria-label="Next year" disabled={at < 0 || at >= years.length - 1} onClick={() => setYear(years[at + 1])}><ChevronRight size={16} /></button>
                </div>
                {data.canSet && (
                    <div className="gl-actions">
                        <button type="button" className="dfx-btn gl-set" onClick={() => setImporting(true)}><Upload size={16} aria-hidden="true" /> Import sales</button>
                        <button type="button" className="dfx-btn dfx-btn--gold gl-set" onClick={() => setSetting(true)}><Target size={16} aria-hidden="true" /> Set goals</button>
                    </div>
                )}
            </div>
            {error && <div className="dfx-muted" role="alert">{error} <button type="button" className="dfx-link" onClick={reload}>Try again</button></div>}

            {rows.length === 0 ? (
                <div className="dfx-empty"><span>No one to show.</span></div>
            ) : (
                <div className="gl-wrap">
                    <table className="gl-table">
                        <thead>
                            <tr>
                                <th scope="col">Rep</th>
                                <th scope="col">Sales · {MONTH_SHORT[focus - 1]}</th>
                                <th scope="col">Sales · {shownYear}</th>
                                <th scope="col" className="gl-weekly">Weekly visits</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(({ person, month, yr }) => {
                                const open = openId === person.id;
                                return (
                                    <Fragment key={person.id}>
                                        <tr className={open ? 'is-open' : ''}>
                                            <th scope="row">
                                                <div className="gl-rowhead">
                                                    <button type="button" className="gl-chev" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${person.name}’s goals by month`} onClick={() => setOpenId(open ? null : person.id)}>
                                                        <ChevronDown size={16} className={open ? 'is-up' : ''} aria-hidden="true" />
                                                    </button>
                                                    <span className="gl-who">
                                                        <span className="gl-name">{person.name}{person.you ? ' (you)' : ''}{person.inactive ? ' · inactive' : ''}</span>
                                                        {person.branch && <small>{person.branch}</small>}
                                                    </span>
                                                </div>
                                            </th>
                                            <td><SalesCell sales={month.salesCents ?? 0} goal={month.goalCents} pct={month.pct} state={month.state} pace={monthPace(data.asOf, shownYear, focus)} wordFor={`${MONTH_SHORT[focus - 1]}`} /></td>
                                            <td><SalesCell sales={yr.salesCents} goal={yr.goalCents} pct={yr.pct} state={yr.state} pace={yr.pace} wordFor={String(shownYear)} /></td>
                                            <td className="gl-weekly"><span className="gl-vph">Goal not set</span></td>
                                        </tr>
                                        {open && (
                                            <tr className="gl-open"><td colSpan={4}><MonthlyGoals person={person} year={shownYear} asOf={data.asOf} /></td></tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                        {total && (
                            <tfoot>
                                <tr>
                                    <th scope="row"><div className="gl-rowhead"><span className="gl-who"><span className="gl-name">Total</span>{total.partial && <small>Reps with a goal</small>}</span></div></th>
                                    <td><SalesCell sales={total.month.salesCents ?? 0} goal={total.month.goalCents} pct={total.month.pct} state={total.month.state} pace={monthPace(data.asOf, shownYear, focus)} wordFor="Total" /></td>
                                    <td><SalesCell sales={total.yr.salesCents} goal={total.yr.goalCents} pct={total.yr.pct} state={total.yr.state} pace={total.yr.pace} wordFor="Total" /></td>
                                    <td className="gl-weekly" />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            )}
            <p className="gl-note"><span className="gl-mark" aria-hidden="true" /> Where a rep would be on pace today. Sales are the SPS monthly report, by the Primary Sales Person on each line, tax not included.</p>
            {data.canSet && (data.unmatchedReps?.length ?? 0) > 0 && (
                <p className="gl-note gl-unmatched" role="status">
                    Not counted — these SPS sales persons match no staff member: {data.unmatchedReps!.slice(0, 6).map((u) => `${u.name} (${moneyCompact(u.salesCents)})`).join(', ')}
                    {data.unmatchedReps!.length > 6 ? ` and ${data.unmatchedReps!.length - 6} more` : ''}. Match their Display Name in Users & Roles to the name SPS uses.
                </p>
            )}

            {importing && <RepSalesImportModal onClose={() => setImporting(false)} onDone={reload} />}
            {setting && (
                <SetGoalsModal
                    year={shownYear}
                    people={data.people}
                    onSaved={patchPerson}
                    onClose={() => setSetting(false)}
                />
            )}
        </div>
    );
}

type Row = { person: GoalPerson; month: MonthLine; yr: YearLine };

function buildRows(data: GoalsAnswer): Row[] {
    const focus = focusMonth(data.asOf, data.year);
    return data.people.map((person) => ({
        person,
        month: monthLine(data.asOf, data.year, focus, person.salesCents[focus - 1], person.goalCents[focus - 1]),
        yr: yearLine(data.asOf, data.year, person.salesCents, person.goalCents)
    }));
}

/** The team line counts only people who have a goal (a rep with none would skew the percent). */
function totalsOf(rows: Row[], asOf: AsOf, year: number, focus: number) {
    const withMonth = rows.filter((r) => r.person.goalCents[focus - 1] != null);
    const withYear = rows.filter((r) => annualGoal(r.person.goalCents) != null);
    const monthSales = withMonth.map((r) => r.person.salesCents[focus - 1]);
    const monthGoals = withMonth.map((r) => r.person.goalCents[focus - 1]);
    const month = monthLine(asOf, year, focus, withMonth.length ? sumCents(monthSales) : null, withMonth.length ? sumCents(monthGoals) : null);
    const yearSales = Array.from({ length: 12 }, (_, i) => sumCents(withYear.map((r) => r.person.salesCents[i])));
    const yearGoals = Array.from({ length: 12 }, (_, i) => (withYear.some((r) => r.person.goalCents[i] != null) ? sumCents(withYear.map((r) => r.person.goalCents[i])) : null));
    const yr = yearLine(asOf, year, yearSales, yearGoals);
    return { month, yr, partial: withYear.length < rows.length || withMonth.length < rows.length };
}
