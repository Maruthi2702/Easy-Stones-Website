# Android push notifications (Firebase Cloud Messaging) — 2026-11-22

Locate now, Send Notification, the follow-up push and Team Location's reminders all go through `sendPushToUsers`
(`src/services/apns.ts`). It now sends each registered phone through the right service:
- iPhone → Apple (APNs), as before.
- Android → Firebase Cloud Messaging (`src/services/fcm.ts`, HTTP v1 API; no extra package).

Push is **on when either service is set up** and harmless when neither is (nothing is sent, nothing fails).

## What was built
- `push_devices.platform` already existed (`'ios'` default, migration `0018`), so **there is no new migration**.
- The phone registers `{ token, platform }` at `POST /api/push-devices`; `platform` comes from `Capacitor.getPlatform()` in the website
  (`src/api/pushDevices.ts`). A missing platform means iPhone, so older app builds keep working. An Android token is kept exactly as
  sent (FCM tokens are case-sensitive); an iPhone token is lower-cased hex as before.
- FCM sends a visible notification (title, body) plus `data.path` to open on tap, on the `default` Android channel. A token FCM calls
  dead (`UNREGISTERED`, or an invalid-token `INVALID_ARGUMENT`) is deleted; other failures are only counted.
- React Native app (`mobile/src/host/handlers/push.ts`): on Android the token is Firebase's (`getDevicePushTokenAsync`), the
  `default` channel is created, and a notification that arrives while the app is open is shown.

## What the owner must supply
1. **A Firebase project** (console.firebase.google.com) with an Android app whose package name is `app.easysurfaces`.
2. **The service-account key** for sending: Project settings → Service accounts → Generate new private key. Put the file's text — or
   that text base64-encoded (easier to paste) — in the server's environment as `FCM_SERVICE_ACCOUNT_JSON` (Render → Environment).
   The account needs the "Firebase Cloud Messaging API (V1)" enabled (it is on by default for new projects).
3. **`google-services.json`** (Project settings → Your apps → Android). Without it the Android app cannot get a token:
   `getDevicePushTokenAsync` fails with a Firebase-not-initialised error and the site logs "Push registration". Save it as
   `mobile/google-services.json` and add `"googleServicesFile": "./google-services.json"` under `android` in `mobile/app.json`, then
   run `npx expo prebuild --platform android` again. **Do not commit it to a public repository.** (This was not added here:
   `mobile/app.json` belongs to another workstream, and the file is the owner's credential.)
4. On Android 13+ the person must allow notifications when asked.

## Migration
None. Deploy the code; set `FCM_SERVICE_ACCOUNT_JSON`; a Render restart picks it up.

## How to check it works
1. Sign in on an Android build, allow notifications.
2. As an admin with `send_notifications`: Admin → Send Notification → pick that person → send. The screen says "Sent to 1 person".
3. `POST /api/push-devices/test` (as that person) shows the phone as `platform: "android"`, `environment: "firebase"`.

## Not covered
- The old Capacitor Android app registers a Firebase token too (the Capacitor push plugin returns one), so it works with this server
  once it has its own `google-services.json`; the React Native app is the one being built.
- Badges and notification actions are not sent on Android. Everything is a plain notification that opens the page in `path`.
