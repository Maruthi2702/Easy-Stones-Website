import { Fragment } from 'react';
import { Calendar } from 'lucide-react';
import { StopActions, isPastStop, nowLineIndex, useNow } from '../../salesPlanner/stopActions';
import { todayStops, panelFollowUps } from '../dashboardFocus';
import type { PanelFollowUp } from '../dashboardFocus';
import type { Loose } from '../../../types/records';
import './DashboardFocus.css';

/**
 * The Focus board's right-hand panels (design "Option A"): Today's calendar
 * stops and the follow-ups worth a glance. Today's stops are read from what the
 * page already loaded; the follow-ups arrive already picked by the server
 * (GET /api/dashboard/followups/panel). Nothing is fetched here. Under 640px they sit below the
 * visit list.
 */
export type DashboardAsideProps = {
    schedules: Loose[];
    customerName: (schedule: Loose) => string;
    /** GET /api/dashboard/followups/panel's rows. */
    followUps: Loose[];
    /** More than the viewer is in view (the People filter): each follow-up says whose it is. */
    showWhoLogged?: boolean;
    followUpCount: number;
    onOpenPlanner: () => void;
    onOpenFollowUps: () => void;
    onOpenCustomer?: (row: PanelFollowUp) => void;
    /** Open a customer's profile by id (a Today stop's ⋯ → Open profile). */
    onOpenCustomerById?: (customerId: string) => void;
};

/** The NOW marker on the Today timeline. */
const NowRow = ({ now }: { now: Date }) => (
    <li className="dfx-now" role="separator" aria-label="Now">
        <span className="dfx-now-time">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '')}</span>
        <span className="dfx-now-dot" aria-hidden="true" />
        <i aria-hidden="true" />
        <b>NOW</b>
    </li>
);

const DashboardAside = ({ schedules, customerName, followUps, showWhoLogged = false, followUpCount, onOpenPlanner, onOpenFollowUps, onOpenCustomer, onOpenCustomerById }: DashboardAsideProps) => {
    const now = useNow();
    const stops = todayStops(schedules, customerName, now);
    // The red NOW line: before the first stop that starts after now.
    const nowAt = stops.length > 0 ? nowLineIndex(stops.map(s => ({ startTime: (schedules.find(sch => sch._id === s.id) || {}).startTime })), now) : -1;
    const rows = panelFollowUps(followUps, now);
    return (
        <aside className="dfx-aside" aria-label="Needs attention">
            <section className="dfx-panel" aria-label="Today">
                <div className="dfx-panel-head">
                    <h2>Today</h2>
                    <span>{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{stops.length ? ` · ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}` : ''}</span>
                </div>
                {stops.length > 0 ? (
                    <>
                        <ol className="dfx-stops dfx-stops--timeline" aria-label="Today's calendar">
                            {stops.map((s, i) => {
                                const raw = schedules.find(sch => sch._id === s.id) || {};
                                const [clock, period] = s.time.split(' ');
                                // The stop as the planner's menu reads it (its customer by name, not just an id).
                                const item = { ...raw, _id: s.id, startTime: raw.startTime, activityType: s.type, notes: s.detail, customerId: { _id: s.customerId, company: s.company } };
                                const past = isPastStop(item, now);
                                return (
                                    <Fragment key={s.id}>
                                        {i === nowAt && <NowRow now={now} />}
                                        <li className={past ? 'is-past' : undefined}>
                                            <span className="dfx-stop-time"><b>{clock}</b>{period && <small>{period}</small>}</span>
                                            <span className="dfx-stop-dot" style={{ background: past ? undefined : s.color }} aria-hidden="true" />
                                            <span className="dfx-stop-text">
                                                <span>{s.company}</span>
                                                <span>{showWhoLogged && s.owner ? `${s.owner} · ` : ''}{s.type}{s.detail ? ` · ${s.detail}` : ''}</span>
                                            </span>
                                            <StopActions
                                                item={item}
                                                onOpenCustomer={onOpenCustomerById && s.customerId ? () => onOpenCustomerById(String(s.customerId)) : undefined}
                                                onOpenCalendar={onOpenPlanner}
                                            />
                                        </li>
                                    </Fragment>
                                );
                            })}
                            {nowAt === stops.length && <NowRow now={now} />}
                        </ol>
                        <button type="button" className="dfx-link" onClick={onOpenPlanner}>Open Calendar →</button>
                    </>
                ) : (
                    <div className="dfx-nothing">
                        <span aria-hidden="true"><Calendar size={18} /></span>
                        <strong>Nothing on the calendar today</strong>
                        <button type="button" className="dfx-btn dfx-btn--soft" onClick={onOpenPlanner}>Open Calendar</button>
                    </div>
                )}
            </section>

            <section className="dfx-panel" aria-label="Follow-ups">
                <div className="dfx-panel-head">
                    <h2>Follow-ups</h2>
                    <span className="dfx-count">{followUpCount}</span>
                </div>
                {rows.length === 0 && <p className="dfx-muted">No follow-ups in this period.</p>}
                {rows.map(f => (
                    <button type="button" key={f.id} className="dfx-fu" onClick={() => onOpenCustomer?.(f)}>
                        <span className={`dfx-dot dfx-dot--${f.tone}`} aria-hidden="true" />
                        <span className="dfx-fu-text">
                            <span>{f.company}</span>
                            <span>{showWhoLogged && f.by ? (f.note ? `${f.by} · ${f.note}` : f.by) : f.note}</span>
                        </span>
                        <span className={`dfx-due dfx-due--${f.tone}`}>{f.text}</span>
                    </button>
                ))}
                <button type="button" className="dfx-link" onClick={onOpenFollowUps}>See all {followUpCount} follow-ups →</button>
            </section>
        </aside>
    );
};

export default DashboardAside;
