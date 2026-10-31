import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import type { FollowUpAction, FollowUpCounts, FollowUpRangeQuery, FollowUpRow, FollowUpStatus } from '../../../utils/followUpList';

/**
 * Dashboard → Follow-ups' calls: the list (GET /api/dashboard/followups in
 * server.js) and a tick / reopen / snooze / note on one visit (PATCH
 * /api/customers/:customerId/visits/:visitId/follow-up, src/routes/visits.js).
 */

/** `counts`: the ones due in the range (the tiles); `summary`: the list (due in it plus still overdue). */
export type FollowUpsAnswer = { rows: FollowUpRow[]; counts: FollowUpCounts; summary: FollowUpCounts; doneThisWeek: number };

/** `range` is the dashboard's; `scope` its People / location query (`&reps=…&location=…`). */
export async function fetchFollowUps(status: FollowUpStatus, range: FollowUpRangeQuery, today: string, scope: string): Promise<FollowUpsAnswer> {
    const q = new URLSearchParams({ status, timeRange: range.range, localDate: today });
    if (range.range === 'custom') {
        if (range.from) q.set('from', range.from);
        if (range.to) q.set('to', range.to);
    }
    const res = await authFetch(`${API_URL}/api/dashboard/followups?${q}${scope}`);
    if (!res.ok) throw new Error(`The server answered ${res.status}`);
    return res.json();
}

/** Answers the stored visit; throws with the server's message on a refusal. */
export async function changeFollowUp(
    row: FollowUpRow,
    body: { action: FollowUpAction; today: string; until?: string; outcome?: string }
): Promise<FollowUpRow> {
    const res = await authFetch(`${API_URL}/api/customers/${row.customerId}/visits/${row._id}/follow-up`, {
        method: 'PATCH',
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `The server answered ${res.status}`);
    return data.visit;
}
