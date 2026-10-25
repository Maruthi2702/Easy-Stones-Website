/**
 * What Add / Edit customer shows that isn't a saving rule (those are
 * src/utils/customerForm.ts, shared with the server's tests): the sales rep
 * choices, a possible duplicate's lines, and the business-card notes.
 */
import type { RepOption } from '../../../components/shared/form/RepPicker';
import type { Loose } from '../../../types/records';

/**
 * The rep choices, grouped under each rep's branch by RepPicker (the format
 * every rep dropdown shares). The customer rep list (toSalesRepList) keeps
 * deactivated reps so the Customer List can still filter by them; nobody
 * picks one for an account, though — only the rep already on this customer
 * still shows, and one no longer on the list shows under "Other".
 */
export const customerRepOptions = (salesReps: Loose[], salesRep: string, editingCustomer: Loose | null): RepOption[] => {
    const list: RepOption[] = salesReps
        .filter((r) => !r.inactive || String(r._id) === String(salesRep))
        .map((r) => ({ value: String(r._id), label: r.name, location: r.location || '', id: String(r._id) }));
    if (salesRep && !list.some((o) => o.value === String(salesRep))) {
        list.push({ value: String(salesRep), label: editingCustomer?.salesRepName || 'Rep no longer listed', location: '' });
    }
    return list;
};

/** A possible duplicate's name and its one line of detail. */
export const dupName = (m: Loose) => m.company || m.contactName || m.name;
export const dupMeta = (m: Loose) => [m.address?.city || m.city, m.phone, m.salesRepName || 'Unassigned', m.location || 'Seattle', m.status].filter(Boolean).join(' · ');

/** The note under the header after a business-card read (by its result). */
export const SCAN_NOTES: Record<string, { tone: string; text: string }> = {
    filled: { tone: 'ok', text: 'Filled in from the card — check the details' },
    nothing: { tone: 'err', text: 'Couldn’t find contact details on that card. Try again with the card filling the frame.' },
    failed: { tone: 'err', text: 'Couldn’t read the card. Try again.' },
    nocamera: { tone: 'err', text: 'Couldn’t open the camera. Allow camera access, or upload a photo instead.' }
};
