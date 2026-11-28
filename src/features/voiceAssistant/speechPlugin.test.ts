// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cap = vi.hoisted(() => ({ native: false, available: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => cap.native },
  registerPlugin: () => ({ available: cap.available })
}));

import { speechAvailability } from './speechPlugin';

describe('speechAvailability', () => {
  beforeEach(() => { cap.native = false; cap.available.mockReset(); });

  it('is unavailable in a browser and never asks the plugin', async () => {
    expect(await speechAvailability()).toEqual({ available: false, onDevice: false, permission: 'undetermined' });
    expect(cap.available).not.toHaveBeenCalled();
  });

  it('is unavailable in an app build without the Speech plugin (the call fails)', async () => {
    cap.native = true;
    cap.available.mockRejectedValue(Object.assign(new Error('"Speech.available()" is not implemented'), { code: 'UNIMPLEMENTED' }));
    expect(await speechAvailability()).toEqual({ available: false, onDevice: false, permission: 'undetermined' });
  });

  it('is unavailable when the plugin answers nonsense', async () => {
    cap.native = true;
    cap.available.mockResolvedValue({});
    expect((await speechAvailability()).available).toBe(false);
  });

  it('is unavailable when the call never answers', async () => {
    vi.useFakeTimers();
    try {
      cap.native = true;
      cap.available.mockReturnValue(new Promise(() => {}));
      const p = speechAvailability();
      await vi.advanceTimersByTimeAsync(4000);
      expect((await p).available).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('passes the phone\'s answer through', async () => {
    cap.native = true;
    cap.available.mockResolvedValue({ available: true, onDevice: true, permission: 'granted' });
    expect(await speechAvailability()).toEqual({ available: true, onDevice: true, permission: 'granted' });
  });
});
