import * as Location from 'expo-location';
import type { PluginLocation } from '../../../src/features/locationCollector/collectorRules';
import { CollectorEngine, type Ports } from './core';
import { NOTIFICATION_BODY, NOTIFICATION_TITLE, TICK_EVERY_MS, WATCH_TASK } from './constants';
import { readDeviceState } from './device';
import * as api from './api';
import * as store from './store';
import { answerLocateRequests } from '../locate/answerNow';

/**
 * The collector's owner: one engine for the signed-in person, driven by the Expo background-location task and a 30 s timer. It starts
 * itself from what is saved on the phone (`resume`), so a background launch with NO page and NO UI still collects and sends; the website
 * only switches it on and off (LocationHealth.startCollecting / stopCollecting) and shows consent and the pill.
 *
 * Honest limit: the timer and the task run only while the OS keeps this app's JavaScript alive (location updates in the background do).
 * An app force-quit by the person is not restarted on iPhone (Expo has no significant-change wake), and the 7 AM start needs the app alive.
 */
const ports: Ports = {
  now: () => Date.now(),
  rand: () => Math.random().toString(36).slice(2, 8),
  loadStatus: api.loadStatus,
  sendPoints: api.sendPoints,
  sendHeartbeat: api.sendHeartbeat,
  readDevice: readDeviceState,
  currentPosition: async () => {
    try {
      const p = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 20_000))
      ]);
      return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
    } catch { return null; }
  },
  loadQueue: store.loadQueue,
  saveQueue: store.saveQueue,
  setWatching: async (on) => {
    const started = await Location.hasStartedLocationUpdatesAsync(WATCH_TASK).catch(() => false);
    if (!on) { if (started) await Location.stopLocationUpdatesAsync(WATCH_TASK).catch(() => undefined); return; }
    if (started) return;
    const background = (await Location.getBackgroundPermissionsAsync()).granted;
    await Location.startLocationUpdatesAsync(WATCH_TASK, {
      accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 25, pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: background,
      ...(background ? { foregroundService: { notificationTitle: NOTIFICATION_TITLE, notificationBody: NOTIFICATION_BODY } } : {})
    });
  }
};

let engine: CollectorEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let starting: Promise<boolean> | null = null;

/** True while a native collector is running for someone (or being brought up). */
export const isWatching = () => Boolean(engine?.watching);

async function begin(userId: string): Promise<boolean> {
  if (engine && engine.userId === userId) { if (!timer) timer = setInterval(() => { void tick(); }, TICK_EVERY_MS); return true; }
  await halt(false);
  const e = new CollectorEngine(ports, userId);
  await e.init();
  engine = e;
  timer = setInterval(() => { void tick(); }, TICK_EVERY_MS);
  await tick();
  return true;
}

async function tick() {
  if (!engine) return;
  await engine.tick();
  if (engine?.signedOut) { await disable(); return; }   // the session is gone: stop, and forget the person
  // An admin's "Locate now" ask is answered whatever the hour, for a tracked person who has agreed (the server checks again).
  if (engine?.status?.tracked && engine.status.consented) void answerLocateRequests();
}

async function halt(clearEnabled: boolean) {
  if (timer) { clearInterval(timer); timer = null; }
  const e = engine; engine = null;
  if (e) await e.stop().catch(() => undefined);
  if (clearEnabled) await store.saveEnabled(null);
}

/** The website's "start": ask for permission if still missing (this runs from the screen), remember who, and run. */
export async function startCollecting(userId: string): Promise<{ started: boolean; denied: boolean }> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { started: false, denied: true };
  if (!(await Location.getBackgroundPermissionsAsync()).granted) await Location.requestBackgroundPermissionsAsync();
  await store.saveEnabled(userId);
  starting = begin(userId).finally(() => { starting = null; });
  await starting.catch(() => false);
  return { started: true, denied: false };
}

/** Sign-out or "no longer tracked": stop and forget. */
export async function disable(): Promise<void> { await halt(true); }

/** From saved state, with no screen: used at app start and when the OS wakes the app for a location update. */
export async function resume(): Promise<void> {
  if (engine) return;
  if (!starting) {
    starting = (async () => {
      const wanted = await store.loadEnabled();
      if (!wanted) return false;
      const me = await api.whoAmI();
      if (me !== wanted) { if (me === null) return false; await store.saveEnabled(null); return false; }   // signed out (keep it for a retry) or another person
      return begin(wanted);
    })().finally(() => { starting = null; });
  }
  await starting.catch(() => false);
}

/** Positions from the background task. */
export async function onLocations(locations: PluginLocation[]): Promise<void> {
  await resume();
  if (!engine) return;
  if (!engine.status) await engine.tick();
  await engine.onLocations(locations);
}

export function collectorState() {
  return {
    native: true, enabled: Boolean(engine), running: Boolean(engine?.watching), queued: engine?.queue.length ?? 0,
    lastSentAt: engine?.lastSentAt ? new Date(engine.lastSentAt).toISOString() : null, phase: engine?.phase() ?? 'off', denied: Boolean(engine?.denied)
  };
}
