import type { Loose } from '../../types/records';

/**
 * How an open profile asks for what only the Customers list can do. The list
 * (PartnersSheet) stays mounted while a profile is open and owns Edit customer
 * and Delete; the profile sends it a request, and the list tells the profile
 * when a customer was saved so it can reload. The profile and the list never
 * import each other's internals (CLAUDE.md, "Code layout").
 */
export const EDIT_REQUEST = 'customers:edit-request';
export const DELETE_REQUEST = 'customers:delete-request';
export const CUSTOMER_SAVED = 'customers:saved';

export type DeleteRequestDetail = { id: string; onSettled?: (deleted: boolean) => void };

/** Open the Edit customer form on this record. */
export const requestEditCustomer = (customer: Loose) => {
    window.dispatchEvent(new CustomEvent(EDIT_REQUEST, { detail: { customer } }));
};

/** Delete this customer (the caller has already asked "are you sure"); `onSettled` says whether it's gone. */
export const requestDeleteCustomer = (id: string, onSettled?: (deleted: boolean) => void) => {
    window.dispatchEvent(new CustomEvent<DeleteRequestDetail>(DELETE_REQUEST, { detail: { id, onSettled } }));
};

/** A customer was saved from the list's form: the open profile reloads it. */
export const announceCustomerSaved = (id: string | null | undefined) => {
    window.dispatchEvent(new CustomEvent(CUSTOMER_SAVED, { detail: { id: id || null } }));
};
