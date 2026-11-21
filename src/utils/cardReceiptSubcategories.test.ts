import { describe, it, expect } from 'vitest';
import {
  cleanSubcategories, cleanCategory, cleanExpense, missingLine, changeSummary, exportRows, fieldsOf, defaultSubOf, shownSubs, subLabel,
  type CategoryLike
} from './cardReceipts.ts';

/** Types under a category (owner, 2026-11-20): Gas → Car / Truck / Van, Food → Travel Lunch / Customer Lunch / Office Team Lunch. */

const TODAY = '2026-11-05';
const base = { date: '2026-10-03', merchant: 'Chevron, Kent', total: '40.00', receiptUrl: 'https://res.cloudinary.com/x/r.webp' };
const PLAIN: CategoryLike[] = [{ name: 'parking', label: 'Parking' }];
const GAS: CategoryLike = {
  name: 'gas', label: 'Gas', subcategories: [
    { name: 'car', label: 'Car', isDefault: true }, { name: 'truck', label: 'Truck' }, { name: 'van', label: 'Van', active: false }
  ]
};
const FOOD: CategoryLike = {
  name: 'food', label: 'Food', subcategories: [
    { name: 'travel_lunch', label: 'Travel Lunch', isDefault: true },
    { name: 'customer_lunch', label: 'Customer Lunch', fields: { customer: true } },
    { name: 'office_team_lunch', label: 'Office Team Lunch' }
  ]
};
const gasBase = { ...base, category: 'gas' };

describe('cleanSubcategories', () => {
  it('gives a new type a stored name from its label, and the first shown one is the default', () => {
    const { value, problems } = cleanSubcategories([{ label: 'Car' }, { label: ' Truck ' }, { label: 'Van' }]);
    expect(problems).toEqual({});
    expect(value.map((s) => [s.name, s.label, s.isDefault])).toEqual([['car', 'Car', true], ['truck', 'Truck', false], ['van', 'Van', false]]);
  });

  it('keeps the stored name when a type is renamed, and never believes a name that wasn’t there', () => {
    const { value } = cleanSubcategories([{ name: 'truck', label: 'Big truck' }, { name: 'hacked', label: 'Boat' }], GAS.subcategories!);
    expect(value.map((s) => s.name)).toEqual(['truck', 'boat']);
    expect(value[0]!.label).toBe('Big truck');
  });

  it('refuses a blank or repeated name, and moves the default off a hidden type', () => {
    expect(cleanSubcategories([{ label: '' }]).problems.subcategories).toMatch(/needs a name/);
    expect(cleanSubcategories([{ label: 'Car' }, { label: 'car' }]).problems.subcategories).toMatch(/twice/);
    const { value } = cleanSubcategories([{ label: 'Car', isDefault: true, active: false }, { label: 'Truck' }]);
    expect(value.find((s) => s.isDefault)!.name).toBe('truck');
  });

  it('a category save without types leaves them as they are; an empty list clears them', () => {
    expect(cleanCategory({ label: 'Gas' }, [], undefined, GAS.subcategories!).value!.subcategories.map((s) => s.name)).toEqual(['car', 'truck', 'van']);
    expect(cleanCategory({ label: 'Gas', subcategories: [] }, [], undefined, GAS.subcategories!).value!.subcategories).toEqual([]);
  });
});

describe('types on a category', () => {
  it('offers the shown types and starts on the default', () => {
    expect(shownSubs(GAS).map((s) => s.name)).toEqual(['car', 'truck']);
    expect(defaultSubOf(GAS)!.name).toBe('car');
    expect(defaultSubOf({ name: 'x', label: 'X' })).toBeUndefined();
    expect(subLabel(GAS, 'truck')).toBe('Truck');
  });

  it('Customer Lunch asks for the customer only; its category and the other types do not', () => {
    expect(fieldsOf(FOOD, 'customer_lunch').customer).toBe(true);
    expect(fieldsOf(FOOD, 'travel_lunch').customer).toBe(false);
    expect(fieldsOf(FOOD).customer).toBe(false);
    // "Who attended" was taken out for now (owner, 2026-11-20).
    expect(fieldsOf(FOOD, 'customer_lunch').attendees).toBe(false);
  });
});

describe('an expense with a type', () => {
  it('needs the type picked before it can go to the approver', () => {
    const noType = cleanExpense({ ...gasBase }, { today: TODAY, categories: [GAS] });
    expect(noType.value!.subcategory).toBe('');
    expect(noType.missing.subcategory).toMatch(/type/);
    expect(missingLine(noType.missing)).toMatch(/pick the type/i);
    const withType = cleanExpense({ ...gasBase, subcategory: 'truck' }, { today: TODAY, categories: [GAS] });
    expect(withType.value!.subcategory).toBe('truck');
    expect(withType.missing).toEqual({});
  });

  it('refuses a type the category doesn’t have, and a hidden one unless the expense already has it', () => {
    expect(cleanExpense({ ...gasBase, subcategory: 'boat' }, { today: TODAY, categories: [GAS] }).problems.subcategory).toMatch(/no longer/);
    expect(cleanExpense({ ...gasBase, subcategory: 'van' }, { today: TODAY, categories: [GAS] }).problems.subcategory).toMatch(/no longer/);
    expect(cleanExpense({ ...gasBase, subcategory: 'van' }, { today: TODAY, categories: [GAS], currentSubcategory: 'van' }).value!.subcategory).toBe('van');
  });

  it('a category with no types ignores one', () => {
    expect(cleanExpense({ ...base, category: 'parking', subcategory: 'car' }, { today: TODAY, categories: PLAIN }).value!.subcategory).toBe('');
  });

  it('Customer Lunch needs the customer and drops who attended; Office Team Lunch needs nothing extra', () => {
    const lunch = cleanExpense({ ...base, category: 'food', subcategory: 'customer_lunch', attendees: ['A'] }, { today: TODAY, categories: [FOOD] });
    expect(lunch.missing.customer).toBeDefined();
    expect(lunch.value!.attendees).toEqual([]);
    const office = cleanExpense({ ...base, category: 'food', subcategory: 'office_team_lunch', customerId: 'c1' }, { today: TODAY, categories: [FOOD] });
    expect(office.value!.customerId).toBe('');
    expect(office.missing).toEqual({});
  });

  it('says when the type changed, and puts it in the Excel', () => {
    const before = cleanExpense({ ...gasBase, subcategory: 'car' }, { today: TODAY, categories: [GAS] }).value!;
    const after = cleanExpense({ ...gasBase, subcategory: 'truck' }, { today: TODAY, categories: [GAS] }).value!;
    expect(changeSummary(before, after)).toEqual(['type']);
    const [row] = exportRows([{ date: '2026-10-03', location: 'Seattle', holderName: 'A', cardLabel: 'A1', merchant: 'Chevron', cents: 5000, category: 'gas', subcategory: 'truck', status: 'approved' }], [GAS]);
    expect(row).toMatchObject({ Category: 'Gas', 'Sub-category': 'Truck' });
  });
});
