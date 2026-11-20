import { Capacitor } from '@capacitor/core';
import { deviceKind } from '../../utils/visitLocation.ts';
import type { LocationReading } from '../../utils/visitLocation.ts';

/** One reading from the browser, in the shape the server takes. Rejects with { code } (1 = refused, 2 = unavailable, 3 = timed out, 0 = no location in this browser). */
/**
 * Inside the iOS app the reading comes from the app's own location permission (@capacitor/geolocation), which the
 * person already gave. The web page's navigator.geolocation would make iOS ask again for the website itself
 * ("easystones.onrender.com would like to use your current location").
 */
async function readNative({ highAccuracy, timeoutMs }: { highAccuracy: boolean; timeoutMs: number }): Promise<LocationReading> {
  const { Geolocation } = await import('@capacitor/geolocation');
  try {
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 0 });
    return {
      lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy ?? 0),
      takenAtMs: p.timestamp || Date.now(),
      device: deviceKind(navigator.userAgent, navigator.maxTouchPoints)
    };
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e).toLowerCase();
    throw { code: /denied|permission|authori[sz]/.test(msg) ? 1 : /timeout|timed out/.test(msg) ? 3 : 2 };
  }
}

export function readOnce({ highAccuracy, timeoutMs }: { highAccuracy: boolean; timeoutMs: number }): Promise<LocationReading> {
  if (Capacitor.isNativePlatform()) return readNative({ highAccuracy, timeoutMs });
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
