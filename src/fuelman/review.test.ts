import { describe, it, expect } from 'vitest';
import { fixtureReport } from './testing/fixtures';
import { buildReview, splitCents } from './review';
import type { Assignment } from './types';
const mapping = (over: Partial<Assignment> = {}): Assignment => ({ id: '1', externalId: 'A', driverKey: 'driver1', driverName: 'Driver Alpha', from: '2026-07-01', to: '', allocations: [{ location: 'Seattle', basisPoints: 10000 }], ...over });
describe('backend expense allocation and roster review', () => {
  it('blocks unmatched identities, then reconciles driver and location expenses without supplier or frontend math', () => {
    const source = fixtureReport(); expect(buildReview(source, [], [], [], '1').ready).toBe(false);
    const review = buildReview(source, [mapping()], [], [], '1'); expect(review.ready).toBe(true);
    expect(review.locations[0]!.totalCents).toBe(5250); expect(review.facts.reduce((s, f) => s + f.amountCents, 0)).toBe(5250);
  });
  it('allocates signed cents exactly, with deterministic rounding and no lost credits', () => {
    const shares = [{ location: 'Seattle', basisPoints: 3333 }, { location: 'Spokane', basisPoints: 3333 }, { location: 'Atlanta', basisPoints: 3334 }];
    expect(splitCents(100, shares)).toEqual([33, 33, 34]); expect(splitCents(-100, shares)).toEqual([-33, -33, -34]);
    expect(() => splitCents(100, [{ location: 'Seattle', basisPoints: 5000 }])).toThrow(/100%/);
  });
  it('reconciles assigned and unassigned costs, including zero-net missing expenses', () => {
    const source = fixtureReport(), missing = buildReview(source, [], [], [], '1');
    expect(missing.unassigned.totalCents).toBe(5250); expect(missing.unassigned.amounts.adjustment).toBe(-100);
    source.lines[0]!.date = '2026-07-20';
    const partial = buildReview(source, [mapping({ from: '2026-07-15' })], [], [], '1');
    expect(partial.unassigned).toMatchObject({ totalCents: 1050, lineCount: 4, driverCount: 1 });
    expect(partial.allocatedCents + partial.unassigned.totalCents).toBe(source.totalCents);
    const zero = fixtureReport(); zero.lines = [zero.lines[0]!, { ...zero.lines[0]!, index: 1, amountCents: -4200 }]; zero.totalCents = 0;
    const review = buildReview(zero, [], [], [], '1'); expect(review.unassigned.totalCents).toBe(0); expect(review.unassigned.lineCount).toBe(2); expect(review.ready).toBe(false);
  });
  it('uses the transaction-date assignment across a mid-month transfer', () => {
    const source = fixtureReport(); source.lines[0]!.date = '2026-07-20';
    const review = buildReview(source, [mapping({ to: '2026-07-15' }), mapping({ id: '2', from: '2026-07-15', allocations: [{ location: 'Spokane', basisPoints: 10000 }] })], [], [], '1');
    expect(review.locations.find(l => l.location === 'Spokane')!.totalCents).toBe(4200);
    expect(review.locations.find(l => l.location === 'Seattle')!.totalCents).toBe(1050);
  });
  it('requires missing reasons for the correct period and never copies prior expense', () => {
    const source = fixtureReport('2026-08', ['B']);
    const pending = buildReview(source, [mapping(), mapping({ id: '2', externalId: 'B' })], [], [], '1');
    expect(pending.missing[0]!.resolved).toBe(false);
    const resolved = buildReview(source, [mapping(), mapping({ id: '2', externalId: 'B' })], [{ externalId: 'A', reason: 'no_activity', note: 'No purchases in August' }], [], '1');
    expect(resolved.ready).toBe(true); expect(resolved.totalCents).toBe(5250);
    expect(buildReview(fixtureReport('2026-09', ['B']), [mapping(), mapping({ id: '2', externalId: 'B' })], [], [], '1').missing[0]!.resolved).toBe(false);
  });
  it('does not expect future or retired identities in a historical report', () => {
    const review = buildReview(fixtureReport(), [mapping(), mapping({ id: '2', externalId: 'future', from: '2026-09-01' }), mapping({ id: '3', externalId: 'retired', from: '2026-01-01', to: '2026-07-01' })], [], [], '1');
    expect(review.missing).toEqual([]); expect(review.ready).toBe(true);
  });
  it('keeps incomplete/investigating dispositions blocked and unknown categories out of approvals', () => {
    const source = fixtureReport('2026-08', ['B']);
    const review = buildReview(source, [mapping()], [{ externalId: 'A', reason: 'incomplete', note: 'Missing report pages' }], [], '1');
    expect(review.ready).toBe(false);
    const unknown = fixtureReport(); unknown.lines[0]!.category = 'other';
    expect(buildReview(unknown, [mapping()], [], [], '1').ready).toBe(false);
    expect(buildReview(unknown, [mapping()], [], [{ index: 0, category: 'fuel', note: 'Verified fuel code' }], '1').ready).toBe(true);
  });
});
