import { describe, it, expect } from 'vitest';
import { placementVisit, placementResource, PlacementConflict } from './resourcePlacement';
const visit = (id: string, notes: string) => ({ _id: id, date: '2026-10-31', purpose: 'Resource Placement: Binder', createdBy: 'rep', notes });
const resource = (id: string, notes: string) => ({ _id: id, date: '2026-10-31', title: 'Binder', uploadedBy: 'rep', notes });
describe('placement identity', () => {
  it('resolves reciprocal legacy links by unique metadata rather than the first repeated title', () => {
    const visits = [visit('v1', 'First'), visit('v2', 'Second')], resources = [resource('r1', 'First'), resource('r2', 'Second')];
    const customer = { visits, resources };
    expect(placementVisit(customer, resources[1])?._id).toBe('v2');
    expect(placementResource(customer, visits[1])?._id).toBe('r2');
  });
  it('uses durable IDs even when all display fields are identical', () => {
    const visits = [{ ...visit('v1', 'Same'), resourceId: 'r1' }, { ...visit('v2', 'Same'), resourceId: 'r2' }];
    const resources = [{ ...resource('r1', 'Same'), visitId: 'v1' }, { ...resource('r2', 'Same'), visitId: 'v2' }];
    expect(placementResource({ visits, resources }, visits[1])?._id).toBe('r2');
  });
  it('refuses ambiguous legacy title matches', () => {
    expect(() => placementVisit({ visits: [visit('v1', 'Same'), visit('v2', 'Same')] }, resource('r1', 'Same'))).toThrow(PlacementConflict);
  });
  it('does not let unrelated ambiguous history block deleting a separately identified placement', () => {
    const target = { ...visit('v3', 'Other'), purpose: 'Resource Placement: Samples' };
    const r = { ...resource('r3', 'Other'), title: 'Samples' };
    const customer = { visits: [visit('v1', 'Same'), visit('v2', 'Same'), target], resources: [resource('r1', 'Same'), r] };
    expect(placementResource(customer, target)?._id).toBe('r3');
  });
});
