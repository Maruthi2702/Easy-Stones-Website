import { contactOf, realEmailsOf } from '../../../utils/customerList';
import type { Loose } from '../../../types/records';

/**
 * What the profile header's ⋯ menu holds, and where it shows (the "Customer
 * profile header redesign" canvas, 2026-10-29). Edit and Delete only appear
 * for a login that has them; on a screen up to 700px the status picker leaves
 * the header and moves in as "Status"; on a phone (up to 640px) Call and
 * Directions join it. The button itself shows only where it has something.
 */
export type HeaderMenuInput = {
    canEditCustomer: boolean;
    canDeleteCustomer: boolean;
    canChangeStatus: boolean;
    hasPhone: boolean;
    hasAddress: boolean;
};

export type HeaderMenuPlan = {
    edit: boolean;
    delete: boolean;
    status: boolean;
    call: boolean;
    directions: boolean;
    /** Which screens show the ⋯ button: everywhere, up to 700px, up to 640px, or nowhere. */
    button: 'always' | 'narrow' | 'phone' | 'none';
};

export const planHeaderMenu = (i: HeaderMenuInput): HeaderMenuPlan => {
    const wide = i.canEditCustomer || i.canDeleteCustomer;
    const button = wide ? 'always' : i.canChangeStatus ? 'narrow' : (i.hasPhone || i.hasAddress) ? 'phone' : 'none';
    return {
        edit: i.canEditCustomer,
        delete: i.canDeleteCustomer,
        status: i.canChangeStatus,
        call: i.hasPhone,
        directions: i.hasAddress,
        button
    };
};

/** `tel:` link for a stored phone number. */
export const telHref = (phone: unknown): string => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

/** Google Maps directions to an address. */
export const directionsHref = (address: string): string =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

/** Wording of the "Delete customer" check: what goes with the customer. */
export const deleteSummary = (c: Loose | null | undefined): string => {
    const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const visits = (c?.visits || []).length;
    const resources = (c?.resources || []).length;
    const contacts = (c?.contacts || []).length;
    if (!visits && !resources && !contacts) return 'This removes the customer.';
    const list = [visits && part(visits, 'visit', 'visits'), resources && part(resources, 'resource', 'resources'), contacts && part(contacts, 'contact', 'contacts')].filter(Boolean) as string[];
    const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
    return `This also removes its ${joined}.`;
};

/** Does this customer show any row on the Contacts tab (the main contact counts)? */
export const hasAnyContact = (customer: Loose | null | undefined): boolean => {
    const c: Loose = customer || {};
    return Boolean(contactOf(c) || c.phone || realEmailsOf(c).length || (c.contacts || []).length);
};
