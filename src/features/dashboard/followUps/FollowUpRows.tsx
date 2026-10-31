import { AlarmClock, Check, Eye, MessageSquareText, Pencil, Phone, RotateCcw, User } from 'lucide-react';
import RowMenu from '../../../components/shared/RowMenu';
import type { RowMenuItem } from '../../../components/shared/RowMenu';
import { visitTypeLabel } from '../../../utils/visitForm';
import {
    doneDayOf, dueDayOf, followUpNote, followUpState, isFollowUpDone, shortDay, snoozeText, whenText
} from '../../../utils/followUpList';
import type { FollowUpGroup, FollowUpRow, FollowUpStatus } from '../../../utils/followUpList';

export type FollowUpRowActions = {
    today: string;
    status: FollowUpStatus;
    /** A Rep column / line once more than the viewer is in view. */
    showWhoLogged: boolean;
    /** Whoever may edit the visit may tick, reopen or snooze its follow-up. */
    canModify: (row: FollowUpRow) => boolean;
    onTick: (row: FollowUpRow) => void;
    onReopen: (row: FollowUpRow) => void;
    onSnooze: (row: FollowUpRow) => void;
    onOutcome: (row: FollowUpRow) => void;
    onViewVisit: (row: FollowUpRow) => void;
    onEditVisit: (row: FollowUpRow) => void;
    onOpenCustomer: (customerId: string) => void;
};

type Props = FollowUpRowActions & { groups: (FollowUpGroup & { total: number })[] };

const companyOf = (r: FollowUpRow) => r.company || r.customerName || 'Unknown customer';
const telOf = (phone: unknown) => (typeof phone === 'string' ? phone.replace(/[^\d+]/g, '') : '');

const menuItems = (a: FollowUpRowActions, r: FollowUpRow, { withSnooze = false } = {}): RowMenuItem[] => {
    const may = a.canModify(r);
    const done = isFollowUpDone(r);
    const items: RowMenuItem[] = [];
    if (withSnooze && may && !done) items.push({ key: 'snooze', label: 'Snooze…', icon: AlarmClock, onClick: () => a.onSnooze(r) });
    if (may && done) {
        items.push({ key: 'outcome', label: r.followUpOutcome ? 'Edit what happened' : 'Add what happened', icon: MessageSquareText, onClick: () => a.onOutcome(r) });
        items.push({ key: 'reopen', label: 'Reopen', icon: RotateCcw, onClick: () => a.onReopen(r) });
    }
    items.push({ key: 'view', label: 'View visit', icon: Eye, onClick: () => a.onViewVisit(r), divider: items.length > 0 });
    if (may) items.push({ key: 'edit', label: 'Edit visit', icon: Pencil, onClick: () => a.onEditVisit(r) });
    if (r.customerId) items.push({ key: 'customer', label: 'Open customer', icon: User, onClick: () => a.onOpenCustomer(String(r.customerId)) });
    return items;
};

function TickButton({ a, r }: { a: FollowUpRowActions; r: FollowUpRow }) {
    const done = isFollowUpDone(r);
    if (!a.canModify(r)) return done ? <span className="fu-tick is-done is-static" aria-label="Done"><Check size={13} strokeWidth={3} /></span> : null;
    return done ? (
        <button type="button" className="fu-tick-btn" aria-label={`Reopen the follow-up for ${companyOf(r)}`} title="Done — click to reopen" onClick={() => a.onReopen(r)}>
            <span className="fu-tick is-done"><Check size={13} strokeWidth={3} /></span>
        </button>
    ) : (
        <button type="button" className="fu-tick-btn" aria-label={`Mark the follow-up for ${companyOf(r)} done`} title="Mark done" onClick={() => a.onTick(r)}>
            <span className="fu-tick" />
        </button>
    );
}

function When({ r, today }: { r: FollowUpRow; today: string }) {
    const state = followUpState(r, today);
    const when = whenText(r, today);
    const lateDone = state === 'done' && when !== 'On time';
    const snoozed = snoozeText(r, today);
    return (
        <>
            <span className="fu-day">{shortDay(dueDayOf(r), today)}</span>
            {when && <span className={`fu-when${state === 'overdue' || lateDone ? ' is-late' : ''}${state === 'done' && !lateDone ? ' is-ok' : ''}`}>{when}</span>}
            {snoozed && <span className="fu-snoozed">{snoozed}</span>}
        </>
    );
}

function StatusPill({ r, today }: { r: FollowUpRow; today: string }) {
    const state = followUpState(r, today);
    if (state === 'done') {
        return (
            <>
                <span className="fu-pill is-done"><Check size={11} strokeWidth={3} aria-hidden="true" />Done</span>
                <span className="fu-sub">{shortDay(doneDayOf(r), today)}{r.followUpDoneByName ? ` · ${r.followUpDoneByName}` : ''}</span>
            </>
        );
    }
    return <span className={`fu-pill${state === 'overdue' ? ' is-late' : ''}`}>{state === 'overdue' ? 'Overdue' : 'Pending'}</span>;
}

