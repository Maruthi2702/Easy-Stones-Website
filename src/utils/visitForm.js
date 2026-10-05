import { lastChangedText } from './userForm';

/*
 * Add / Edit visit's rules (src/components/sales/VisitForm.jsx). Approved
 * design: model C on the "Add & Edit Visit" canvas
 * (claude.ai/artifact/UPcjj89doxCRsubhTrDZfN), on the shared form template.
 *
 * `purpose` keeps the stored values below — lists, filters, reports and the
 * calendar all match on them — the form only shows them in sentence case.
 */

export const VISIT_TYPES = Object.freeze([
    { value: 'Quick Note', label: 'Quick note' },
    { value: 'Follow up Notes', label: 'Follow-up notes' },
    { value: 'Scheduled in Person Sales Meeting', label: 'Scheduled in-person sales meeting' },
    { value: 'Unscheduled in Person Sales Call', label: 'Unscheduled in-person sales call' },
    { value: 'Resource Placement', label: 'Resource placement' },
    { value: 'Resource Update', label: 'Resource update' },
    { value: 'Formal Presentation', label: 'Formal presentation' },
    { value: 'Important Remote Meeting/Call', label: 'Important remote meeting / call' },
    { value: 'In Office Administration Day', label: 'In-office admin day' },
    { value: 'Personal Time Off', label: 'Personal time off' }
]);

/** The form's label for a stored purpose; an unknown (legacy) one shows as stored. */
export const visitTypeLabel = (purpose) => VISIT_TYPES.find((t) => t.value === purpose)?.label || purpose || '';

/**
 * Which fields a visit type uses — the same rules the old form had:
 *   Quick note       → Notes only (no Outcome, no Follow-up)
 *   Follow-up notes  → Follow-up only (no Notes, no Outcome), always open
 *   anything else    → Notes, Outcome, and Follow-up behind a toggle
 */
export const visitFieldsFor = (purpose) => {
    const p = String(purpose || '');
    const quick = p.toLowerCase().includes('quick note');
    const followUpOnly = p === 'Follow up Notes';
    return {
        notes: !followUpOnly,
        outcome: !quick && !followUpOnly,
        followUp: !quick,
        followUpToggle: !quick && !followUpOnly
    };
};

/** Whether a visit already has follow-up details (opens the toggle on "Set a follow-up"). */
export const hasFollowUp = (values = {}) =>
    Boolean(String(values.followUp || '').trim() || String(values.followUpDate || '').trim());

// Banner/“Go to first” order = the order on screen.
export const FIELD_LABELS = Object.freeze({
    customerId: 'Customer',
    purpose: 'Visit type',
    date: 'Date'
});

/** Required fields. Returns { field: message } for each problem. */
export const validateVisitValues = (values = {}) => {
    const errors = {};
    if (!String(values.customerId || '').trim()) errors.customerId = 'Choose a customer';
    if (!String(values.purpose || '').trim()) errors.purpose = 'Choose a visit type';
    if (!String(values.date || '').trim()) errors.date = 'Enter the visit date';
    return errors;
};

const COMPARED = ['customerId', 'purpose', 'date', 'notes', 'outcome', 'followUpDate', 'followUp', 'managerComment', 'headquartersComment'];
const imagesOf = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** How many fields differ from where the form started (the discard check's N). */
export const countVisitChanges = (values = {}, initial = {}) => {
    let n = COMPARED.filter((k) => String(values[k] ?? '').trim() !== String(initial[k] ?? '').trim()).length;
    const a = imagesOf(values.image);
    const b = imagesOf(initial.image);
    if (a.length !== b.length || a.some((img, i) => img !== b[i])) n += 1;
    return n;
};

/** The edit footer's note: who last changed the visit, else who logged it. */
export const visitLastChangedText = (visit = {}, now = new Date()) => {
    const changed = lastChangedText({ editedAt: visit.updatedAt, editedBy: visit.updatedByName }, now);
    if (changed) return changed;
    if (!visit.createdAt) return '';
    const added = lastChangedText({ createdAt: visit.createdAt }, now); // "Added Oct 2"
    return added && visit.createdByName ? added.replace(/^Added/, `Logged by ${visit.createdByName} ·`) : added;
};
