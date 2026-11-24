import { Linking, Platform } from 'react-native';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Emit, PluginImpl } from '../protocol';
import { WAKE_TASK, WATCH_TASK } from '../../collector/constants';
import { authorization } from '../../collector/device';
import { fixWithin, rememberFix, type Fix } from '../lastFix';
import { collectorState, disable, isWakeArmed, isWatching, onLocations, resume, startCollecting, wake } from '../../collector/nativeCollector';


type PluginLocation = { latitude: number; longitude: number; accuracy: number; altitude: number | null; altitudeAccuracy: number | null; simulated: boolean; speed: number | null; bearing: number | null; time: number };
const toPlugin = (l: Location.LocationObject): PluginLocation => ({
  latitude: l.coords.latitude, longitude: l.coords.longitude, accuracy: l.coords.accuracy ?? 0, altitude: l.coords.altitude, altitudeAccuracy: l.coords.altitudeAccuracy,
  simulated: false, speed: l.coords.speed, bearing: l.coords.heading, time: l.timestamp
});

const toFix = (l: Location.LocationObject): Fix => ({
  timestamp: l.timestamp,
  coords: { latitude: l.coords.latitude, longitude: l.coords.longitude, accuracy: l.coords.accuracy ?? 0, altitude: l.coords.altitude, altitudeAccuracy: l.coords.altitudeAccuracy, speed: l.coords.speed, heading: l.coords.heading }
});

/**
 * Everyone listening for positions: the native collector (collector/), and a website watcher if an older web build still collects in the
 * page. The task feeds both, in the foreground or the background — it can even start with no page and no UI (a background launch).
 */
const watchers = new Set<Emit>();
TaskManager.defineTask(WATCH_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  for (const l of locations) { rememberFix(toFix(l)); for (const emit of watchers) emit(toPlugin(l)); }
  await onLocations(locations.map(toPlugin)).catch(() => undefined);
});
// iPhone: leaving or re-entering the circle the collector keeps around the phone restarts a closed app (collector/wake.ts). Like the
// task above it must be defined here, at the top level, before the app starts.
TaskManager.defineTask(WAKE_TASK, async ({ error }) => {
  if (error) return;
  await wake().catch(() => undefined);
});
// A launch with no UI (the OS woke the app for a location update) still resumes collecting from what the phone saved.
void resume().catch(() => undefined);

/** @capacitor/geolocation: one fresh position (a "Locate now" answer, a visit's where-logged reading). */
export const Geolocation: PluginImpl = {
  calls: {
    checkPermissions: async () => { const p = await Location.getForegroundPermissionsAsync(); const s = p.granted ? 'granted' : p.canAskAgain ? 'prompt' : 'denied'; return { location: s, coarseLocation: s }; },
    requestPermissions: async () => { const p = await Location.requestForegroundPermissionsAsync(); const s = p.granted ? 'granted' : 'denied'; return { location: s, coarseLocation: s }; },
    getCurrentPosition: async (o: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }) => {
      // The collector's newest point, when the page accepts one this old (the page's own location calls ask for up to 20 s).
      const recent = fixWithin(Number(o.maximumAge) || 0);
      if (recent && (await Location.getForegroundPermissionsAsync()).granted) return recent;
      const fg = await Location.requestForegroundPermissionsAsync();
      if (!fg.granted) { const e = new Error('Location permission was denied'); (e as { code?: string }).code = 'OS-PLUG-GLOC-0003'; throw e; }
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: o.enableHighAccuracy === false ? Location.Accuracy.Balanced : Location.Accuracy.Highest }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout expired')), o.timeout ?? 20_000))
      ]);
      const fix = toFix(pos);
      rememberFix(fix);
      return fix;
    }
  },
  callbacks: {}, events: {}
};

/**
 * @capacitor-community/background-geolocation: the watcher the collector uses. Foreground and background updates come from one
 * Expo location task; on Android it runs as a foreground service with the notification text the website gives.
 */
