import { dayOf } from '../../utils/followUpPanel.ts';
import type { PersonOption } from '../../api/myTeam';
import type { Loose } from '../../types/records';

/**
 * The Sales dashboard's "By rep" table (2026-10-31): the visits, resources and
 * follow-ups already loaded for the period and People / Location filters,
 * counted per person. Built from the same lists as the tiles, so the totals
 * match them. A rep in view with nothing logged still gets a row of zeros —
 * the point of the table is seeing who has been quiet too.
 *
 * A visit / follow-up belongs to whoever logged it (`createdBy`), a resource to
 * whoever uploaded it (`uploadedBy`, else `createdBy`) — the same person
 * canModifyVisit checks. Entries with no one recorded share one "Not recorded"
 * row.
 */
export type RepRow = {
    id: string;
    name: string;
    branch: string;
    you: boolean;
    inactive: boolean;
    visits: number;
    resources: number;
    followUps: number;
    /** Follow-ups whose date is before today. */
    late: number;
    /** Stops on their calendar today (the team calendar; 0 without it). */
    todayStops: number;
};

export type RepBreakdownInput = {
    visits: Loose[];
    resources: Loose[];
    followUps: Loose[];
    /** Calendar entries loaded for the dashboard (the team calendar's, with userId). */
    schedules?: Loose[];
    /** Who the People filter offers (usePeopleOptions). */
    people: PersonOption[];
    /** The People filter's value: [] = My team, else the ids picked. */
    selection: string[];
    /** The Location filter ('' = all): people working there. */
    location: string;
    me: string;
    /** Today, YYYY-MM-DD. */
    today: string;
};

export const NOT_RECORDED = '';
const NOT_RECORDED_NAME = 'Not recorded';

const idOf = (v: unknown) => (v == null ? '' : String(v));

export function repBreakdown({ visits, resources, followUps, schedules = [], people, selection, location, me, today }: RepBreakdownInput): RepRow[] {
    const byId = new Map(people.map((p) => [p.value, p]));
    const rows = new Map<string, RepRow>();
    const rowFor = (id: string, fallbackName = ''): RepRow => {
        let row = rows.get(id);
        if (!row) {
            const p = byId.get(id);
            row = {
                id,
                name: p?.label || fallbackName.trim() || (id === NOT_RECORDED ? NOT_RECORDED_NAME : 'Unknown'),
                branch: p?.location || '',
                you: Boolean(me) && id === me,
                inactive: Boolean(p?.inactive),
                visits: 0, resources: 0, followUps: 0, late: 0, todayStops: 0
            };
            rows.set(id, row);
        }
        return row;
    };

    // Everyone in view starts with a row: My team = the active reps offered
    // (at the picked location, if any); a pick = the people picked.
    const inView = selection.length
        ? selection.map((id) => byId.get(id)).filter((p): p is PersonOption => Boolean(p))
        : people.filter((p) => !p.inactive && (!location || (p.locations || [p.location]).includes(location)));
    for (const p of inView) rowFor(p.value);

    for (const v of visits) rowFor(idOf(v?.createdBy), String(v?.createdByName || '')).visits++;
    for (const r of resources) rowFor(idOf(r?.uploadedBy || r?.createdBy), String(r?.uploadedByName || '')).resources++;
    for (const f of followUps) {
        const row = rowFor(idOf(f?.createdBy), String(f?.createdByName || ''));
        row.followUps++;
        const due = dayOf(f?.followUpDate);
        if (due && today && due < today) row.late++;
    }
    // Today's stops: an entry starting today ('YYYY-MM-DDTHH:mm…', local), not cancelled.
    for (const s of schedules) {
        if (!s || s.status === 'Cancelled' || String(s.startTime || '').slice(0, 10) !== today) continue;
        rowFor(idOf(s.userId), String(s.ownerName || '')).todayStops++;
    }

    return [...rows.values()].sort((a, b) =>
        Number(a.id === NOT_RECORDED) - Number(b.id === NOT_RECORDED)
        || b.visits - a.visits
        || b.followUps - a.followUps
        || b.resources - a.resources
        || a.name.localeCompare(b.name));
}

/** The table's last row: every column added up. */
export const repTotals = (rows: RepRow[]) => rows.reduce(
    (t, r) => ({ visits: t.visits + r.visits, resources: t.resources + r.resources, followUps: t.followUps + r.followUps, late: t.late + r.late, todayStops: t.todayStops + r.todayStops }),
    { visits: 0, resources: 0, followUps: 0, late: 0, todayStops: 0 }
);
