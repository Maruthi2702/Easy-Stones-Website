import { describe, it, expect } from 'vitest';
import { isHiddenLocation, withoutHiddenLocations, canSeeHiddenLocations } from './hiddenLocations.ts';

describe('hidden locations', () => {
  it('knows the Demo location whatever its case or spacing', () => {
    expect(isHiddenLocation('Demo')).toBe(true);
    expect(isHiddenLocation(' demo ')).toBe(true);
    expect(isHiddenLocation('Seattle')).toBe(false);
    expect(isHiddenLocation('')).toBe(false);
    expect(isHiddenLocation(undefined)).toBe(false);
  });

  it('leaves it out of names and of records', () => {
    expect(withoutHiddenLocations(['Atlanta', 'Demo', 'Seattle'])).toEqual(['Atlanta', 'Seattle']);
    expect(withoutHiddenLocations([{ name: 'Demo' }, { name: 'Kent' }])).toEqual([{ name: 'Kent' }]);
  });

  it('shows it only to a login assigned to it by name', () => {
    expect(canSeeHiddenLocations({ assignedLocations: ['Demo'] })).toBe(true);
    expect(canSeeHiddenLocations({ assignedLocations: ['demo'] })).toBe(true);
    expect(canSeeHiddenLocations({ assignedLocations: ['*'] })).toBe(false);
    expect(canSeeHiddenLocations({ assignedLocations: ['Seattle', 'Atlanta'] })).toBe(false);
    expect(canSeeHiddenLocations({ assignedLocations: [] })).toBe(false);
    expect(canSeeHiddenLocations({})).toBe(false);
    expect(canSeeHiddenLocations(null)).toBe(false);
  });
});
