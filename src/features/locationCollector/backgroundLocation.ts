import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import type { DeviceState, PluginLocation } from './collectorRules';
import { LocationHealth } from './locationHealthPlugin';
import type { RawPoint } from '../../utils/locationTracking';

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
 * What the phone can say about itself. The native LocationHealth plugin (app builds after 2026-11-22) gives the real
 * permission level, Low Power Mode and battery; on an older build every call rejects and the answer is "unknown" —
 * never an error, because this web code is also loaded by those builds.
 */
export async function readDevice(): Promise<DeviceState> {
  const out: DeviceState = { permission: 'unknown', lowPower: false, batteryPct: null, charging: false, appVersion: '' };
  try {
    const s = await LocationHealth.status();
    out.permission = s.authorization;
    out.lowPower = s.lowPower === true;
    out.batteryPct = typeof s.batteryPct === 'number' ? s.batteryPct : null;
    out.charging = s.charging === true;
  } catch {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      if ((await Geolocation.checkPermissions()).location === 'denied') out.permission = 'denied';
    } catch { /* leave unknown */ }
  }
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    out.appVersion = `${info.version}${info.build ? `+${info.build}` : ''}`;
  } catch { /* leave blank */ }
  return out;
}

/** Ask iOS to wake / relaunch the app on a significant move (so a force-quit app starts collecting again). False on an older build. */
export async function startWakeups(): Promise<boolean> {
  try { return (await LocationHealth.startSignificantChange()).started; } catch { return false; }
}
export async function stopWakeups(): Promise<void> {
  try { await LocationHealth.stopSignificantChange(); } catch { /* older build */ }
}

/** The durable copy of the unsent points (a file on the phone). Each call is best effort: localStorage is the other copy. */
export async function saveDurable(userId: string, points: RawPoint[]): Promise<void> {
  try { await LocationHealth.queueSave({ userId, points }); } catch { /* older build */ }
}
export async function loadDurable(userId: string): Promise<RawPoint[]> {
  try { return (await LocationHealth.queueLoad({ userId })).points ?? []; } catch { return []; }
}
export async function clearDurable(): Promise<void> {
  try { await LocationHealth.queueClear(); } catch { /* older build */ }
}

/** Android: ask for "Allow all the time" (after location itself). No-op elsewhere or on an older build. */
export async function askAlways(): Promise<void> {
  try { await LocationHealth.requestAlways(); } catch { /* iPhone or an older build: nothing to ask */ }
}
/** Android: open the battery list so the app can be set to "Unrestricted". */
export async function openBatterySettings(): Promise<void> {
  try { await LocationHealth.openBatterySettings(); } catch { /* not Android, or an older build */ }
}

/** True inside the React Native app (mobile/), which injects this marker before the page loads. */
export const insideReactNativeApp = () => typeof window !== 'undefined' && (window as unknown as { __EASY_HOST__?: string }).__EASY_HOST__ === 'react-native';

/** Does the phone collect and send by itself (so this page must not)? False on any build that can't say. */
export async function phoneCollects(): Promise<boolean> {
  try { return (await LocationHealth.collectorState()).native === true; } catch { return false; }
}
/** Ask the phone to collect for this person; `denied` when they refused location. Never throws. */
export async function startPhoneCollecting(userId: string): Promise<{ started: boolean; denied: boolean }> {
  try { return await LocationHealth.startCollecting({ userId }); } catch { return { started: false, denied: false }; }
}
export async function stopPhoneCollecting(): Promise<void> {
  try { await LocationHealth.stopCollecting(); } catch { /* an older build */ }
}
/** Has the person refused or revoked location since? */
export async function phoneDenied(): Promise<boolean> {
  try { return (await LocationHealth.collectorState()).denied === true; } catch { return false; }
}
