import { describe, it, expect } from 'vitest';
import { escapeVCard, splitName, vcardPersonFor, buildVCard, vcardFileName } from './vcard.js';

const seattleGranite = {
    _id: 'c1', company: 'Seattle Granite', contactName: 'Jarren Cheha', phone: '(206) 763-9600',
    email: 'jarren71@yahoo.com, info@seattlegranite.com', location: 'Seattle', salesRepName: 'Krish',
    address: { street: '4700 Ohio Ave S #D', city: 'Seattle', state: 'WA', zipCode: '98134' },
    contacts: [{ _id: 'k2', name: 'Stan', role: 'Manager', phone: '206-555-0100', email: 'stan@seattlegranite.com', notes: 'Mornings' }]
};

describe('the primary contact', () => {
    it('has the name, company, every real email and the work address', () => {
        const card = buildVCard(vcardPersonFor(seattleGranite, 'primary'));
        expect(card).toBe([
            'BEGIN:VCARD',
            'VERSION:3.0',
            'N:Cheha;Jarren;;;',
            'FN:Jarren Cheha',
            'ORG:Seattle Granite',
            'TEL;TYPE=WORK,VOICE:(206) 763-9600',
            'EMAIL;TYPE=INTERNET,WORK:jarren71@yahoo.com',
            'EMAIL;TYPE=INTERNET,WORK:info@seattlegranite.com',
            'ADR;TYPE=WORK:;;4700 Ohio Ave S #D;Seattle;WA;98134;USA',
            'NOTE:Easy Stones customer · Seattle · Rep: Krish',
            'END:VCARD',
            ''
        ].join('\r\n'));
    });

    it('a customer with no person is saved as a company card', () => {
        const card = buildVCard(vcardPersonFor({ company: 'Acme Stone', contactName: 'Acme Stone', phone: '1' }));
        expect(card).toContain('FN:Acme Stone');
        expect(card).toContain('X-ABShowAs:COMPANY');
        expect(card).toContain('N:;;;;');
    });

    it('leaves placeholder emails out', () => {
        const p = vcardPersonFor({ company: 'A', email: 'sales_1_abc@temp-customer.com' });
        expect(p.emails).toEqual([]);
    });
});

describe('a saved contact', () => {
    it('uses their own phone and email, role as title, and keeps their notes', () => {
        const card = buildVCard(vcardPersonFor(seattleGranite, 'k2'));
        expect(card).toContain('FN:Stan');
        expect(card).toContain('TITLE:Manager');
        expect(card).toContain('ORG:Seattle Granite');
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
    it('splits names', () => {
        expect(splitName('Mary Ann Lee')).toEqual({ first: 'Mary Ann', last: 'Lee' });
        expect(splitName('Stan')).toEqual({ first: 'Stan', last: '' });
    });
    it('folds long lines', () => {
        const card = buildVCard({ name: 'X', note: 'n'.repeat(200) });
        for (const line of card.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
        expect(card.replace(/\r\n /g, '')).toContain(`NOTE:${'n'.repeat(200)}`);
    });
    it('names the file after the person and company', () => {
        expect(vcardFileName({ name: 'Jarren Cheha', company: 'Seattle Granite' })).toBe('Jarren Cheha - Seattle Granite.vcf');
        expect(vcardFileName({ company: 'A/B: Stone' })).toBe('A B Stone.vcf');
        expect(vcardFileName({})).toBe('Contact.vcf');
    });
});
