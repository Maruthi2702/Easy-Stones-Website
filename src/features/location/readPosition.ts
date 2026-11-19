import { deviceKind } from '../../utils/visitLocation.ts';
import type { LocationReading } from '../../utils/visitLocation.ts';

/** One reading from the browser, in the shape the server takes. Rejects with { code } (1 = refused, 2 = unavailable, 3 = timed out, 0 = no location in this browser). */
export function readOnce({ highAccuracy, timeoutMs }: { highAccuracy: boolean; timeoutMs: number }): Promise<LocationReading> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject({ code: 0 }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy ?? 0),
        takenAtMs: p.timestamp || Date.now(),
        device: deviceKind(navigator.userAgent, navigator.maxTouchPoints)
      }),
      (e) => reject({ code: e.code }),
      { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}