export const BackgroundGeolocation: PluginImpl = {
  calls: {
    removeWatcher: () => ({}),
    openSettings: async () => { await Linking.openSettings(); return {}; }
  },
  callbacks: {
    addWatcher: async (o: { backgroundTitle?: string; backgroundMessage?: string; requestPermissions?: boolean; distanceFilter?: number }, emit, fail) => {
      if (o.requestPermissions !== false) {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (!fg.granted) { fail({ message: 'Location permission was denied', code: 'NOT_AUTHORIZED' }); return () => undefined; }
        if (o.backgroundMessage) await Location.requestBackgroundPermissionsAsync();
      } else if (!(await Location.getForegroundPermissionsAsync()).granted) {
        fail({ message: 'Location permission was denied', code: 'NOT_AUTHORIZED' }); return () => undefined;
      }
      watchers.add(emit);
      if (!(await Location.hasStartedLocationUpdatesAsync(WATCH_TASK).catch(() => false))) {
        const background = (await Location.getBackgroundPermissionsAsync()).granted && Boolean(o.backgroundMessage);
        await Location.startLocationUpdatesAsync(WATCH_TASK, {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: o.distanceFilter ?? 0,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: background,
          activityType: Location.ActivityType.Other,
          ...(background ? { foregroundService: { notificationTitle: o.backgroundTitle || 'Using your location', notificationBody: o.backgroundMessage || '' } } : {})
        });
      }
      return () => {
        watchers.delete(emit);
        if (!watchers.size && !isWatching()) void Location.stopLocationUpdatesAsync(WATCH_TASK).catch(() => undefined);
      };
    }
  },
  events: {}
};

const QUEUE_PREFIX = 'easysurfaces.points.';
const queueKey = (userId: string) => `${QUEUE_PREFIX}${String(userId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}`;

/**
 * Our own plugin (the website's src/features/locationCollector/locationHealthPlugin.ts; the Capacitor app had a Swift and a Java
 * twin of it): the real permission level, battery, Battery saver / Low Power Mode, and the durable queue of unsent points.
 * iOS "significant change" is replaced by a geofence the collector keeps around the phone (collector/wake.ts): the collector arms it
 * itself, so `startSignificantChange` only reports whether it is armed, and `significantChange` in `status` says the same.
 */
export const LocationHealth: PluginImpl = {
  calls: {
    status: async () => {
      const [auth, level, state, low] = await Promise.all([authorization(), Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync(), Battery.isLowPowerModeEnabledAsync()]);
      return {
        authorization: auth, precise: true, lowPower: low,
        batteryPct: level >= 0 ? Math.round(level * 100) : null,
        charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL, significantChange: isWakeArmed()
      };
    },
    requestAlways: async () => {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.granted) await Location.requestBackgroundPermissionsAsync();
      return { authorization: await authorization() };
    },
    /** The website asks the phone to collect for this person (the page keeps consent and the pill; the phone collects and sends). */
    startCollecting: async (o: { userId?: string }) => {
      if (!o.userId) throw new Error('userId is required');
      const r = await startCollecting(String(o.userId));
      return { ...r, authorization: await authorization(), ...collectorState() };
    },
    stopCollecting: async () => { await disable(); return {}; },
    /** `native: true` tells the website it must NOT collect and send points itself. */
    collectorState: async () => ({ ...collectorState(), authorization: await authorization() }),
    startSignificantChange: async () => ({ started: isWakeArmed(), ...(isWakeArmed() ? {} : { reason: 'not-armed-yet' }), authorization: await authorization() }),
    stopSignificantChange: () => ({}),
    openBatterySettings: async () => {
      if (Platform.OS === 'android') await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
      return {};
    },
    queueSave: async (o: { userId: string; points: unknown[] }) => {
      if (!o.userId) throw new Error('userId is required');
      const points = Array.isArray(o.points) ? o.points : [];
      if (!points.length) await AsyncStorage.removeItem(queueKey(o.userId)); else await AsyncStorage.setItem(queueKey(o.userId), JSON.stringify(points));
      return { saved: true, count: points.length };
    },
    queueLoad: async (o: { userId: string }) => {
      if (!o.userId) throw new Error('userId is required');
      try { const raw = await AsyncStorage.getItem(queueKey(o.userId)); const points = raw ? JSON.parse(raw) : []; return { points: Array.isArray(points) ? points : [] }; }
      catch { return { points: [] }; }
    },
    queueClear: async () => { const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(QUEUE_PREFIX)); if (keys.length) await AsyncStorage.multiRemove(keys); return {}; }
  },
  callbacks: {},
  events: {
    lowPowerChanged: (emit) => { const s = Battery.addLowPowerModeListener(({ lowPowerMode }) => emit({ lowPower: lowPowerMode })); return () => s.remove(); }
  }
};
