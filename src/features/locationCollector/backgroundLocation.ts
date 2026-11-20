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
