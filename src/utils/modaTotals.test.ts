import { describe, it, expect } from 'vitest';
import {
    familyLookup, resourceCounts, earlierCount, modaFields, typedModaFields, modaSummary, modaChange, storedBinderCount
} from './modaTotals.ts';

const familyOf = familyLookup([
    { name: '2025V3 Moda Tower', family: 'tower' },
    { name: 'Moda Tabletop', family: 'tabletop' },
    { name: 'Binder NW', family: 'binder' },
    { name: 'Binder South', family: 'binder' },
    { name: 'Misc Samples', family: 'samples' }
]);
const tower = (over = {}) => ({ _id: 't1', resourceType: '2025V3 Moda Tower', qty: 1, status: 'Active', date: '2026-10-30', ...over });
const binder = (qty: number, over = {}) => ({ _id: `b${qty}`, resourceType: 'Binder NW', qty, status: 'Active', date: '2026-11-01', ...over });

describe('resourceCounts', () => {
    it('counts Active towers and binders by family, and nothing else', () => {
        expect(resourceCounts([
            tower(), binder(3), binder(2, { resourceType: 'Binder South' }),
            { resourceType: 'Moda Tabletop', qty: 1 }, { resourceType: 'Misc Samples', qty: 5 }, { resourceType: 'Unknown', qty: 4 }
        ], familyOf)).toEqual({ towers: 1, binders: 5 });
    });
    it('leaves out Inactive and Archived, and reads a missing status as Active and a missing qty as 1', () => {
        expect(resourceCounts([binder(3, { status: 'Inactive' }), binder(4, { status: 'Archived' }), { title: 'Binder NW' }], familyOf))
            .toEqual({ towers: 0, binders: 1 });
    });
});

describe('earlierCount (customers saved before the rule)', () => {
    it('keeps a typed total that the resources do not account for', () => {
        expect(earlierCount({ modaDisplay: 'Yes', modaBinder: '6' }, [binder(2)], familyOf)).toEqual({ display: true, binders: 4 });
    });
    it('never goes below zero when resources hold more than was typed', () => {
        expect(earlierCount({ modaDisplay: 'No', modaBinder: '0' }, [binder(3), tower()], familyOf)).toEqual({ display: false, binders: 0 });
    });
    it('reads a typed Yes as a tower already counted when one is logged', () => {
        expect(earlierCount({ modaDisplay: 'Yes', modaBinder: '' }, [tower()], familyOf)).toEqual({ display: false, binders: 0 });
    });
    it('uses the stored earlier count once there is one', () => {
        expect(earlierCount({ modaDisplay: 'No', modaBinder: '99', modaEarlier: { display: true, binders: 2 } }, [], familyOf))
            .toEqual({ display: true, binders: 2 });
    });
    it('reads junk binder text as 0', () => {
        expect(storedBinderCount('abc')).toBe(0);
        expect(storedBinderCount('-3')).toBe(0);
        expect(storedBinderCount(' 7 ')).toBe(7);
    });
});

describe('modaFields', () => {
    it('adds binders to the earlier count and turns Display on for a tower', () => {
        expect(modaFields({ display: false, binders: 6 }, [binder(3), tower()], familyOf))
            .toEqual({ modaDisplay: 'Yes', modaBinder: '9', modaEarlier: { display: false, binders: 6 } });
    });
    it('turns Display off when the last tower is archived, unless one was counted earlier', () => {
        expect(modaFields({ display: false, binders: 0 }, [tower({ status: 'Archived' })], familyOf).modaDisplay).toBe('No');
        expect(modaFields({ display: true, binders: 0 }, [tower({ status: 'Archived' })], familyOf).modaDisplay).toBe('Yes');
    });
    it('the switch never lowers a count', () => {
        const cases = [
            { c: { modaDisplay: 'Yes', modaBinder: '6' }, r: [binder(2)] },
            { c: { modaDisplay: 'No', modaBinder: '0' }, r: [binder(3), tower()] },
            { c: { modaDisplay: 'Yes', modaBinder: '1' }, r: [] }
        ];
        for (const { c, r } of cases) {
            const f = modaFields(earlierCount(c, r, familyOf), r, familyOf);
            expect(Number(f.modaBinder)).toBeGreaterThanOrEqual(storedBinderCount(c.modaBinder));
            if (c.modaDisplay === 'Yes') expect(f.modaDisplay).toBe('Yes');
        }
    });
});

