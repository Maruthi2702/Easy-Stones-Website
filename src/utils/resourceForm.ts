/*
 * Add / Edit resource's rules (the form is src/features/resources/form/,
 * FORM_TEMPLATE.md, size M; design: Option A · Forms on the claude.ai
 * artifact "Resources Redesign Canvas"). The server reads parseResourceQty
 * too, so both sides agree on what a quantity is.
 */

/** A resource's fields as the form holds them (all strings, like the inputs). */
export type ResourceValues = {
    customerId: string;
    resourceType: string;
    qty: string;
    date: string;
    status: string;
    description: string;
    notes: string;
};

export const RESOURCE_QTY_MAX = 999;

export const RESOURCE_STATUSES = [
    { value: 'Active', label: 'Active' },
    { value: 'Inactive', label: 'Inactive' },
    { value: 'Archived', label: 'Archived' }
];

/** The banner's names for the fields that can be wrong, in form order. */
export const RESOURCE_FIELD_LABELS: Record<string, string> = {
    customerId: 'Customer',
    resourceType: 'Resource type',
    qty: 'Qty',
    date: 'Date'
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A quantity as stored: a whole number 1–999. Blank or missing is 1 (every
 * resource saved before Qty existed was one of something); anything else
 * that isn't a whole number in range is null, which the server refuses.
 */
export const parseResourceQty = (value: unknown): number | null => {
    if (value === undefined || value === null || String(value).trim() === '') return 1;
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return n >= 1 && n <= RESOURCE_QTY_MAX ? n : null;
};

/** How many of a resource a saved record holds (1 when it predates Qty). */
export const resourceQty = (record: { qty?: unknown } | null | undefined): number => parseResourceQty(record?.qty) ?? 1;

/** A new resource: today, Active, one of it; the customer when the form opens on one. */
export const emptyResourceValues = (today: string, customerId = ''): ResourceValues => ({
    customerId,
    resourceType: '',
    qty: '1',
    date: today,
    status: 'Active',
    description: '',
    notes: ''
});

/** A saved resource (or the form's own state) → the form's values; qty kept as typed. */
export const resourceValuesFrom = (record: Record<string, unknown>, today: string): ResourceValues => ({
    customerId: String(record.customerId ?? ''),
    resourceType: String(record.resourceType || record.title || ''),
    qty: record.qty === undefined || record.qty === null ? '1' : String(record.qty),
    date: String(record.date || '').slice(0, 10) || today,
    status: String(record.status || 'Active'),
    description: String(record.description ?? ''),
    notes: String(record.notes ?? '')
});

/** { field: message } for every field that would be refused. */
export const validateResourceValues = (values: ResourceValues): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!values.customerId) errors.customerId = 'Choose a customer';
    if (!values.resourceType.trim()) errors.resourceType = 'Choose a resource type';
    if (parseResourceQty(values.qty) === null || values.qty.trim() === '') errors.qty = `Enter a whole number from 1 to ${RESOURCE_QTY_MAX}`;
    if (!DATE_RE.test(values.date)) errors.date = 'Choose a date';
    return errors;
};

const FIELDS: (keyof ResourceValues)[] = ['customerId', 'resourceType', 'qty', 'date', 'status', 'description', 'notes'];

/** How many fields differ from where the form started (attachments counted by the caller). */
export const countResourceChanges = (values: ResourceValues, initial: ResourceValues): number =>
    FIELDS.filter((k) => String(values[k] ?? '').trim() !== String(initial[k] ?? '').trim()).length;

/** The values as the API takes them: qty a number, and the title the type (as before). */
export const resourceValuesToSave = (values: ResourceValues) => ({
    customerId: values.customerId,
    resourceType: values.resourceType.trim(),
    title: values.resourceType.trim(),
    qty: parseResourceQty(values.qty) ?? 1,
    date: values.date,
    status: values.status || 'Active',
    description: values.description.trim(),
    notes: values.notes.trim()
});
