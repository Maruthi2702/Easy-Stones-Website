// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const native = vi.hoisted(() => ({ isNative: true }));
const access = vi.hoisted(() => ({ locationPermission: vi.fn(async () => 'prompt'), locationWasOk: () => false, rememberPosition: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.isNative } }));
vi.mock('../../utils/geolocationAccess', () => access);
vi.mock('./readPosition', () => ({ readOnce: vi.fn() }));

import LocationGate from './LocationGate';

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.clearAllMocks(); });

describe('the Allow location sheet', () => {
  it('never shows in the iOS app, and doesn’t even ask the permission state', async () => {
    native.isNative = true;
    render(<LocationGate />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Allow location')).toBeNull();
    expect(access.locationPermission).not.toHaveBeenCalled();
  });
  it('still shows on the website when the browser hasn’t been asked', async () => {
    native.isNative = false;
    render(<LocationGate />);
    await waitFor(() => expect(screen.getByText('Allow location')).toBeTruthy());
  });
});
