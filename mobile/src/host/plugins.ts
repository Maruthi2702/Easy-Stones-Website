import type { Plugins } from './protocol';
import { App, KeyboardPlugin } from './handlers/app';
import { PushNotifications } from './handlers/push';
import { BackgroundGeolocation, Geolocation, LocationHealth } from './handlers/location';
import { SpeechTest } from './handlers/speechTest';
import { Speech } from './handlers/speech';

/** Every plugin name the website registers → what answers it here. */
export const PLUGINS: Plugins = { App, Keyboard: KeyboardPlugin, PushNotifications, Geolocation, BackgroundGeolocation, LocationHealth, SpeechTest, Speech };
