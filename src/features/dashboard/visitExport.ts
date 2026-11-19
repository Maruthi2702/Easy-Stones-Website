import { formatDate } from '../../utils/dateUtils';
import { splitCustomer } from '../../components/sales/visitsListHelpers';
import { locationExportColumns } from '../../utils/visitLocation';
import type { LoggedFrom } from '../../utils/visitLocation';
import type { Loose } from '../../types/records';

/**
 * The rows of Dashboard → Sales Visits → ⋯ → Export this view to Excel. With `marks` (only for people
 * who may see where visits were logged: the readings the server allowed, by visit id) it adds Where
 * logged, Distance and Device; a visit with no reading says "-", never a guess. Without `marks`
 * the columns are the same as before, so nobody else's file changes.
 */
export function visitExportRows(visits: Loose[], marks?: Record<string, LoggedFrom>): Loose[] {
    return visits.map((v) => {
        const { company, contact } = splitCustomer(v);
        const reading = marks ? marks[String(v._id)] : undefined;
        return {
            Date: formatDate(v.date),
            Company: company,
            Contact: contact || '-',
            Location: v.location || '-',
            'Visit Type': v.purpose || '-',
            'Logged By': v.createdByName || '-',
            Notes: v.notes || '-',
            'Follow-up Date': v.followUpDate ? formatDate(v.followUpDate) : '-',
            'Follow-up Notes': v.followUp || v.nextAction || '-',
            Outcome: v.outcome || '-',
            ...(marks ? locationExportColumns(reading) : {})
        };
    });
}