describe('typedModaFields (Edit customer)', () => {
    const c = { modaDisplay: 'No', modaBinder: '5', modaEarlier: { display: false, binders: 2 } };
    const resources = [binder(3)];
    it('leaves the counts alone when the values are unchanged', () => {
        expect(typedModaFields(c, { modaDisplay: 'No', modaBinder: '5' }, resources, familyOf)).toEqual({ fields: null });
    });
    it('a typed total sets the earlier count so it adds up', () => {
        expect(typedModaFields(c, { modaBinder: '8' }, resources, familyOf))
            .toEqual({ fields: { modaDisplay: 'No', modaBinder: '8', modaEarlier: { display: false, binders: 5 } } });
    });
    it('refuses a total below what the Active resources hold', () => {
        const result = typedModaFields(c, { modaBinder: '2' }, resources, familyOf);
        expect(result).toEqual({ error: expect.stringContaining('3 binders are logged') });
    });
    it('refuses Display No while a tower is Active, and allows Yes with none', () => {
        expect(typedModaFields({ modaDisplay: 'Yes', modaBinder: '0' }, { modaDisplay: 'No' }, [tower()], familyOf))
            .toEqual({ error: expect.stringContaining('Display tower') });
        expect(typedModaFields(c, { modaDisplay: 'Yes' }, resources, familyOf))
            .toEqual({ fields: { modaDisplay: 'Yes', modaBinder: '5', modaEarlier: { display: true, binders: 2 } } });
    });
    it('refuses binder text that is not a whole number, and reads blank as 0', () => {
        expect(typedModaFields(c, { modaBinder: '3.5' }, [], familyOf)).toEqual({ error: 'Moda binders must be a whole number.' });
        expect(typedModaFields(c, { modaBinder: '' }, [], familyOf))
            .toEqual({ fields: { modaDisplay: 'No', modaBinder: '0', modaEarlier: { display: false, binders: 0 } } });
    });
});

describe('modaSummary and modaChange (the profile and the form)', () => {
    const customer = { modaDisplay: 'No', modaBinder: '6' };
    const summary = modaSummary(customer, [binder(2, { date: '2026-10-01' }), tower({ status: 'Archived', date: '2026-10-20' }), { resourceType: 'Misc Samples' }], familyOf);
    it('lists tower and binder resources newest first, with the totals and earlier count', () => {
        expect(summary).toMatchObject({ display: false, binders: 6, earlier: { display: false, binders: 4 } });
        expect(summary.items.map((i) => [i.kind, i.status])).toEqual([['display', 'Archived'], ['binders', 'Active']]);
    });
    it('adding binders shows the new total', () => {
        expect(modaChange(summary, { resourceType: 'Binder South', qty: 3, status: 'Active' }, null, familyOf))
            .toEqual({ display: { from: false, to: false }, binders: { from: 6, to: 9 } });
    });
    it('adding a tower turns Display on', () => {
        expect(modaChange(summary, { resourceType: '2025V3 Moda Tower', qty: 1, status: 'Active' }, null, familyOf))
            .toEqual({ display: { from: false, to: true }, binders: { from: 6, to: 6 } });
    });
    it('editing a binder Qty counts only the difference, and nothing changing is null', () => {
        const id = summary.items.find((i) => i.kind === 'binders')!._id;
        expect(modaChange(summary, { resourceType: 'Binder NW', qty: 1, status: 'Active' }, id, familyOf)!.binders).toEqual({ from: 6, to: 5 });
        expect(modaChange(summary, { resourceType: 'Binder NW', qty: 2, status: 'Active' }, id, familyOf)).toBeNull();
        expect(modaChange(summary, { resourceType: 'Misc Samples', qty: 4, status: 'Active' }, null, familyOf)).toBeNull();
    });
});
