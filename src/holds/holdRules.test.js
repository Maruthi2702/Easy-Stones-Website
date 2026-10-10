import { describe, it, expect } from 'vitest';
import {
  slabKeyOf, isHoldableSlab, sfHundredthsOf, slabSnapshot, lotGroups, lineTotalCents, holdTotals,
  todayIn, addDays, daysBetween, zonedMidnight, expiryMoments, holdState, daysToExpiry, defaultExpiresOn,
  expiryProblem, branchProblem, holdScopesFor, canSeeHold, scopeClause, GRACE_DAYS
} from './holdRules.js';
import { HOLDS } from './permissions.js';

const slab = (over = {}) => ({ type: 'SLAB', serialNumber: '14744-29', barcodeId: 'ES11626232', product: 'Taj Mahal 3CM', bundle: '007766AG/14744', instockQty: 64.46, ...over });

describe('slabs', () => {
  it('one key per slab, whatever the spacing or case', () => {
    expect(slabKeyOf(' 14744-29 ')).toBe('14744-29');
    expect(slabKeyOf('ab-1')).toBe('AB-1');
    expect(slabKeyOf(null)).toBe('');
  });
  it('only whole slabs still in stock can be held', () => {
    expect(isHoldableSlab(slab())).toBe(true);
    expect(isHoldableSlab(slab({ type: 'Sample' }))).toBe(false);
    expect(isHoldableSlab(slab({ type: 'A-Frame' }))).toBe(false);
    expect(isHoldableSlab(slab({ instockQty: 0 }))).toBe(false);
    expect(isHoldableSlab(slab({ serialNumber: '' }))).toBe(false);
  });
  it('keeps SF as whole hundredths and snapshots the slab', () => {
    expect(sfHundredthsOf(64.46)).toBe(6446);
    expect(sfHundredthsOf(0.1 + 0.2)).toBe(30);
    expect(slabSnapshot(slab())).toMatchObject({ slabKey: '14744-29', barcode: 'ES11626232', sfHundredths: 6446 });
  });
  it('groups by product and bundle, and spots mixed lots', () => {
    const groups = lotGroups([
      { product: 'Soapstone', bundle: '557607', sfHundredths: 7167 },
      { product: 'Soapstone', bundle: '557612', sfHundredths: 7167 },
      { product: 'Designer White', bundle: '14980', sfHundredths: 5510 }
    ]);
    expect(groups.map((g) => [g.product, g.slabs, g.mixedLots])).toEqual([['Soapstone', 2, true], ['Designer White', 1, false]]);
    expect(groups[0].sfHundredths).toBe(14334);
  });
});

describe('money', () => {
  it('line total = SF × price per SF, to the cent', () => {
    expect(lineTotalCents(6446, 2450)).toBe(157927); // 64.46 SF × $24.50 = $1,579.27
    expect(lineTotalCents(7167, 2200)).toBe(157674);
    expect(lineTotalCents(6446, null)).toBeNull();
  });
  it('a hold has a total only when every slab is priced', () => {
    const lines = [{ sfHundredths: 6446, priceCentsPerSf: 2450 }, { sfHundredths: 6446, priceCentsPerSf: 2600 }];
    expect(holdTotals(lines)).toMatchObject({ slabs: 2, sfHundredths: 12892, totalCents: 157927 + 167596, missingPrices: 0 });
    expect(holdTotals([...lines, { sfHundredths: 100, priceCentsPerSf: null }])).toMatchObject({ totalCents: null, missingPrices: 1, pricedCents: 325523 });
  });
});

