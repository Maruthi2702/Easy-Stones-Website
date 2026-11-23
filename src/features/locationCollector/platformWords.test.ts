import { describe, expect, it } from 'vitest';
import { platformWords } from './collectorRules';

describe('platformWords', () => {
  it('keeps the iPhone wording exactly as it was', () => {
    const w = platformWords('ios');
    expect(w.settings).toBe('iPhone Settings');
    expect(w.background).toBe('including when the app is in the background');
    expect(w.next).toContain('“Always”');
    expect(w.battery).toBe('');
  });
  it('says Android’s own steps and discloses use when the app is closed (Google Play’s rule)', () => {
    const w = platformWords('android');
    expect(w.background).toContain('closed or not in use');
    expect(w.next).toContain('“Allow all the time”');
    expect(w.battery).toContain('Unrestricted');
    expect(w.settings).toContain('Permissions');
  });
});
