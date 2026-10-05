import { lastChangedText } from './userForm';

/*
 * Add / Edit customer's rules (src/components/sales/CustomerForm.jsx).
 * Approved design: model A on the "Add & Edit Customer" canvas
 * (claude.ai/artifact/G6YUNXvbtVqScRGB7dHtXD).
 *
 * The values keep the shape every save handler already expects —
 * onSave(form, close) in SalesPage, PartnersSheet and the route planner — so
 * the form can change without touching how customers are stored. Option
 * values are the stored ones (lists, filters and reports match on them);
 * only the labels are in sentence case.
 */

export const STATUS_OPTIONS = Object.freeze([
    { value: 'New Lead', label: 'New lead' },
    { value: 'Trying to Onboard', label: 'Trying to onboard' },
    { value: 'Contacted / In Discussion', label: 'Contacted / in discussion' },
    { value: 'Onboarded', label: 'Onboarded' },
    { value: 'Different Sales Person', label: 'Different sales person' },
    { value: 'Not Interested', label: 'Not interested' },
    { value: 'Inactive', label: 'Inactive' }
]);

export const LEVEL_OPTIONS = Object.freeze([
    { value: 'Level - 1', label: 'Level 1' },
    { value: 'Level - 2', label: 'Level 2' },
    { value: 'Level - 3', label: 'Level 3' },
    { value: 'Level - 4', label: 'Level 4' }
]);

export const TYPE_OPTIONS = Object.freeze([
    { value: 'Fabricator', label: 'Fabricator' },
    { value: 'Contractor', label: 'Contractor' },
    { value: 'Dealer', label: 'Dealer' },
    { value: 'Floor Covering', label: 'Floor covering' },
    { value: 'Designer', label: 'Designer' },
    { value: 'Builder', label: 'Builder' }
]);

export const MODA_DISPLAY_OPTIONS = Object.freeze([
    { value: 'No', label: 'No' },
    { value: 'Yes', label: 'Yes' }
]);

/** A stored value that's since left a list still shows (as stored) instead of blanking the picker. */
export const withCurrent = (options, value) =>
    value && !options.some((o) => o.value === value) ? [{ value, label: value }, ...options] : options;

// Banner/"Go to first" order = the order on screen.
export const FIELD_LABELS = Object.freeze({
    company: 'Company name',
    email: 'Email'
});

/**
 * A new customer: assumed to be the person entering it, at their branch —
 * right most of the time, and both stay editable. Someone who can't own
 * accounts (not in the rep list) starts Unassigned.
 */
export const emptyCustomerValues = ({ salesReps = [], locations = [], currentUser = null } = {}) => ({
    customerName: '',
    company: '',
    address: { street: '', city: '', state: '', zipCode: '' },
    phone: '',
    email: '',
    marketingEmail: '',
    receiveMarketing: true,
    notes: '',
    status: 'Onboarded',
    level: 'Level - 3',
    customerType: 'Fabricator',
    modaDisplay: 'No',
    modaBinder: '0',
    salesRep: salesReps.some((r) => r._id === currentUser?.id) ? currentUser.id : '',
    location: locations.find((l) => l === currentUser?.location) || locations[0] || ''
});

/** A stored customer → the form's values (the old modal's rules, unchanged). */
export const customerToFormValues = (c = {}) => ({
    customerName: c.contactName || c.customerName || c.name || '',
    company: c.company || '',
    address: {
        street: c.address?.street || '',
        city: c.address?.city || c.city || '',
        state: c.address?.state || '',
        zipCode: c.address?.zipCode || ''
    },
    phone: c.phone || '',
    email: c.email || '',
    marketingEmail: c.marketingEmail || c.email || '',
    receiveMarketing: c.receiveMarketing !== undefined ? c.receiveMarketing : true,
    notes: c.notes || c.quickNote || '',
    status: c.status || 'Onboarded',
    level: c.level || 'Level - 3',
    customerType: c.customerType || 'Fabricator',
    modaDisplay: c.modaDisplay || 'No',
    modaBinder: c.modaBinder || '0',
    // Older records may hold neither: the branch is backfilled to Seattle, the
    // rep stays empty until someone claims the account.
    salesRep: c.salesRep || '',
    location: c.location || 'Seattle'
});

/** Company and email are required (as before). Returns { field: message }. */
export const validateCustomerValues = (values = {}) => {
    const errors = {};
    if (!String(values.company || '').trim()) errors.company = 'Enter the company name';
    if (!String(values.email || '').trim()) errors.email = 'Enter an email address';
    return errors;
};

/**
 * Typing the email carries the marketing email along while the two are the
 * same (or the marketing one is blank); once someone sets a different
 * marketing address it's left alone.
 */
export const withEmail = (values, email) => {
    const sync = !values.marketingEmail || values.marketingEmail === values.email;
    return { ...values, email, marketingEmail: sync ? email : values.marketingEmail };
};

const FLAT = ['customerName', 'company', 'phone', 'email', 'marketingEmail', 'receiveMarketing', 'notes',
    'status', 'level', 'customerType', 'modaDisplay', 'modaBinder', 'salesRep', 'location'];
const ADDRESS = ['street', 'city', 'state', 'zipCode'];
const norm = (v) => (typeof v === 'string' ? v.trim() : v);

/** How many fields differ from where the form started (the discard check's N). */
export const countCustomerChanges = (values = {}, initial = {}) =>
    FLAT.filter((k) => norm(values[k]) !== norm(initial[k])).length
    + ADDRESS.filter((k) => norm(values.address?.[k] || '') !== norm(initial.address?.[k] || '')).length;

/**
 * What a business-card scan (parseBusinessCard's result) fills in. Only the
 * parts the card actually had; the email also becomes the marketing email.
 * Returns { values, found } — found is false when nothing was recognised.
 */
export const applyCardScan = (values, parsed) => {
    if (!parsed) return { values, found: false };
    const next = { ...values, address: { ...values.address } };
    let found = false;
    for (const k of ['customerName', 'company', 'phone']) {
        if (parsed[k]) { next[k] = parsed[k]; found = true; }
    }
    if (parsed.email) {
        next.email = parsed.email;
        next.marketingEmail = parsed.email;
        found = true;
    }
    for (const k of ADDRESS) {
        if (parsed.address?.[k]) { next.address[k] = parsed.address[k]; found = true; }
    }
    return { values: next, found };
};

/** The edit footer's note: when the record last changed, else when it was added. */
export const customerLastChangedText = (c = {}, now = new Date()) =>
    lastChangedText({ editedAt: c.updatedAt, editedBy: c.updatedByName, createdAt: c.createdAt }, now);