describe('dates on the branch clock', () => {
  it('counts days', () => {
    expect(addDays('2026-10-09', 7)).toBe('2026-10-16');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-10-09', '2026-10-16')).toBe(7);
  });
  it('knows today on each branch’s own clock', () => {
    const lateNightSeattle = new Date('2026-10-10T05:30:00Z'); // Oct 9, 10:30 PM in Seattle; Oct 10 in Charlotte
    expect(todayIn('America/Los_Angeles', lateNightSeattle)).toBe('2026-10-09');
    expect(todayIn('America/New_York', lateNightSeattle)).toBe('2026-10-10');
  });
  it('finds midnight in a time zone, across daylight saving changes', () => {
    expect(zonedMidnight('2026-10-17', 'America/Los_Angeles').toISOString()).toBe('2026-10-17T07:00:00.000Z');
    expect(zonedMidnight('2026-11-02', 'America/Los_Angeles').toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(zonedMidnight('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });
  it('expires at the end of the expiry day, releases the slabs 7 days later', () => {
    const { expiresAt, releaseAt } = expiryMoments('2026-10-16', 'Seattle');
    expect(expiresAt.toISOString()).toBe('2026-10-17T07:00:00.000Z');
    expect(releaseAt.toISOString()).toBe('2026-10-24T07:00:00.000Z');
    expect(GRACE_DAYS).toBe(7);
  });
  it('active → expired (still holding) → released', () => {
    const hold = { status: 'active', branch: 'Seattle', expiresOn: '2026-10-16', ...expiryMoments('2026-10-16', 'Seattle') };
    expect(holdState(hold, new Date('2026-10-16T20:00:00Z'))).toBe('active');
    expect(holdState(hold, new Date('2026-10-17T08:00:00Z'))).toBe('expired');
    expect(holdState({ ...hold, status: 'released' })).toBe('released');
    expect(daysToExpiry(hold, new Date('2026-10-10T18:00:00Z'))).toBe(6);
  });
  it('defaults to 7 days, and longer needs the Extend permission', () => {
    const now = new Date('2026-10-09T18:00:00Z');
    expect(defaultExpiresOn('Seattle', now)).toBe('2026-10-16');
    expect(expiryProblem({ expiresOn: '2026-10-16', branch: 'Seattle', now })).toBeNull();
    expect(expiryProblem({ expiresOn: '2026-10-23', branch: 'Seattle', now })).toMatch(/Extend permission/);
    expect(expiryProblem({ expiresOn: '2026-10-23', branch: 'Seattle', now, canExtend: true })).toBeNull();
    expect(expiryProblem({ expiresOn: '2026-10-08', branch: 'Seattle', now, canExtend: true })).toMatch(/past/);
    expect(expiryProblem({ expiresOn: 'soon', branch: 'Seattle', now })).toMatch(/Pick the date/);
  });
});

describe('branches and who sees what', () => {
  const user = (permissions, assignedLocations = ['Seattle'], id = 'u1') => ({ id, permissions, assignedLocations });
  const hold = { branch: 'Seattle', createdBy: { id: 'u2' } };

  it('a hold belongs to one of our branches the person is assigned to', () => {
    expect(branchProblem('Seattle', ['Seattle'])).toBeNull();
    expect(branchProblem('Rocky Tops, LLC', ['*'])).toMatch(/Easy Stones branches/);
    expect(branchProblem('Dallas', ['Seattle'])).toMatch(/aren’t assigned/);
    expect(branchProblem('Dallas', ['*'])).toBeNull();
  });
  it('mine / branch / all follow the three view switches', () => {
    expect(holdScopesFor(user([HOLDS.VIEW_OWN]))).toEqual(['mine']);
    expect(holdScopesFor(user([HOLDS.VIEW_BRANCH]))).toEqual(['mine', 'branch']);
    expect(holdScopesFor(user([HOLDS.VIEW_ALL, HOLDS.VIEW_BRANCH]))).toEqual(['mine', 'branch', 'all']);
    expect(holdScopesFor(user([]))).toEqual([]);
  });
  it('sees a hold only through one of those switches', () => {
    expect(canSeeHold(user([HOLDS.VIEW_OWN]), hold)).toBe(false);
    expect(canSeeHold(user([HOLDS.VIEW_OWN], ['Seattle'], 'u2'), hold)).toBe(true);
    expect(canSeeHold(user([HOLDS.VIEW_BRANCH]), hold)).toBe(true);
    expect(canSeeHold(user([HOLDS.VIEW_BRANCH], ['Dallas']), hold)).toBe(false);
    expect(canSeeHold(user([HOLDS.VIEW_ALL], ['Dallas']), hold)).toBe(true);
  });
  it('turns a scope into a query, refusing what the person can’t use', () => {
    expect(scopeClause(user([HOLDS.VIEW_OWN]), 'mine')).toEqual({ 'createdBy.id': 'u1' });
    expect(scopeClause(user([HOLDS.VIEW_OWN]), 'branch')).toBeNull();
    expect(scopeClause(user([HOLDS.VIEW_BRANCH], ['Seattle', 'Spokane']), 'branch')).toEqual({ branch: { $in: ['Seattle', 'Spokane'] } });
    expect(scopeClause(user([HOLDS.VIEW_BRANCH]), 'branch', 'Dallas')).toBeNull();
    expect(scopeClause(user([HOLDS.VIEW_ALL]), 'all')).toEqual({});
  });
});
