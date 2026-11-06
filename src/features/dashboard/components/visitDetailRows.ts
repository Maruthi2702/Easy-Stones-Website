import { formatDate } from '../../../utils/dateUtils';
import type { Loose } from '../../../types/records';

export type VisitDetailRow = { key: string; cls: string; label: string; value: string };

const text = (v: unknown) => String(v ?? '').trim();

/**
 * What a visit says beyond its note, in the Add / Edit visit form's order —
 * Outcome, Follow up, Follow-up date, Manager comment, HQ comment, Next steps —
 * leaving out anything empty. Shared by the Dashboard's open row and its View
 * pop-up so both show the same things. A Quick Note or resource visit has no
 * outcome or follow-up text (the form doesn't ask for them). `comments` are
 * the single-visit route's, read again when the pop-up opens; the list's own
 * copy is used until they arrive.
 */
export function visitDetailRows(visit: Loose, comments?: { managerComment?: string; headquartersComment?: string } | null): VisitDetailRow[] {
    const plain = /quick note|resource placement|resource update/i.test(text(visit.purpose));
    const manager = text(comments?.managerComment ?? visit.managerComment);
    const hq = text(comments?.headquartersComment ?? visit.headquartersComment);
    const rows: (VisitDetailRow | false)[] = [
        !plain && Boolean(text(visit.outcome)) && { key: 'outcome', cls: 'outcome', label: 'Outcome', value: text(visit.outcome) },
        !plain && Boolean(text(visit.followUp)) && { key: 'follow-up', cls: 'follow-up', label: 'Follow up', value: text(visit.followUp) },
        Boolean(visit.followUpDate) && { key: 'follow-up-date', cls: 'follow-up', label: 'Follow-up date', value: formatDate(visit.followUpDate as string, { month: 'short', day: 'numeric', year: 'numeric' }) },
        Boolean(manager) && { key: 'manager', cls: 'manager-comment', label: 'Manager comment', value: manager },
        Boolean(hq) && { key: 'hq', cls: 'hq-comment', label: 'HQ comment', value: hq },
        Boolean(text(visit.nextAction)) && { key: 'next', cls: 'next-action', label: 'Next steps', value: text(visit.nextAction) },
    ];
    return rows.filter((r): r is VisitDetailRow => Boolean(r));
}
