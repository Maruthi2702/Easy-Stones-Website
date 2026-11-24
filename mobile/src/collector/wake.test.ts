import { describe, expect, it } from 'vitest';
import { WAKE_MAX_ACCURACY_M, WAKE_REARM_EVERY_MS, WAKE_REARM_METRES, shouldRearm } from './wake';

const HERE = { lat: 47.6, lng: -122.3, accuracy: 10 };
// About 0.0015° of latitude is ~167 m; 0.0004° is ~44 m.
const FAR = { lat: 47.6015, lng: -122.3, accuracy: 10 };
const NEAR = { lat: 47.6004, lng: -122.3, accuracy: 10 };
const T0 = 1_000_000;

describe('shouldRearm', () => {
  it('arms the first circle at the first good position', () => {
    expect(shouldRearm(null, HERE, T0)).toBe(true);
  });
  it('never centres a circle on a vague or invalid position', () => {
    expect(shouldRearm(null, { ...HERE, accuracy: WAKE_MAX_ACCURACY_M + 1 }, T0)).toBe(false);
    expect(shouldRearm(null, { ...HERE, accuracy: Number.NaN }, T0)).toBe(false);
    expect(shouldRearm(null, { lat: Number.NaN, lng: 0, accuracy: 5 }, T0)).toBe(false);
    expect(shouldRearm(null, { ...HERE, accuracy: null }, T0)).toBe(true);
  });
  it('leaves the circle alone while the phone stays near its centre', () => {
    expect(shouldRearm({ ...HERE, at: T0 }, NEAR, T0 + WAKE_REARM_EVERY_MS * 5)).toBe(false);
  });
  it('moves it once the phone is far enough away', () => {
    expect(shouldRearm({ ...HERE, at: T0 }, FAR, T0 + WAKE_REARM_EVERY_MS)).toBe(true);
  });
  it('does not re-register more than once a minute, however far the phone went', () => {
    expect(shouldRearm({ ...HERE, at: T0 }, FAR, T0 + WAKE_REARM_EVERY_MS - 1)).toBe(false);
  });
  it('the move threshold is the documented 100 m', () => {
    expect(WAKE_REARM_METRES).toBe(100);
  });
});