/** Desktop and tablet: a table with a heading row per group. */
export function FollowUpTable({ groups, ...a }: Props) {
    const showStatus = a.status !== 'pending';
    const cols = 6 + (showStatus ? 1 : 0) + (a.showWhoLogged ? 1 : 0);
    return (
        <div className="dashboard-table-wrapper">
            <table className="dashboard-table fu-table">
                <thead>
                    <tr>
                        <th className="fu-col-tick"><span className="fu-sr">Done</span></th>
                        {showStatus && <th>Status</th>}
                        <th>Due</th>
                        <th>Customer</th>
                        <th>Follow-up</th>
                        <th className="fu-col-from">From</th>
                        {a.showWhoLogged && <th className="fu-col-rep">Rep</th>}
                        <th className="fu-col-actions"><span className="fu-sr">Actions</span></th>
                    </tr>
                </thead>
                {groups.map((g) => (
                    <tbody key={g.key}>
                        <tr className="fu-group">
                            <th colSpan={cols} scope="colgroup">
                                <span className={g.late ? 'is-late' : undefined}>{g.label}</span>
                                <span className="fu-group-count">
                                    {a.status === 'all' ? `${g.total} · ${g.done} done · ${g.pending} pending` : g.total}
                                </span>
                            </th>
                        </tr>
                        {g.rows.map((r) => {
                            const tel = telOf(r.phone);
                            const may = a.canModify(r);
                            return (
                                <tr key={String(r._id)} className={`fu-row${r._saving ? ' is-saving' : ''}`}>
                                    <td className="fu-col-tick"><TickButton a={a} r={r} /></td>
                                    {showStatus && <td className="fu-status"><StatusPill r={r} today={a.today} /></td>}
                                    <td className="fu-due"><When r={r} today={a.today} /></td>
                                    <td className="fu-cust">
                                        {r.customerId
                                            ? <button type="button" className="fu-link" onClick={() => a.onOpenCustomer(String(r.customerId))}>{companyOf(r)}</button>
                                            : <strong>{companyOf(r)}</strong>}
                                        {r.city && <span className="fu-sub">{r.city}</span>}
                                    </td>
                                    <td className="fu-note">
                                        <span>{followUpNote(r) || '—'}</span>
                                        {r.followUpOutcome && <span className="fu-outcome"><strong>What happened:</strong> {r.followUpOutcome}</span>}
                                    </td>
                                    <td className="fu-col-from">
                                        <button type="button" className="fu-from" onClick={() => a.onViewVisit(r)}>{visitTypeLabel(r.purpose) || 'Visit'}</button>
                                        <span className="fu-sub">{shortDay(String(r.date || '').slice(0, 10), a.today)}</span>
                                    </td>
                                    {a.showWhoLogged && <td className="fu-col-rep fu-rep">{r.createdByName || '—'}</td>}
                                    <td className="fu-col-actions">
                                        <div className="fu-actions">
                                            {tel && <a className="fu-icon-btn" href={`tel:${tel}`} aria-label={`Call ${companyOf(r)}`} title={`Call ${r.phone}`}><Phone size={16} /></a>}
                                            {may && !isFollowUpDone(r) && (
                                                <button type="button" className="fu-icon-btn" aria-label={`Snooze the follow-up for ${companyOf(r)}`} title="Snooze" onClick={() => a.onSnooze(r)}>
                                                    <AlarmClock size={16} />
                                                </button>
                                            )}
                                            <RowMenu label={`More for ${companyOf(r)}`} items={menuItems(a, r)} />
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                ))}
            </table>
        </div>
    );
}

/** Phones: cards under the same headings — tick, the follow-up, Call and ⋯. */
export function FollowUpCards({ groups, ...a }: Props) {
    return (
        <div className="fu-cards">
            {groups.map((g) => (
                <section key={g.key} className="fu-card-group" aria-label={g.label}>
                    <h3 className="fu-card-head">
                        <span className={g.late ? 'is-late' : undefined}>{g.label}</span>
                        <span>{a.status === 'all' ? `${g.done} done · ${g.pending} pending` : g.total}</span>
                    </h3>
                    {g.rows.map((r) => {
                        const tel = telOf(r.phone);
                        const state = followUpState(r, a.today);
                        const when = state === 'done'
                            ? `Done ${shortDay(doneDayOf(r), a.today)}${r.followUpDoneByName ? ` · ${r.followUpDoneByName}` : ''}`
                            : [whenText(r, a.today) || shortDay(dueDayOf(r), a.today), a.showWhoLogged ? r.createdByName : ''].filter(Boolean).join(' · ');
                        return (
                            <article key={String(r._id)} className="fu-card">
                                <div className="fu-card-tick"><TickButton a={a} r={r} /></div>
                                <div className="fu-card-text">
                                    {r.customerId
                                        ? <button type="button" className="fu-link fu-card-title" onClick={() => a.onOpenCustomer(String(r.customerId))}>{companyOf(r)}</button>
                                        : <strong className="fu-card-title">{companyOf(r)}</strong>}
                                    <span className="fu-card-note">{followUpNote(r) || '—'}</span>
                                    {r.followUpOutcome && <span className="fu-card-outcome">{r.followUpOutcome}</span>}
                                    {snoozeText(r, a.today) && <span className="fu-snoozed">{snoozeText(r, a.today)}</span>}
                                    <span className={`fu-card-meta${state === 'overdue' ? ' is-late' : ''}${state === 'done' ? ' is-ok' : ''}`}>{when}</span>
                                </div>
                                <div className="fu-card-actions">
                                    {tel && <a className="fu-icon-btn is-boxed" href={`tel:${tel}`} aria-label={`Call ${companyOf(r)}`}><Phone size={18} /></a>}
                                    <RowMenu label={`More for ${companyOf(r)}`} items={menuItems(a, r, { withSnooze: true })} />
                                </div>
                            </article>
                        );
                    })}
                </section>
            ))}
        </div>
    );
}
