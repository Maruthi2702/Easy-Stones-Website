import { describe, it, expect } from 'vitest';
import { dashboardScope, scopeBranchPrefilter, scopeVisitUserMatch, narrowScopeToLocation } from './dashboardMatch.js';

const ALL = ['view_all_visits'];
const BRANCH = ['view_branch_visits'];

describe('dashboardScope', () => {
  it('shows everything with view_all_visits', () => {
    expect(dashboardScope({ permissions: ALL, userId: 'u1', assignedLocations: ['Seattle'] })).toEqual({ kind: 'all' });
  });

  it('limits view_branch_visits to the assigned branches', () => {
    expect(dashboardScope({ permissions: BRANCH, userId: 'u1', assignedLocations: ['Dallas'] }))
      .toEqual({ kind: 'branches', locations: ['Dallas'] });
    expect(dashboardScope({ permissions: BRANCH, assignedLocations: ['Seattle', 'Spokane', 'Salt Lake City'] }))
      .toEqual({ kind: 'branches', locations: ['Seattle', 'Spokane', 'Salt Lake City'] });
  });

  it("treats a '*' branch assignment as every branch", () => {
    expect(dashboardScope({ permissions: BRANCH, assignedLocations: ['*'] })).toEqual({ kind: 'all' });
  });

  it('gives view_branch_visits with no branches nothing rather than everything', () => {
    expect(dashboardScope({ permissions: BRANCH, assignedLocations: [] })).toEqual({ kind: 'branches', locations: [] });
    expect(dashboardScope({ permissions: BRANCH })).toEqual({ kind: 'branches', locations: [] });
  });

  it('limits anyone without a visit permission to what they logged, whatever their role', () => {
    expect(dashboardScope({ permissions: ['view_dashboard'], userId: 'u7', assignedLocations: ['*'] })).toEqual({ kind: 'own', userId: 'u7' });
    expect(dashboardScope({ role: 'admin', userId: 'u8' })).toEqual({ kind: 'own', userId: 'u8' });
  });
});

describe('scope match pieces', () => {
  it('prefilters customers by branch only for a branch-limited manager', () => {
    expect(scopeBranchPrefilter({ kind: 'branches', locations: ['Dallas'] })).toEqual({ $match: { location: { $in: ['Dallas'] } } });
    expect(scopeBranchPrefilter({ kind: 'all' })).toBeNull();
    expect(scopeBranchPrefilter({ kind: 'own', userId: 'u7' })).toBeNull();
  });

  it('matches the logger only for own-visits scope', () => {
    expect(scopeVisitUserMatch({ kind: 'own', userId: 'u7' })).toEqual({ 'visits.createdBy': 'u7' });
    expect(scopeVisitUserMatch({ kind: 'all' })).toEqual({});
    expect(scopeVisitUserMatch({ kind: 'branches', locations: ['Dallas'] })).toEqual({});
  });
});

describe('narrowScopeToLocation', () => {
  it('narrows an all-branches scope to the picked branch', () => {
    expect(narrowScopeToLocation({ kind: 'all' }, 'Dallas')).toEqual({ kind: 'branches', locations: ['Dallas'] });
  });

  it("lets a manager pick only one of their own branches", () => {
    const mgr = { kind: 'branches', locations: ['Seattle', 'Spokane'] };
    expect(narrowScopeToLocation(mgr, 'Spokane')).toEqual({ kind: 'branches', locations: ['Spokane'] });
    expect(narrowScopeToLocation(mgr, 'Dallas')).toEqual({ kind: 'branches', locations: [] });
  });

  it('leaves the scope alone with no pick, "*", or an own-visits scope', () => {
    expect(narrowScopeToLocation({ kind: 'all' }, '')).toEqual({ kind: 'all' });
    expect(narrowScopeToLocation({ kind: 'all' }, undefined)).toEqual({ kind: 'all' });
    expect(narrowScopeToLocation({ kind: 'all' }, '*')).toEqual({ kind: 'all' });
    expect(narrowScopeToLocation({ kind: 'own', userId: 'u7' }, 'Dallas')).toEqual({ kind: 'own', userId: 'u7' });
  });
});
