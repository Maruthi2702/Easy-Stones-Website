import { Fragment } from 'react';
import type { AsOf, MonthState, Total } from '../../../utils/salesGoals';
import { MONTH_NAMES, monthLines, moneyFull, quarterTotals, toDate } from '../../../utils/salesGoals';
import type { GoalPerson } from '../../../api/salesGoals';
import GoalBar from './GoalBar';

/**
 * One person's year, month by month — the same layout as the customer profile's Sales Report
 * tab (month, a bar, sales), with the goal and the result beside it: a pill with the percent and
 * a word, the months grouped by quarter with each quarter's total, "This month" on the row in
 * progress, and a "To date" total at the bottom. A month with no goal reads "No goal", never a miss.
 */
const WORD: Record<MonthState, string> = {
    met: 'Goal met', under: 'Under', onpace: 'On pace', behind: 'Behind pace', upcoming: 'Upcoming', none: 'No goal'
};
const toneOf = (state: MonthState) => (state === 'met' || state === 'onpace' ? 'gl-pill--up' : state === 'under' || state === 'behind' ? 'gl-pill--dn' : 'gl-pill--mute');

const QUARTERS = ['Jan to Mar', 'Apr to Jun', 'Jul to Sep', 'Oct to Dec'];

function TotalPill({ total }: { total: Total }) {
    if (total.pct == null) return <span className="gl-pill gl-pill--mute">No goal</span>;
    const met = total.goalCents != null && total.salesCents >= total.goalCents;
    return <span className={`gl-pill ${met ? 'gl-pill--up' : 'gl-pill--dn'}`}>{total.pct}%</span>;
}

export default function MonthlyGoals({ person, year, asOf }: { person: GoalPerson; year: number; asOf: AsOf }) {
    const lines = monthLines(asOf, year, person.salesCents, person.goalCents);
    const quarters = quarterTotals(lines);
    const upTo = toDate(lines);
    const last = lines.filter((l) => l.state !== 'upcoming').pop();
    return (
        <div className="gl-months-wrap">
            <table className="gl-months">
                <caption className="gl-sr">{person.name}’s sales and goals by month, {year}</caption>
                <thead>
                    <tr>
                        <th scope="col">Month</th>
                        <th scope="col">Vs goal</th>
                        <th scope="col" className="gl-r">Sales</th>
                        <th scope="col" className="gl-r gl-goalcol">Goal</th>
                        <th scope="col" className="gl-r">Result</th>
                    </tr>
                </thead>
                <tbody>
                    {[0, 1, 2, 3].map((q) => {
                        const total = quarters[q];
                        return (
                            <Fragment key={q}>
                                <tr className="gl-q">
                                    <th scope="row">Q{q + 1}<small>{QUARTERS[q]}</small></th>
                                    <td />
                                    <td className="gl-r">{total ? moneyFull(total.salesCents) : ''}</td>
                                    <td className="gl-r gl-goalcol">{total?.goalCents != null ? moneyFull(total.goalCents) : ''}</td>
                                    <td className="gl-r">{total ? <TotalPill total={total} /> : null}</td>
                                </tr>
                                {lines.slice(q * 3, q * 3 + 3).map((l) => (
                                    <tr key={l.month} className={`gl-m${l.current ? ' is-now' : ''}${l.state === 'upcoming' ? ' is-soon' : ''}`}>
                                        <th scope="row">
                                            <span className="gl-mname">{MONTH_NAMES[l.month - 1]}</span>
                                            <span className="gl-mshort" aria-hidden="true">{MONTH_NAMES[l.month - 1].slice(0, 3)}</span>
                                            {l.current && <small className="gl-now">This month</small>}
                                        </th>
                                        <td className="gl-barcell"><GoalBar mode="goal" pct={l.pct} state={l.state} label={`${MONTH_NAMES[l.month - 1]}: ${l.pct == null ? WORD[l.state] : `${l.pct}% of the goal`}`} /></td>
                                        <td className="gl-r gl-strong">{l.state === 'upcoming' ? '—' : moneyFull(l.salesCents ?? 0)}</td>
                                        <td className="gl-r gl-goalcol">{l.goalCents != null ? moneyFull(l.goalCents) : '—'}</td>
                                        <td className="gl-r">
                                            <span className={`gl-pill ${toneOf(l.state)}`}>
                                                {l.pct != null ? <>{l.pct}%<span className="gl-word"> · {WORD[l.state]}</span></> : WORD[l.state]}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </Fragment>
                        );
                    })}
                </tbody>
                <tfoot>
                    <tr>
                        <th scope="row">To date<small>{last ? `Jan to ${MONTH_NAMES[last.month - 1].slice(0, 3)}` : 'Nothing yet'}</small></th>
                        <td />
                        <td className="gl-r">{moneyFull(upTo.salesCents)}</td>
                        <td className="gl-r gl-goalcol">{upTo.goalCents != null ? moneyFull(upTo.goalCents) : '—'}</td>
                        <td className="gl-r"><TotalPill total={upTo} /></td>
                    </tr>
                </tfoot>
            </table>
            <p className="gl-legend">The line on each bar is the goal, and the bar runs on past it when a month beats its goal. Blue: goal met, or on pace this month. Orange: under goal.</p>
        </div>
    );
}
