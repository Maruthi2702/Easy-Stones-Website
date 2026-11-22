import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import type { DeviceState, PluginLocation } from './collectorRules';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/**
 * The native location watcher (iOS: keeps running in the background because
 * of UIBackgroundModes → location). `onDenied` fires when iOS location is off
 * for the app. Resolves to a function that stops it.
 */
export async function startWatching(onLocation: (loc: PluginLocation) => void, onDenied: () => void): Promise<() => Promise<void>> {
  const id = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: 'Easy Surfaces',
      backgroundMessage: 'Sharing your location during work hours.',
      requestPermissions: true,
      stale: false,
      distanceFilter: 25
    },
    (location, error) => {
      if (error) { if (error.code === 'NOT_AUTHORIZED') onDenied(); return; }
      if (location) onLocation(location);
    }
  );
  return () => BackgroundGeolocation.removeWatcher({ id });
}

export const openLocationSettings = () => BackgroundGeolocation.openSettings();

/** One fresh position for a "Locate now" ask, or null when iOS has none to give (location off, no fix in 20 s). */
export async function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  const { Geolocation } = await import('@capacitor/geolocation');
  try {
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
  } catch { return null; }
}

/**
 * What the phone can say about itself. Every read is guarded: this web code is also loaded by app builds from
 * before the Device plugin was added, where it simply isn't there (the answer is then "unknown", never an error).
 * Not readable from the web layer, so always 'unknown' / false until a small native piece is added: whether
 * location is "Always" or "While Using", and Low Power Mode.
 */
export async function readDevice(): Promise<DeviceState> {
  const out: DeviceState = { permission: 'unknown', lowPower: false, batteryPct: null, charging: false, appVersion: '' };
  try {
    const { Device } = await import('@capacitor/device');
    const b = await Device.getBatteryInfo();
    if (typeof b.batteryLevel === 'number') out.batteryPct = Math.round(b.batteryLevel * 100);
    out.charging = b.isCharging === true;
  } catch { /* no plugin in this build */ }
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    if ((await Geolocation.checkPermissions()).location === 'denied') out.permission = 'denied';
  } catch { /* leave unknown */ }
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    out.appVersion = `${info.version}${info.build ? `+${info.build}` : ''}`;
  } catch { /* leave blank */ }
  return out;
}
