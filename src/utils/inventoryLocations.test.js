import { describe, it, expect } from 'vitest';
import { splitInventoryLocations, defaultInventoryLocations } from './inventoryLocations.js';

const branches = [{ name: 'Seattle' }, { name: 'Spokane' }, { name: 'Salt Lake City' }];
const inventory = ['E & A Granite and Marble', 'Seattle', 'Carolina Granite Tops', 'Fulfillex', ''];

describe('splitInventoryLocations', () => {
  it('puts Easy Stones branches first and consignment sites apart, each A–Z', () => {
    expect(splitInventoryLocations(inventory, branches)).toEqual({
      company: ['Seattle'],
      consignment: ['Carolina Granite Tops', 'E & A Granite and Marble', 'Fulfillex']
    });
  });

  it('matches branches regardless of capitals and spaces, keeping the inventory spelling', () => {
    expect(splitInventoryLocations(['SEATTLE ', 'Fulfillex'], branches).company).toEqual(['SEATTLE']);
  });

  it('treats everything as consignment when the branch list is unknown', () => {
    expect(splitInventoryLocations(['Seattle', 'Fulfillex'], []).company).toEqual([]);
  });
});

describe('defaultInventoryLocations', () => {
  const inv = ['Seattle', 'Spokane', 'Carolina Granite Tops'];

  it('opens on the home location when it has stock', () => {
    expect(defaultInventoryLocations({ location: 'Spokane', assignedLocations: ['Spokane'] }, inv, branches)).toEqual(['Spokane']);
  });

  it('opens on every Easy Stones location with stock when home has none', () => {
    expect(defaultInventoryLocations({ location: 'Salt Lake City', assignedLocations: ['Salt Lake City'] }, inv, branches)).toEqual(['Seattle', 'Spokane']);
  });

  it('never opens on consignment stock for someone with no home location', () => {
    expect(defaultInventoryLocations({ location: '', assignedLocations: ['*'] }, ['Seattle', 'Fulfillex'], branches)).toEqual(['Seattle']);
  });

  it('opens on everything only when no Easy Stones location has stock', () => {
    expect(defaultInventoryLocations({ location: 'Seattle', assignedLocations: ['*'] }, ['Fulfillex', 'GRANITE MAN'], branches)).toEqual([]);
  });
});
