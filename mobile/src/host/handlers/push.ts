import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { PluginImpl } from '../protocol';

/**
 * Show a notification that arrives while the app is open (the Capacitor app asked for this through `presentationOptions`), and on Android
 * make the "default" channel the server's messages name (`android.notification.channel_id` in src/services/fcm.ts): Android 8+ shows
 * nothing without a channel.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
});
const ensureChannel = async () => {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', { name: 'Easy Surfaces', importance: Notifications.AndroidImportance.HIGH });
};

const receive = (granted: boolean, canAsk: boolean) => (granted ? 'granted' : canAsk ? 'prompt' : 'denied');
const toCapacitor = (p: Notifications.NotificationPermissionsStatus) => ({ receive: receive(p.granted, p.canAskAgain && p.status !== 'denied') });
type Registered = { value: string } | { error: string };
const subscribers = new Set<(r: Registered) => void>();

/**
 * @capacitor/push-notifications: the device token goes to the server's push-devices route, with its platform (the website adds it from
 * `Capacitor.getPlatform()`): src/services/apns.ts sends to iPhones through Apple, src/services/fcm.ts to Android through Firebase.
 */
export const PushNotifications: PluginImpl = {
  calls: {
    checkPermissions: async () => toCapacitor(await Notifications.getPermissionsAsync()),
    requestPermissions: async () => { await ensureChannel(); return toCapacitor(await Notifications.requestPermissionsAsync()); },
    register: async () => {
      try {
        await ensureChannel();
        // iPhone: Apple's device token (hex). Android: the Firebase (FCM) token, which needs google-services.json in the build (docs/ANDROID_PUSH.md).
        const token = await Notifications.getDevicePushTokenAsync();
        for (const s of subscribers) s({ value: String(token.data) });
      } catch (e) { for (const s of subscribers) s({ error: (e as Error).message }); }
      return {};
    }
  },
  callbacks: {},
  events: {
    registration: (emit) => { const s = (r: Registered) => { if ('value' in r) emit(r); }; subscribers.add(s); return () => subscribers.delete(s); },
    registrationError: (emit) => { const s = (r: Registered) => { if ('error' in r) emit(r); }; subscribers.add(s); return () => subscribers.delete(s); },
    pushNotificationReceived: (emit) => {
      const sub = Notifications.addNotificationReceivedListener((n) => emit({ id: n.request.identifier, title: n.request.content.title, body: n.request.content.body, data: n.request.content.data }));
      return () => sub.remove();
    },
    pushNotificationActionPerformed: (emit) => {
      const sub = Notifications.addNotificationResponseReceivedListener((r) => emit({
        actionId: 'tap', notification: { id: r.notification.request.identifier, title: r.notification.request.content.title, body: r.notification.request.content.body, data: r.notification.request.content.data }
      }));
      return () => sub.remove();
    }
  }
};
