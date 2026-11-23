import type { Plugins } from './protocol';
import { App, KeyboardPlugin } from './handlers/app';
import { PushNotifications } from './handlers/push';
import { BackgroundGeolocation, Geolocation, LocationHealth } from './handlers/location';

/** Every plugin name the website registers → what answers it here. */
export const PLUGINS: Plugins = { App, Keyboard: KeyboardPlugin, PushNotifications, Geolocation, BackgroundGeolocation, LocationHealth };
