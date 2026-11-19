import { vi } from 'vitest';

/** A fake browser location for tests: answers at once with a fresh point, or with an error code (1 refused, 2 unavailable, 3 timed out). */
export function stubGeolocation({ error, accuracy = 20, permission = 'granted' }: { error?: number; accuracy?: number; permission?: PermissionState } = {}) {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback) => {
    if (error) fail?.({ code: error, message: 'x', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    else ok({ coords: { latitude: 47.6062, longitude: -122.3321, accuracy } as GeolocationCoordinates, timestamp: Date.now() } as GeolocationPosition);
  });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn(async () => ({ state: permission, onchange: null })) }
  });
  return { getCurrentPosition };
}
