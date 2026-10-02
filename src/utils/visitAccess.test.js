import { describe, it, expect } from 'vitest';
import { canAddVisit, canModifyVisit, canDeleteVisit, visitViewScope, VISIT_PERMISSIONS as P } from './visitAccess.js';

const visit = { _id: 'v1', createdBy: 'rep1' };

describe('canModifyVisit', () => {
  it('lets edit_all_visits change any visit, whatever the role is called', () => {
    expect(canModifyVisit({ id: 'a', role: 'admin', permissions: [P.EDIT_ALL] }, visit, 'Dallas')).toBe(true);
    expect(canModifyVisit({ id: 'x', role: 'sales_rep', permissions: [P.EDIT_ALL] }, visit, 'Seattle')).toBe(true);
  });

  it('gives an admin role nothing extra without the permission', () => {
    expect(canModifyVisit({ id: 'a', role: 'admin', permissions: [] }, visit, 'Dallas')).toBe(false);
    expect(canModifyVisit({ id: 'a', role: 'director' }, visit, 'Dallas')).toBe(false);
  });

  it('lets whoever logged a visit change it with edit_own_visits', () => {
    expect(canModifyVisit({ id: 'rep1', permissions: [P.EDIT_OWN] }, visit, 'Seattle')).toBe(true);
    expect(canModifyVisit({ _id: 'rep1', permissions: [P.EDIT_OWN] }, visit, 'Seattle')).toBe(true);
  });

  it('does not let someone edit even their own visit without edit_own_visits', () => {
    expect(canModifyVisit({ id: 'rep1', permissions: [] }, visit, 'Seattle')).toBe(false);
    expect(canModifyVisit({ id: 'rep1', permissions: ['manage_customers', P.DELETE_OWN] }, visit, 'Seattle')).toBe(false);
  });

  it("does not let edit_own_visits reach someone else's visit", () => {
    expect(canModifyVisit({ id: 'rep2', permissions: [P.EDIT_OWN] }, visit, 'Seattle')).toBe(false);
  });

  it("stops someone without edit permissions changing another person's visit", () => {
    expect(canModifyVisit({ id: 'rep2', permissions: ['manage_customers'] }, visit, 'Seattle')).toBe(false);
    expect(canModifyVisit({ id: 'rep2', permissions: [] }, { _id: 'v2' }, 'Seattle')).toBe(false);
  });

  it("limits edit_branch_visits to their branches' customers", () => {
    const mgr = { id: 'm', permissions: [P.EDIT_BRANCH], assignedLocations: ['Seattle', 'Spokane'] };
    expect(canModifyVisit(mgr, visit, 'Seattle')).toBe(true);
    expect(canModifyVisit(mgr, visit, 'Dallas')).toBe(false);
    expect(canModifyVisit(mgr, visit, '')).toBe(false);
    expect(canModifyVisit({ ...mgr, assignedLocations: ['*'] }, visit, 'Dallas')).toBe(true);
    expect(canModifyVisit({ ...mgr, assignedLocations: undefined }, visit, 'Seattle')).toBe(false);
  });

  it('does not let branch assignments alone grant editing', () => {
    expect(canModifyVisit({ id: 'm', permissions: [], assignedLocations: ['*'] }, visit, 'Seattle')).toBe(false);
  });

  it('denies when there is no user or visit', () => {
    expect(canModifyVisit(null, visit, 'Seattle')).toBe(false);
    expect(canModifyVisit({ id: 'a', permissions: [P.EDIT_ALL] }, null, 'Seattle')).toBe(false);
  });
});

describe('canDeleteVisit', () => {
  it('lets delete_all_visits delete any visit', () => {
    expect(canDeleteVisit({ id: 'x', permissions: [P.DELETE_ALL] }, visit, 'Dallas')).toBe(true);
  });

  it('keeps edit and delete separate', () => {
    expect(canDeleteVisit({ id: 'x', permissions: [P.EDIT_ALL] }, visit, 'Dallas')).toBe(false);
    expect(canModifyVisit({ id: 'x', permissions: [P.DELETE_ALL] }, visit, 'Dallas')).toBe(false);
    const mgr = { id: 'm', permissions: [P.EDIT_BRANCH], assignedLocations: ['Seattle'] };
    expect(canDeleteVisit(mgr, visit, 'Seattle')).toBe(false);
  });

  it("limits delete_branch_visits to their branches' customers", () => {
    const mgr = { id: 'm', permissions: [P.DELETE_BRANCH], assignedLocations: ['Seattle'] };
    expect(canDeleteVisit(mgr, visit, 'Seattle')).toBe(true);
    expect(canDeleteVisit(mgr, visit, 'Dallas')).toBe(false);
    expect(canDeleteVisit({ ...mgr, assignedLocations: ['*'] }, visit, 'Dallas')).toBe(true);
  });

  it('lets whoever logged a visit delete it only with delete_own_visits', () => {
    expect(canDeleteVisit({ id: 'rep1', permissions: [P.DELETE_OWN] }, visit, 'Seattle')).toBe(true);
    expect(canDeleteVisit({ id: 'rep1', permissions: [P.EDIT_OWN] }, visit, 'Seattle')).toBe(false);
    expect(canDeleteVisit({ id: 'rep2', permissions: [P.DELETE_OWN] }, visit, 'Seattle')).toBe(false);
    expect(canDeleteVisit(null, visit, 'Seattle')).toBe(false);
  });
});

describe('canAddVisit', () => {
  it('follows add_visits alone', () => {
    expect(canAddVisit({ permissions: [P.ADD] })).toBe(true);
    expect(canAddVisit({ role: 'admin', permissions: ['manage_customers', P.EDIT_ALL] })).toBe(false);
    expect(canAddVisit(null)).toBe(false);
  });
});

describe('visitViewScope', () => {
  it('shows everything with view_all_visits', () => {
    expect(visitViewScope({ permissions: [P.VIEW_ALL], assignedLocations: ['Dallas'] })).toEqual({ kind: 'all' });
  });

  it('lets view_all win over view_branch', () => {
    expect(visitViewScope({ permissions: [P.VIEW_BRANCH, P.VIEW_ALL], assignedLocations: ['Dallas'] })).toEqual({ kind: 'all' });
  });

  it('limits view_branch_visits to assigned branches, * meaning all', () => {
    expect(visitViewScope({ permissions: [P.VIEW_BRANCH], assignedLocations: ['Dallas', ''] }))
      .toEqual({ kind: 'branches', locations: ['Dallas'] });
    expect(visitViewScope({ permissions: [P.VIEW_BRANCH], assignedLocations: ['*'] })).toEqual({ kind: 'all' });
    expect(visitViewScope({ permissions: [P.VIEW_BRANCH] })).toEqual({ kind: 'branches', locations: [] });
  });

  it('falls back to own visits with neither permission', () => {
    expect(visitViewScope({ role: 'admin', permissions: [], assignedLocations: ['*'] })).toEqual({ kind: 'own' });
    expect(visitViewScope(null)).toEqual({ kind: 'own' });
  });
});
