import { AlarmClock, Check, CircleCheck, Eye, MapPin, MessageSquareText, Pencil, Phone, RotateCcw, User } from 'lucide-react';
import RowMenu from '../../../components/shared/RowMenu';
import type { RowMenuItem } from '../../../components/shared/RowMenu';
import {
    doneDayOf, dueBucketOf, dueDayOf, followUpNote, isFollowUpDone, shortDay, snoozeText, whenText
} from '../../../utils/followUpList';
import type { FollowUpGroup, FollowUpRow, FollowUpStatus } from '../../../utils/followUpList';

export type FollowUpRowActions = {
    today: string;
    status: FollowUpStatus;
    /** Kept for the panel's API; who logged it now shows on every row (owner, 2026-10-31). */
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
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?';

/** How due a row is, for its colour: late (red), today (amber), soon (plain), done (green). */
const toneOf = (r: FollowUpRow, today: string) => {
    if (isFollowUpDone(r)) return 'done';
    const bucket = dueBucketOf(r, today);
    return bucket === 'overdue' ? 'late' : bucket === 'today' ? 'today' : 'soon';
};

/**
 * Everything a follow-up row can do lives in its ⋯ (owner, 2026-10-31): Call, Snooze,
 * what happened, Reopen, the visit and the customer. On a phone Done is in it too
 * (desktop and tablet keep the tick at the row's start).
 */
const menuItems = (a: FollowUpRowActions, r: FollowUpRow, { withDone = false } = {}): RowMenuItem[] => {
    const may = a.canModify(r);
    const done = isFollowUpDone(r);
    const tel = telOf(r.phone);
    const items: RowMenuItem[] = [];
    if (withDone && may) {
        items.push(done
            ? { key: 'reopen', label: 'Reopen', icon: RotateCcw, onClick: () => a.onReopen(r) }
            : { key: 'done', label: 'Mark done', icon: CircleCheck, onClick: () => a.onTick(r) });
    }
    if (tel) items.push({ key: 'call', label: `Call ${r.phone}`, icon: Phone, onClick: () => { window.location.href = `tel:${tel}`; } });
    if (may && !done) items.push({ key: 'snooze', label: 'Snooze…', icon: AlarmClock, onClick: () => a.onSnooze(r) });
    if (may && done) {
        items.push({ key: 'outcome', label: r.followUpOutcome ? 'Edit what happened' : 'Add what happened', icon: MessageSquareText, onClick: () => a.onOutcome(r) });
        if (!withDone) items.push({ key: 'reopen', label: 'Reopen', icon: RotateCcw, onClick: () => a.onReopen(r) });
    }
    items.push({ key: 'view', label: 'Open visit', icon: Eye, onClick: () => a.onViewVisit(r), divider: items.length > 0 });
    if (may) items.push({ key: 'edit', label: 'Edit visit', icon: Pencil, onClick: () => a.onEditVisit(r) });
    if (r.customerId) items.push({ key: 'customer', label: 'Open customer', icon: User, onClick: () => a.onOpenCustomer(String(r.customerId)) });
    return items;
};

function TickButton({ a, r }: { a: FollowUpRowActions; r: FollowUpRow }) {
    const done = isFollowUpDone(r);
    if (!a.canModify(r)) return done ? <span className="fu-tick is-done is-static" aria-label="Done"><Check size={13} strokeWidth={3} /></span> : <span className="fu-tick-gap" />;
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

/** The due day as a date block, coloured by how due it is (like a Visits row's date block). */
function DateBlock({ r, tone }: { r: FollowUpRow; tone: string }) {
    const day = dueDayOf(r);
    return (
        <span className={`fu-dateblock is-${tone}`} aria-hidden="true">
            <span>{day ? MONTHS[Number(day.slice(5, 7)) - 1] : ''}</span>
            <strong>{day ? Number(day.slice(8, 10)) : '—'}</strong>
        </span>
    );
}

/** "7 days late" / "Today" / "Tue" — or Done and when, for a done one. */
function DuePill({ r, today, tone }: { r: FollowUpRow; today: string; tone: string }) {
    if (tone === 'done') {
        return <span className="fu-duepill is-done"><Check size={11} strokeWidth={3} aria-hidden="true" />Done {shortDay(doneDayOf(r), today)}</span>;
    }
    return <span className={`fu-duepill is-${tone}`}>{whenText(r, today) || shortDay(dueDayOf(r), today)}</span>;
}

/** The customer's location, the same pill a Visits row shows. */
function LocationPill({ r }: { r: FollowUpRow }) {
    if (!r.location) return null;
    return <span className="fu-locpill"><MapPin size={12} aria-hidden="true" />{r.location}</span>;
}

/** Who logged it and the day: the rep as a chip with initials (owner: a manager reads this first). */
function Logged({ r, today }: { r: FollowUpRow; today: string }) {
    const name = String(r.createdByName || '').trim();
    const day = String(r.date || '').slice(0, 10);
    return (
        <span className="fu-logged">
            {name && <span className="fu-repchip"><span className="fu-repchip-av" aria-hidden="true">{initialsOf(name)}</span>{name}</span>}
            {day && <span className="fu-logged-day">{shortDay(day, today)}</span>}
        </span>
    );
}

function Note({ r, today }: { r: FollowUpRow; today: string }) {
    const snoozed = snoozeText(r, today);
    return (
        <>
            <span className="fu-r-note">{followUpNote(r) || '—'}</span>
            {r.followUpOutcome && <span className="fu-outcome"><strong>What happened:</strong> {r.followUpOutcome}</span>}
            {snoozed && <span className="fu-snoozed">{snoozed}</span>}
        </>
    );
}

function CustomerName({ a, r, className }: { a: FollowUpRowActions; r: FollowUpRow; className: string }) {
    return r.customerId
        ? <button type="button" className={`fu-link ${className}`} onClick={() => a.onOpenCustomer(String(r.customerId))}>{companyOf(r)}</button>
        : <strong className={className}>{companyOf(r)}</strong>;
}

function GroupHead({ g, status }: { g: FollowUpGroup & { total: number }; status: FollowUpStatus }) {
    return (
        <h3 className={`fu-sec-head${g.late ? ' is-late' : ''}`}>
            <span className={`fu-sec-dot is-${g.late ? 'late' : g.key === 'today' ? 'today' : 'soon'}`} aria-hidden="true" />
            {g.label}
            <span className="fu-sec-count">{status === 'all' ? `${g.total} · ${g.done} done · ${g.pending} pending` : g.total}</span>
        </h3>
    );
}

/**
 * Desktop and tablet: one row per follow-up, shaped like a Visits row (claude.ai
 * artifact "Dashboard tabs — Visits, Resources, Follow-ups, Calendar", Follow-ups ·
 * desktop — one header): tick, the due day's date block, the customer with its
 * location, the note, who logged it and when, the due pill, and ⋯ for the rest.
 */
export function FollowUpTable({ groups, ...a }: Props) {
    return (
        <div className="fu-list">
            {groups.map((g) => (
                <section key={g.key} className="fu-sec" aria-label={g.label}>
                    <GroupHead g={g} status={a.status} />
                    <ul className="fu-rows">
                        {g.rows.map((r) => {
                            const tone = toneOf(r, a.today);
                            return (
                                <li key={String(r._id)} className={`fu-r${r._saving ? ' is-saving' : ''}${tone === 'done' ? ' is-done' : ''}`}>
                                    <TickButton a={a} r={r} />
                                    <DateBlock r={r} tone={tone} />
                                    <div className="fu-r-main">
                                        <span className="fu-r-top"><CustomerName a={a} r={r} className="fu-r-name" /><LocationPill r={r} /></span>
                                        <Note r={r} today={a.today} />
                                        <Logged r={r} today={a.today} />
                                    </div>
                                    <DuePill r={r} today={a.today} tone={tone} />
                                    <RowMenu label={`More for ${companyOf(r)}`} items={menuItems(a, r)} />
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </div>
    );
}

/**
 * Phones: a card per follow-up (same canvas, Follow-ups · phone). Two rows on top —
 * the customer with the due pill, then its location and due day — the note, and one
 * line with who logged it, the day and ⋯ (Done is in ⋯ here).
 */
export function FollowUpCards({ groups, ...a }: Props) {
    return (
        <div className="fu-cards">
            {groups.map((g) => (
                <section key={g.key} className="fu-sec" aria-label={g.label}>
                    <GroupHead g={g} status={a.status} />
                    <div className="fu-pcs">
                        {g.rows.map((r) => {
                            const tone = toneOf(r, a.today);
                            return (
                                <article key={String(r._id)} className={`fu-pc${r._saving ? ' is-saving' : ''}${tone === 'done' ? ' is-done' : ''}`}>
                                    <div className="fu-pc-top">
                                        <CustomerName a={a} r={r} className="fu-pc-name" />
                                        <DuePill r={r} today={a.today} tone={tone} />
                                    </div>
                                    <div className="fu-pc-sub">
                                        <LocationPill r={r} />
                                        <span>Due {shortDay(dueDayOf(r), a.today)}</span>
                                    </div>
                                    <Note r={r} today={a.today} />
                                    <div className="fu-pc-foot">
                                        <Logged r={r} today={a.today} />
                                        <RowMenu label={`More for ${companyOf(r)}`} items={menuItems(a, r, { withDone: true })} />
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>
            ))}
        </div>
    );
}
