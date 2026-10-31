/**
 * The customer fields an import can fill, in the order both import windows
 * list them (the SPS import's "Show all" columns and the Excel import's
 * "Which column is which"). Same keys as IMPORT_FIELDS in
 * src/utils/customerImport.ts — not imported from there so the windows don't
 * pull the xlsx parser into the browser bundle.
 */
export const FIELD_LABELS: Record<string, string> = {
    salesRep: 'Sales rep',
    location: 'Easy Stones branch',
    marketingEmail: 'Marketing email',
    email: 'Email',
    contactName: 'Contact name',
    company: 'Company',
    phone: 'Phone',
    street: 'Street',
    street2: 'Suite / unit',
    city: 'City',
    state: 'State',
    zipCode: 'Zip',
    level: 'Level',
    customerType: 'Customer type',
    status: 'Status',
    modaDisplay: 'MODA display',
    modaBinder: 'MODA binder',
    receiveMarketing: 'Receive marketing',
    quickNote: 'Quick note',
    deliveryInstructions: 'Delivery instructions',
    accountAlert: 'Account alert'
};

// "Decided: nobody / the default branch", as opposed to '' ("not decided yet,
// ask again"). Same strings as IMPORT_UNASSIGNED / IMPORT_DEFAULT_BRANCH in
// src/utils/customerImport.ts, for the same reason as above.
export const UNASSIGNED = '__none__';
export const DEFAULT_BRANCH = '__default__';

/** A CSV cell: quoted, with quotes doubled. */
export const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
