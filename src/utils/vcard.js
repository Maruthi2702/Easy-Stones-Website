/**
 * A customer's contact as a vCard (.vcf), for "Save to phone contacts" — so a
 * rep doesn't type the same person into the app and then again into their
 * phone (2026-10-06).
 *
 * GET /api/customers/:id/vcard?contact=<key> serves it. Opened on an iPhone
 * it shows the contact card with Create New Contact / Add to Existing; Android
 * downloads it and the Contacts app imports it; a laptop downloads it for
 * Outlook / Contacts. Nothing is written to a phone without the person
 * confirming — a website can't.
 *
 * Pure (no DB, no DOM), so the server and the tests share it.
 */
import { companyOf, contactOf, realEmailsOf, cityOf, streetOf, locationOf } from './customerList.js';

const clean = (v) => String(v ?? '').trim();

/** vCard 3.0 text escaping: backslash, comma, semicolon and newlines. */
export const escapeVCard = (value) => clean(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

/** Lines longer than 75 characters are folded with a leading space (RFC 6350 §3.2). */
const fold = (line) => {
    if (line.length <= 75) return line;
    const parts = [line.slice(0, 75)];
    for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
    return parts.join('\r\n');
};

/**
 * What the phone shows as the contact's name: "Kyle Sears @ Backcountry
 * Counters, LLC - Fabricator" (2026-10-08), so a rep searching their phone
 * sees who, where and what kind of customer at once. A missing part is left
 * out: "Backcountry Counters, LLC - Fabricator" when there's no person.
 */
export const vcardDisplayName = (person = {}) => {
    const name = clean(person.name);
    const company = clean(person.company);
    const head = name && company ? `${name} @ ${company}` : (name || company);
    const type = clean(person.type);
    return (head && type ? `${head} - ${type}` : head) || 'Customer';
};

/**
 * The person behind `key` on a customer: 'primary' (the account's own contact
 * name, phone and every real email) or a saved contact's _id. null when the
 * key matches nobody.
 */
export const vcardPersonFor = (customer = {}, key = 'primary') => {
    const company = companyOf(customer);
    // The same default the app shows (TypeTag): no type set reads as Fabricator.
    const type = clean(customer.customerType) || 'Fabricator';
    const address = {
        street: streetOf(customer),
        city: cityOf(customer),
        state: clean(customer.address?.state),
        zip: clean(customer.address?.zipCode)
    };
    const note = ['Easy Stones customer', locationOf(customer), customer.salesRepName ? `Rep: ${clean(customer.salesRepName)}` : '']
        .filter(Boolean).join(' · ');
    if (!key || key === 'primary') {
        return {
            name: contactOf(customer),
            company,
            type,
            title: '',
            phones: [clean(customer.phone)].filter(Boolean),
            emails: realEmailsOf(customer),
            address,
            note
        };
    }
    const ct = (customer.contacts || []).find((c) => String(c?._id) === String(key));
    if (!ct) return null;
    return {
        name: clean(ct.name),
        company,
        type,
        title: clean(ct.role),
        phones: [clean(ct.phone)].filter(Boolean),
        emails: [clean(ct.email)].filter(Boolean),
        address,
        note: [note, clean(ct.notes)].filter(Boolean).join('\n')
    };
};

/**
 * The .vcf text for a person from vcardPersonFor. CRLF line endings, as phones
 * expect. The whole vcardDisplayName goes in the first-name field, with last
 * name and company left empty — the rep edits it on the phone if they want it
 * split up.
 */
export const buildVCard = (person = {}) => {
    const display = escapeVCard(vcardDisplayName(person));
    const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:;${display};;;`,
        `FN:${display}`
    ];
    if (clean(person.title)) lines.push(`TITLE:${escapeVCard(person.title)}`);
    for (const phone of person.phones || []) if (clean(phone)) lines.push(`TEL;TYPE=WORK,VOICE:${escapeVCard(phone)}`);
    for (const email of person.emails || []) if (clean(email)) lines.push(`EMAIL;TYPE=INTERNET,WORK:${escapeVCard(email)}`);
    const a = person.address || {};
    if (clean(a.street) || clean(a.city) || clean(a.state) || clean(a.zip)) {
        lines.push(`ADR;TYPE=WORK:;;${escapeVCard(a.street)};${escapeVCard(a.city)};${escapeVCard(a.state)};${escapeVCard(a.zip)};USA`);
    }
    if (clean(person.note)) lines.push(`NOTE:${escapeVCard(person.note)}`);
    lines.push('END:VCARD');
    return `${lines.map(fold).join('\r\n')}\r\n`;
};

/** "Jarren Cheha @ Seattle Granite - Fabricator.vcf", safe for a download name. */
export const vcardFileName = (person = {}) => {
    const base = clean(person.name) || clean(person.company) ? vcardDisplayName(person) : 'Contact';
    return `${base.replace(/[^\w .&'@-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Contact'}.vcf`;
};
