import { describe, expect, it } from 'vitest';
import { CONSENT_TITLE, consentBody, platformWords } from './collectorRules';

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
  it('the agreement is the owner’s wording (version 4); Android adds Google Play’s closed-app disclosure', () => {
    expect(CONSENT_TITLE).toBe('Easy Surfaces requires location');
    expect(consentBody('ios')).toBe('Allow Easy Surfaces to use your location during work hours to record Visits and Resources, and to schedule your day.');
    expect(consentBody('android')).toContain('to schedule your day.');
    expect(consentBody('android')).toContain('closed or not in use');
  });
  it('on iPhone names the two buttons to tap and the one not to; Android has no step list', () => {
    const s = platformWords('ios').steps;
    expect(s?.items.map(i => i.button)).toEqual(['Allow While Using App', 'Change to Always Allow']);
    expect(s?.warning).toContain('Allow Once');
    expect(platformWords('android').steps).toBeNull();
  });
  it('the not-on-Always card names each phone’s own path', () => {
    expect(platformWords('ios').alwaysPath).toEqual(['Settings', 'Location', 'Always']);
    expect(platformWords('android').alwaysPath.at(-1)).toBe('Allow all the time');
  });
});
