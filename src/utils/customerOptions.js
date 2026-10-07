import { isFillerName } from './customerMatch.js';

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

const textOf = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val === '[object Object]' ? '' : val.trim();
    if (typeof val === 'object') {
        const inner = val.street || val.address || val.line1 || val.city || val.name || '';
        return typeof inner === 'string' ? (inner === '[object Object]' ? '' : inner.trim()) : String(inner || '').trim();
    }
    return String(val).trim();
};

const real = (value) => (isFillerName(value) ? '' : String(value).trim());

/** The name shown for a customer: company, else contact, else first + last. Filler like "N/A" is skipped. */
export const customerLabel = (c) => {
    if (!c) return 'Unknown';
    if (typeof c === 'string') return c.trim() || 'Unknown';
    return real(c.company)
        || real(c.contactName)
        || real(`${c.firstName || ''} ${c.lastName || ''}`)
        || 'Unknown';
};

/** City / street / state out of the several address shapes customers are stored in. */
export const customerAddressParts = (c = {}) => {
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
export const customerOption = (c = {}) => {
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
export const toCustomerOptions = (records = []) => {
    const seen = new Set();
    const out = [];
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
export const matchesOption = (option, query) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return `${option?.label || ''} ${option?.description || ''} ${option?.keywords || ''}`.toLowerCase().includes(q);
};
