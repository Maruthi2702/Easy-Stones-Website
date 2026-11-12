// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readPlaces, savePlace, forgetPlace } from './savedPlaces';

const home = { label: 'Home', address: '1 Main St, Kent, WA', lat: 47.3, lng: -122.2 };

describe('savedPlaces', () => {
  beforeEach(() => window.localStorage.clear());

  it('remembers a place, newest first, one per address', () => {
    savePlace(home);
    savePlace({ ...home, label: 'Hotel', address: '9 Lake Rd, Tacoma, WA' });
    savePlace({ ...home, label: 'My house' });
    expect(readPlaces().map((p) => p.label)).toEqual(['My house', 'Hotel']);
  });

  it('keeps only the latest six', () => {
    for (let i = 0; i < 9; i += 1) savePlace({ ...home, address: `${i} Main St` });
    expect(readPlaces()).toHaveLength(6);
  });

  it('forgets one, and survives bad stored data', () => {
    const [p] = savePlace(home);
    expect(forgetPlace(p.id)).toEqual([]);
    window.localStorage.setItem('pl_saved_places', '{oops');
    expect(readPlaces()).toEqual([]);
  });
});
