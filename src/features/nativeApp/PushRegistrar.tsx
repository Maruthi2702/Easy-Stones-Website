import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { useAuth } from '../../context/AuthContext';
import { registerPushDevice } from '../../api/pushDevices';
import { requestSalesTab, salesTabOf } from '../../utils/salesTabEvent';

/**
 * Push notifications in the phone app (server: src/services/apns.ts for iPhones, src/services/fcm.ts for Android). For a
 * signed-in staff member it asks the phone for permission once, registers the phone's
 * token (with its platform, see api/pushDevices.ts) with the server, and opens the page a notification names (`path`) when
 * it's tapped. Draws nothing; nothing happens in a browser or for suppliers.
 */
export default function PushRegistrar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const staff = Capacitor.isNativePlatform() && user?.type === 'internal' && Boolean(user?.id || user?._id);

  useEffect(() => {
    if (!staff) return;
    const handles: Promise<{ remove: () => Promise<void> }>[] = [
      PushNotifications.addListener('registration', t => { void registerPushDevice(t.value); }),
      PushNotifications.addListener('registrationError', e => console.error('Push registration:', e.error)),
      PushNotifications.addListener('pushNotificationActionPerformed', a => {
        const path = (a.notification.data as { path?: unknown } | undefined)?.path;
        if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) {
          navigate(path);
          // Sales already open only reads ?tab= when it loads, so ask it to show the page too.
          const tab = salesTabOf(path);
          if (tab) requestSalesTab(tab);
        }
      })
    ];
    (async () => {
      try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
        if (perm.receive === 'granted') await PushNotifications.register();
      } catch (error) { console.error('Push setup:', error); }
    })();
    return () => { handles.forEach(h => { void h.then(x => x.remove()); }); };
  }, [staff, navigate]);

  return null;
}
