import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import type { PluginLocation } from './collectorRules';

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
