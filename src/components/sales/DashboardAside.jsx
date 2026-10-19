import React from 'react';
import { Calendar } from 'lucide-react';
import { todayStops, topFollowUps } from './dashboardFocus';
import './DashboardFocus.css';

/**
 * The Focus board's right-hand panels (design "Option A"): Today's calendar
 * stops and the most pressing follow-ups. Both are read from what the page
 * already loaded — nothing is fetched here. Under 640px they sit below the
 * visit list.
 */
const DashboardAside = ({ schedules, customerName, followUps, followUpCount, onOpenPlanner, onOpenFollowUps, onOpenCustomer }) => {
    const now = new Date();
    const stops = todayStops(schedules, customerName, now);
    const rows = topFollowUps(followUps, 6, now);
    return (
        <aside className="dfx-aside" aria-label="Needs attention">
            <section className="dfx-panel" aria-label="Today">
                <div className="dfx-panel-head">
                    <h2>Today</h2>
                    <span>{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{stops.length ? ` · ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}` : ''}</span>
                </div>
                {stops.length > 0 ? (
                    <>
                        <ol className="dfx-stops" aria-label="Today's calendar">
                            {stops.map(s => (
                                <li key={s.id}>
                                    <span className="dfx-stop-time">{s.time}</span>
                                    <span className="dfx-stop-bar" style={{ background: s.color }} aria-hidden="true" />
                                    <span className="dfx-stop-text">
                                        <span>{s.company}</span>
                                        <span>{s.type}{s.detail ? ` · ${s.detail}` : ''}</span>
                                    </span>
                                </li>
                            ))}
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
                            <span>{f.note}</span>
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
