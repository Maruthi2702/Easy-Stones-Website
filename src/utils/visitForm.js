import { lastChangedText } from './userForm.js';
import { visitFieldsOf } from './typeLists.js';

/*
 * Add / Edit visit's rules (src/components/sales/VisitForm.jsx). Approved
 * design: model C on the "Add & Edit Visit" canvas
 * (claude.ai/artifact/UPcjj89doxCRsubhTrDZfN), on the shared form template.
 *
 * `purpose` is a visit type's stored name (Admin → Visit Types, the VisitType
 * collection) — lists, filters, reports and the calendar all match on it; the
 * form shows the type's label.
 */

/** The form's label for a stored purpose, from the loaded list; an unknown (legacy) one shows as stored. */
export const visitTypeLabel = (purpose, types = []) => types.find((t) => t.name === purpose)?.label || purpose || '';

/**
 * Which fields a visit type uses — set per type in Admin → Visit Types and read
 * from its record (`type`; undefined for a legacy value no longer in the list,
 * which gets every field with the follow-up behind a toggle):
 *   notes / outcome → on or off
 *   follow-up 'none' → hidden, 'optional' → behind a toggle, 'always' → open
 */
export const visitFieldsFor = (type) => {
    const f = visitFieldsOf(type);
    return {
        notes: f.notes,
        outcome: f.outcome,
        followUp: f.followUp !== 'none',
        followUpToggle: f.followUp === 'optional'
    };
};

/** Whether the follow-up fields are on screen for this type and toggle. */
export const followUpShown = (type, followUpOn = false) => {
    const f = visitFieldsFor(type);
    return f.followUp && (!f.followUpToggle || Boolean(followUpOn));
};

/**
 * What Save sends: follow-up details only when they're on screen. Typed into
 * a follow-up, then switched to a type (or toggle) that hides it, they used to
 * be saved anyway — with a calendar reminder nobody could see on the form.
 */
export const visitValuesToSave = (values = {}, type, followUpOn = false) =>
    (followUpShown(type, followUpOn) ? values : { ...values, followUp: '', followUpDate: '' });

/**
 * The server's copy of the rule above: a type with no follow-up never stores
 * one, whatever the request carried. Only the fields the request sent are
 * touched, so an edit that doesn't mention follow-up leaves it alone.
 */
export const cleanVisitFields = (type, fields = {}) => {
    if (visitFieldsFor(type).followUp) return fields;
    const out = { ...fields };
    if (out.followUp !== undefined) out.followUp = '';
    if (out.followUpDate !== undefined) out.followUpDate = '';
    return out;
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

/**
 * A new visit's id, made on the form before Save is sent (24 hex, the shape of
 * a MongoDB ObjectId: 4 bytes of time, 8 random). The server keeps the first
 * visit saved under an id and answers a repeat with it, so a retry after a lost
 * answer can't add the visit twice.
 */
export const newVisitId = (now = Date.now(), random = (n) => crypto.getRandomValues(new Uint8Array(n))) => {
    const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return Math.floor(now / 1000).toString(16).padStart(8, '0').slice(-8) + hex(random(8));
};
