import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getInitials, readPinTipDismissed, savePinTipDismissed, PIN_TIP_KEY } from './sideNav';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
});
afterEach(() => vi.unstubAllGlobals());

describe('side nav rules', () => {
  it('takes two initials, or U for nobody', () => {
    expect(getInitials('Krish Patel Rao')).toBe('KP');
    expect(getInitials('rita')).toBe('R');
    expect(getInitials(undefined)).toBe('U');
    expect(getInitials('')).toBe('U');
  });
  it('remembers the pin tip per device', () => {
    expect(readPinTipDismissed()).toBe(false);
    savePinTipDismissed();
    expect(store.get(PIN_TIP_KEY)).toBe('1');
    expect(readPinTipDismissed()).toBe(true);
  });
  it('treats storage it can’t reach as not dismissed, and saving there as a no-op', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(readPinTipDismissed()).toBe(false);
    expect(() => savePinTipDismissed()).not.toThrow();
  });
});
