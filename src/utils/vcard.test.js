import { describe, it, expect } from 'vitest';
import { escapeVCard, vcardDisplayName, vcardPersonFor, buildVCard, vcardFileName } from './vcard.js';

const seattleGranite = {
    _id: 'c1', company: 'Seattle Granite', contactName: 'Jarren Cheha', customerType: 'Fabricator', phone: '(206) 763-9600',
    email: 'jarren71@yahoo.com, info@seattlegranite.com', location: 'Seattle', salesRepName: 'Krish',
    address: { street: '4700 Ohio Ave S #D', city: 'Seattle', state: 'WA', zipCode: '98134' },
    contacts: [{ _id: 'k2', name: 'Stan', role: 'Manager', phone: '206-555-0100', email: 'stan@seattlegranite.com', notes: 'Mornings' }]
};

describe('the primary contact', () => {
    it('is named "Name @ Company - Type" in one field, with every real email and the work address', () => {
        const card = buildVCard(vcardPersonFor(seattleGranite, 'primary'));
        expect(card).toBe([
            'BEGIN:VCARD',
            'VERSION:3.0',
            'N:;Jarren Cheha @ Seattle Granite - Fabricator;;;',
            'FN:Jarren Cheha @ Seattle Granite - Fabricator',
            'TEL;TYPE=WORK,VOICE:(206) 763-9600',
            'EMAIL;TYPE=INTERNET,WORK:jarren71@yahoo.com',
            'EMAIL;TYPE=INTERNET,WORK:info@seattlegranite.com',
            'ADR;TYPE=WORK:;;4700 Ohio Ave S #D;Seattle;WA;98134;USA',
            'NOTE:Easy Stones customer · Seattle · Rep: Krish',
            'END:VCARD',
            ''
        ].join('\r\n'));
    });

    it('a customer with no person is "Company - Type"; no type set reads as Fabricator', () => {
        const card = buildVCard(vcardPersonFor({ company: 'Acme Stone', contactName: 'Acme Stone', phone: '1' }));
        expect(card).toContain('N:;Acme Stone - Fabricator;;;');
        expect(card).toContain('FN:Acme Stone - Fabricator');
        expect(card).not.toContain('ORG:');
    });

    it('escapes the comma in a company name like "Backcountry Counters, LLC"', () => {
        const card = buildVCard(vcardPersonFor({ company: 'Backcountry Counters, LLC', contactName: 'Kyle Sears', customerType: 'Fabricator' }));
        expect(card).toContain('N:;Kyle Sears @ Backcountry Counters\\, LLC - Fabricator;;;');
    });

    it('leaves placeholder emails out', () => {
        const p = vcardPersonFor({ company: 'A', email: 'sales_1_abc@temp-customer.com' });
        expect(p.emails).toEqual([]);
    });
});

describe('a saved contact', () => {
    it('uses their own phone and email, role as title, and keeps their notes', () => {
        const card = buildVCard(vcardPersonFor(seattleGranite, 'k2'));
        expect(card).toContain('FN:Stan @ Seattle Granite - Fabricator');
        expect(card).toContain('TITLE:Manager');
        expect(card).not.toContain('ORG:');
        expect(card).toContain('TEL;TYPE=WORK,VOICE:206-555-0100');
        expect(card).toContain('EMAIL;TYPE=INTERNET,WORK:stan@seattlegranite.com');
        expect(card).toContain('NOTE:Easy Stones customer · Seattle · Rep: Krish\\nMornings');
        expect(card).not.toContain('jarren71');
    });

    it('an unknown contact is nobody', () => {
        expect(vcardPersonFor(seattleGranite, 'nope')).toBeNull();
    });
});

describe('formatting', () => {
    it('escapes the characters vCard reserves', () => {
        expect(escapeVCard('A, B; C\\D\nE')).toBe('A\\, B\\; C\\\\D\\nE');
    });
    it('builds the display name from whatever parts there are', () => {
        expect(vcardDisplayName({ name: 'Kyle Sears', company: 'Backcountry Counters, LLC', type: 'Fabricator' })).toBe('Kyle Sears @ Backcountry Counters, LLC - Fabricator');
        expect(vcardDisplayName({ name: 'Kyle Sears', type: 'Fabricator' })).toBe('Kyle Sears - Fabricator');
        expect(vcardDisplayName({ name: 'Kyle Sears', company: 'Backcountry' })).toBe('Kyle Sears @ Backcountry');
        expect(vcardDisplayName({})).toBe('Customer');
    });
    it('folds long lines', () => {
        const card = buildVCard({ name: 'X', note: 'n'.repeat(200) });
        for (const line of card.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
        expect(card.replace(/\r\n /g, '')).toContain(`NOTE:${'n'.repeat(200)}`);
    });
    it('names the file after the display name', () => {
        expect(vcardFileName({ name: 'Jarren Cheha', company: 'Seattle Granite', type: 'Fabricator' })).toBe('Jarren Cheha @ Seattle Granite - Fabricator.vcf');
        expect(vcardFileName({ company: 'A/B: Stone' })).toBe('A B Stone.vcf');
        expect(vcardFileName({})).toBe('Contact.vcf');
    });
});
