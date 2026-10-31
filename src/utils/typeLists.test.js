import { describe, it, expect } from 'vitest';
import {
  validateTypeBody, reorderedIds, moveItem, activeTypes, normalizeVisitFields, visitFieldsOf, nameKey
} from './typeLists.js';

describe('validateTypeBody', () => {
  const others = [{ name: 'Quick Note', label: 'Quick note' }];

  it('needs a name and trims it', () => {
    expect(validateTypeBody('visit', { label: '   ' }).error).toBe('Enter a name.');
    expect(validateTypeBody('visit', { label: '  Site   walk ' }, others).value.label).toBe('Site walk');
  });

  it('refuses a name already used, whatever its case or spacing', () => {
    expect(validateTypeBody('visit', { label: 'quick  NOTE' }, others).error).toMatch(/already/);
    expect(validateTypeBody('visit', { label: 'Quick note' }, others).error).toMatch(/already/);
  });

  it('only returns what was sent', () => {
    expect(validateTypeBody('visit', { active: false }).value).toEqual({ active: false });
    expect(validateTypeBody('visit', {}).value).toEqual({});
  });

  it('a visit type takes fields, a resource type a family', () => {
    expect(validateTypeBody('visit', { fields: { followUp: 'none', notes: 0 } }).value.fields)
      .toEqual({ notes: false, outcome: true, followUp: 'none' });
    expect(validateTypeBody('visit', { family: 'tower' }).value).toEqual({});
    expect(validateTypeBody('resource', { family: 'tower' }).value.family).toBe('tower');
    expect(validateTypeBody('resource', { family: 'banana' }).error).toBe('Choose a family.');
  });

  it('refuses a name that is too long', () => {
    expect(validateTypeBody('visit', { label: 'x'.repeat(121) }).error).toMatch(/at most/);
  });
});

describe('reorderedIds', () => {
  it('needs every current id exactly once', () => {
    expect(reorderedIds(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    expect(reorderedIds(['a', 'b', 'c'], ['a', 'b'])).toBeNull();
    expect(reorderedIds(['a', 'b', 'c'], ['a', 'a', 'b'])).toBeNull();
    expect(reorderedIds(['a', 'b'], ['a', 'z'])).toBeNull();
    expect(reorderedIds(['a'], 'a')).toBeNull();
  });
});

describe('moveItem', () => {
  it('moves one item and leaves the original alone', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('activeTypes', () => {
  it('drops hidden types and sorts by order', () => {
    const types = [{ name: 'b', order: 2 }, { name: 'h', order: 0, active: false }, { name: 'a', order: 1 }];
    expect(activeTypes(types).map((t) => t.name)).toEqual(['a', 'b']);
  });
});

describe('visit fields', () => {
  it('a missing or odd value falls back to everything with an optional follow-up', () => {
    expect(visitFieldsOf(undefined)).toEqual({ notes: true, outcome: true, followUp: 'optional' });
    expect(normalizeVisitFields({ followUp: 'sometimes' }).followUp).toBe('optional');
  });
  it('nameKey ignores case and extra spaces', () => expect(nameKey('  A   b ')).toBe('a b'));
});
