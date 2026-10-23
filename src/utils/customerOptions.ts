import { isFillerName } from './customerMatch.js';

/** The customer fields the dropdown reads (any record shape the API sends). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- address fields come in several stored shapes
type AnyCustomer = Record<string, any>;

/** A customer as a dropdown option. */
export type CustomerOption = {
    value: string;
    label: string;
    description?: string;
    keywords: string;
    city: string;
    address: string;
    fullAddress: string;
    salesRepName: string;
    customerType: string;
};

/**
 * How a customer appears in every customer dropdown — the one rule for the
 * Visit, Delivery, Lost sale, Resource, Sales planner, route planner and
 * link-a-partner pickers (2026-10-06). Before this each built its own list,
 * with different names for the same account ("N/A" in one, "Unknown" in
 * another), different sorting, and only some showing the city.
 *
 * Pure, so it's tested in customerOptions.test.js; the shared list itself
 * (loaded once, kept fresh) is src/api/customerOptions.js.
 */

const textOf = (val: unknown): string => {
    if (!val) return '';
    if (typeof val === 'string') return val === '[object Object]' ? '' : val.trim();
    if (typeof val === 'object') {
        const v = val as AnyCustomer;
        const inner = v.street || v.address || v.line1 || v.city || v.name || '';
        return typeof inner === 'string' ? (inner === '[object Object]' ? '' : inner.trim()) : String(inner || '').trim();
    }
    return String(val).trim();
};

const real = (value: unknown): string => (isFillerName(value) ? '' : String(value).trim());

/** The name shown for a customer: company, else contact, else first + last. Filler like "N/A" is skipped. */
export const customerLabel = (c: string | AnyCustomer | null | undefined): string => {
    if (!c) return 'Unknown';
    if (typeof c === 'string') return c.trim() || 'Unknown';
    return real(c.company)
        || real(c.contactName)
        || real(`${c.firstName || ''} ${c.lastName || ''}`)
        || 'Unknown';
};

/** City / street / state out of the several address shapes customers are stored in. */
export const customerAddressParts = (c: AnyCustomer = {}): { street: string; city: string; state: string } => {
    let city = textOf(c.city) || textOf(c.shippingCity) || textOf(c.billingCity);
    for (const nested of [c.address, c.shippingAddress, c.billingAddress]) {
        if (!city && nested && typeof nested === 'object') city = textOf(nested.city);
    }
    let street = (c.address && typeof c.address === 'object' ? textOf(c.address.street) : textOf(c.address))
        || textOf(c.street) || textOf(c.shippingAddress) || textOf(c.billingAddress);
    if (street === city) street = '';
    const state = (c.address && typeof c.address === 'object' ? textOf(c.address.state) : '')
        || textOf(c.state) || textOf(c.shippingState) || textOf(c.billingState);
    return { street, city, state };
};

/**
 * A customer record → a dropdown option. `description` (the city) is the
 * line under the name; `keywords` is what a search matches beyond the name,
 * so typing the contact's name or the city finds the account. The address
 * and rep ride along for forms that fill them in (Delivery).
 */
export const customerOption = (c: AnyCustomer = {}): CustomerOption => {
    const { street, city, state } = customerAddressParts(c);
    const label = customerLabel(c);
    const contact = real(c.contactName);
    return {
        value: c._id,
        label,
        description: city || undefined,
        keywords: [contact !== label ? contact : '', city, state].filter(Boolean).join(' '),
        city,
        address: street || city,
        fullAddress: [street, city, state].filter(Boolean).join(', ') || city || street,
        salesRepName: c.salesRepName || '',
        customerType: c.customerType || ''
    };
};

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Records → options: one per id, sorted A–Z by name (case-insensitive, 2 before 10). */
export const toCustomerOptions = (records: AnyCustomer[] | null = []): CustomerOption[] => {
    const seen = new Set<string>();
    const out: CustomerOption[] = [];
    for (const c of records || []) {
        if (!c || !c._id) continue;
        const id = String(c._id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(customerOption(c));
    }
    return out.sort((a, b) => collator.compare(a.label, b.label));
};

/** Whether an option matches what was typed: name, then the city/contact keywords. */
export const matchesOption = (option: Partial<CustomerOption> | null | undefined, query: unknown): boolean => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return `${option?.label || ''} ${option?.description || ''} ${option?.keywords || ''}`.toLowerCase().includes(q);
};
