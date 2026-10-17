import { describe, it, expect } from 'vitest';
import { presenceById, agoLabel, onlineStatusOf, countOnline } from './userPresence.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60000;

describe('agoLabel', () => {
  it('words minutes, hours, days', () => {
    expect(agoLabel(ago(10 * 1000), NOW)).toBe('just now');
    expect(agoLabel(ago(5 * MIN), NOW)).toBe('5 min ago');
    expect(agoLabel(ago(3 * 60 * MIN), NOW)).toBe('3 h ago');
    expect(agoLabel(ago(30 * 60 * MIN), NOW)).toBe('yesterday');
    expect(agoLabel(ago(4 * 24 * 60 * MIN), NOW)).toBe('4 days ago');
    expect(agoLabel('garbage', NOW)).toBe('');
  });
});

describe('onlineStatusOf', () => {
  const live = presenceById([
    { userId: 'a', status: 'active', device: 'phone', tabs: 1, lastActiveAt: NOW },
    { userId: 'b', status: 'idle', device: 'desktop', tabs: 2, lastActiveAt: NOW - 20 * MIN }
  ]);
  it('active with its device', () => {
    const s = onlineStatusOf({ _id: 'a' }, live, NOW);
    expect(s.kind).toBe('active');
    expect(s.detail).toBe('Active now · Phone');
  });
  it('idle with when it was last used and the tab count', () => {
    const s = onlineStatusOf({ _id: 'b' }, live, NOW);
    expect(s.kind).toBe('idle');
    expect(s.detail).toBe('Idle — last used 20 min ago · Computer · 2 tabs');
  });
  it('offline shows last seen; falls back to last sign-in; never when neither', () => {
    expect(onlineStatusOf({ _id: 'c', lastSeenAt: ago(2 * 60 * MIN) }, live, NOW).label).toBe('Last seen 2 h ago');
    expect(onlineStatusOf({ _id: 'c', lastLoginAt: ago(5 * MIN) }, live, NOW).kind).toBe('offline');
    expect(onlineStatusOf({ _id: 'c' }, live, NOW).kind).toBe('never');
  });
  it('works before the live list has loaded', () => {
    expect(onlineStatusOf({ _id: 'a', lastSeenAt: ago(MIN) }, undefined, NOW).kind).toBe('offline');
  });
});

describe('countOnline', () => {
  it('counts users with a tab open', () => {
    const live = presenceById([{ userId: 'a' }, { userId: 'b' }]);
    expect(countOnline([{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }], live)).toBe(2);
  });
});
