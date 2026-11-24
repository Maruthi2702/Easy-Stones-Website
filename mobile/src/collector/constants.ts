/** One Expo background-location task feeds everything (the native collector, and a website watcher on an older web build). */
export const WATCH_TASK = 'easysurfaces-location-watch';
/** The geofence task that restarts a closed app on iPhone (see wake.ts). */
export const WAKE_TASK = 'easysurfaces-location-wake';
/** Android's foreground-service notification (required while location runs in the background). */
export const NOTIFICATION_TITLE = 'Easy Surfaces';
export const NOTIFICATION_BODY = 'Sharing your location during work hours.';
/** How often the collector looks at the clock while the app's JavaScript is alive (events also drive it). */
export const TICK_EVERY_MS = 30 * 1000;
