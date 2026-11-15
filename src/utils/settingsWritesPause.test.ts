import { describe, it, expect } from 'vitest';
import { isSettingsWrite, settingsWritesPaused } from './settingsWritesPause.ts';

describe('settings pause', () => {
  it('is on only for the word true', () => {
    expect(settingsWritesPaused({ SETTINGS_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
    expect(settingsWritesPaused({} as never)).toBe(false);
    expect(settingsWritesPaused({ SETTINGS_WRITES_PAUSED: '1' } as never)).toBe(false);
  });
  it('stops the nav order save, never reads or other areas', () => {
    expect(isSettingsWrite('PUT', '/api/nav-order')).toBe(true);
    expect(isSettingsWrite('PUT', '/api/nav-order/?x=1')).toBe(true);
    expect(isSettingsWrite('GET', '/api/nav-order')).toBe(false);
    expect(isSettingsWrite('PUT', '/api/customers')).toBe(false);
  });
});
