import { describe, it, expect } from 'vitest';
import { fieldName, n, placeOf, resultLabel, resultTone, reviewTabs, firstReviewTab, draftStep, blockedFor, planCsvText } from './spsImport';
import { FIELD_LABELS, csvCell, UNASSIGNED, DEFAULT_BRANCH } from './importFields';

describe('SPS import window rules', () => {
  it('names fields, splitting an unknown one at its capitals', () => {
    expect(fieldName('zipCode')).toBe('Zip');
    expect(fieldName('accountAlert')).toBe('Account alert');
    expect(fieldName('billingTerms')).toBe('billing terms');
    expect(Object.keys(FIELD_LABELS)).toHaveLength(21);
  });
  it('counts a missing number as 0', () => {
    expect(n(undefined)).toBe('0');
    expect(n(1234)).toBe((1234).toLocaleString());
  });
  it('builds "City, ST ZIP" from the parts that exist', () => {
    expect(placeOf('Seattle', 'WA', '98101')).toBe('Seattle, WA 98101');
    expect(placeOf('Seattle', '', '')).toBe('Seattle');
    expect(placeOf('', 'WA', '98101')).toBe('WA 98101');
    expect(placeOf()).toBe('');
  });
  it('labels and colours a run’s customers', () => {
    expect(resultLabel({ result: 'updated', connect: true })).toBe('Connected');
    expect(resultLabel({ result: 'updated' })).toBe('Updated');
    expect(resultLabel({ result: 'odd' })).toBe('odd');
    expect([resultTone('added'), resultTone('restored'), resultTone('failed'), resultTone('unchanged')]).toEqual(['new', 'upd', 'bad', '']);
  });
  it('shows a tab only when it has rows, except Need a decision and New', () => {
    const tabs = reviewTabs({ decision: 0, deleted: 0, new: 0, update: 1, restore: 2, keptDeleted: 0, unchanged: 5 });
    expect(tabs.map(([k]) => k)).toEqual(['decision', 'new', 'update', 'unchanged']);
    expect(tabs[2][2]).toBe(3);
  });
  it('opens the review on a decision, then the deleted, else New', () => {
    expect(firstReviewTab({ decision: 1, deleted: 1 })).toBe('decision');
    expect(firstReviewTab({ deleted: 1 })).toBe('deleted');
    expect(firstReviewTab({})).toBe('new');
  });
  it('continues a draft at the names while any are unanswered', () => {
    expect(draftStep({ blockers: ['x'], unresolvedReps: [{}], unresolvedBranches: [] })).toBe(2);
    expect(draftStep({ blockers: ['x'], unresolvedReps: [], unresolvedBranches: [] })).toBe(3);
    expect(draftStep({ blockers: [], unresolvedReps: [{}], unresolvedBranches: [] })).toBe(3);
  });
  it('says which switch a plan needs', () => {
    expect(blockedFor({ needs: { edit: true } }, false, true)).toMatch(/Edit customer/);
    expect(blockedFor({ needs: { add: true } }, true, false)).toMatch(/Add customer/);
    expect(blockedFor({ needs: { edit: true, add: true } }, true, true)).toBe('');
    expect(blockedFor(null, false, false)).toBe('');
  });
  it('writes the plan as a CSV with a BOM, in plan order', () => {
    const csv = planCsvText({ update: [{ rowNumber: 3, name: 'B "Co"' }], new: [{ rowNumber: 2, name: 'A' }] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual(['"Row","SPS customer","Plan"', '"2","A","New"', '"3","B ""Co""","Update"']);
  });
  it('quotes CSV cells and keeps the server’s sentinel answers', () => {
    expect(csvCell(null)).toBe('""');
    expect([UNASSIGNED, DEFAULT_BRANCH]).toEqual(['__none__', '__default__']);
  });
});
