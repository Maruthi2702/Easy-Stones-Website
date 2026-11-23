import { describe, expect, it } from 'vitest';
import { consentBody, platformWords } from './collectorRules';

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
  it('the agreement is one short paragraph that still says why, who sees it and that a manager may ask outside work hours', () => {
    const ios = consentBody('ios');
    expect(ios).toContain('during work hours');
    expect(ios).toContain('show your manager where you are on the job');
    expect(ios).toContain('A manager may also request your location outside work hours.');
    expect(ios.length).toBeLessThan(330);
    expect(consentBody('android')).toContain('closed or not in use');
  });
});
