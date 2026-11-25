# Easy Surfaces mobile app (React Native / Expo) — iPhone and Android from one codebase

This replaces the Capacitor shell (`ios/`, `android/` at the repo root, with their Swift / Java plugins). It is NOT a rewrite of the
screens: the app shows the live website (`src/`) in a WebView, and the phone-only parts are TypeScript here.

## What is here
- `App.tsx` — one flow: native sign-in screen when nobody is signed in, the website otherwise. Signing out in the site (it lands on
  `/login`) brings the native screen back.
- `src/auth/` — the sign-in screen (was `ios/App/App/NativeLogin/*.swift`): staff and supplier sign in through
  `POST /api/customer/login`; Face ID / Touch ID / fingerprint through the secure store (`vault.ts`).
- `src/host/` — **the bridge**. The website still calls `@capacitor/core` plugins (App, Keyboard, PushNotifications, Geolocation,
  BackgroundGeolocation, LocationHealth). Capacitor lets a host stand in for its native side (`CapacitorCustomPlatform`,
  `PluginHeaders`, `nativePromise` / `nativeCallback`); `protocol.ts` injects that into the page and `router.ts` answers it with
  the Expo modules in `handlers/`. **No website code changed.** `src/features/nativeApp/hostBridge.test.ts` (in the website's tests)
  runs the real `@capacitor/core` against it.
- `src/WebHost.tsx` — the WebView (shared cookies, external links open in the browser, `/login` → native screen).

## Run it
```
cd mobile && npm install
npx expo prebuild            # generates ios/ and android/ (not committed)
npx expo run:ios             # or run:android   (needs Xcode / the Android SDK + JDK 21)
EXPO_PUBLIC_SERVER_URL=https://<preview>.onrender.com npx expo run:android   # a preview build
```
It cannot run in Expo Go (background location, secure store with biometrics and push need a development build).

## Known differences from the Capacitor app (read before replacing it)
1. **No iOS "significant change" call — a geofence stands in for it (2026-11-23).** Expo has no such call, but its docs say iOS restarts
   a terminated app when a geofence event fires. The collector keeps one 200 m circle around the newest in-window position
   (`src/collector/wake.ts` rules, tested; `armWake` in `nativeCollector.ts`; the `WAKE_TASK` in `host/handlers/location.ts` calls `wake()`
   → `resume()` + a tick). It moves when the phone is 100 m from the centre (at most once a minute), needs "Always", is iPhone only
   (Expo's docs: Android does not restart a terminated app for geofences) and reads no position outside 7–6. **Unproven on a real phone:**
   whether iOS (26 especially) relaunches an app the person force-quit, and the 7 AM start only happens if the phone crosses the circle
   (e.g. leaves the place the last evening point was) — a phone that stays put is not woken. Why it exists: on 2026-11-23 a phone showed no data
   8:53–11:06 AM; nothing restarted the closed app. Adding this changes what the app does while closed, so check the consent wording
   (`CONSENT_VERSION` 3) with HR / legal before shipping.
2. **The collector runs in React Native, not the page** (`src/collector/`, on `expo-location` + `expo-task-manager`): the rules are
   `core.ts` (plain TypeScript, every outside thing passed in; tested by `core.test.ts`, run from the repo root with `npx vitest run
   mobile/src/collector`), driven by the background-location task and a 30 s timer, and it resumes from saved state on a launch with no
   page. The website only switches it on / off and shows consent and the pill. It still only runs while the OS keeps the app's
   JavaScript alive (a closed iPhone app can be restarted by the geofence in item 1, if iOS allows it), and the 7 AM start needs the app
   alive or that geofence crossed. Not tested on a real phone.
   **Consent and the "location is off" banner are native too** (`src/location/`, mounted in `App.tsx` over the website): the agreement is
   one paragraph (`consentBody` in the website's `collectorRules.ts`, version 3), posted to `/api/location-tracking/consent`; the website
   draws neither inside the app (`phoneOwns`). Changing the wording means bumping `CONSENT_VERSION`.
   **"Locate now" is answered by the phone** (`src/locate/`): one position per run for every open ask, sent silently (no notice, no
   push — owner, 2026-11-22), at most once a minute, from the collector's 30 s timer and whenever the app comes to the front. Limit: outside
   7–6 the OS suspends the app, so an ask waits until the app is next opened (a silent push to wake it isn't built).
3. **Push:** iOS gives the APNs token (the server's existing sender works). **Android needs Firebase Cloud Messaging** (a
   `google-services.json` and a server sender) — not built.
4. **Keyboard:** the website pads itself by the keyboard height (it was told the native resize is "none"); on Android check the page
   isn't resized twice (`android.softwareKeyboardLayoutMode`). **On iOS the WebView must not scroll for the keyboard**
   (`scrollEnabled={false}` and no automatic insets, `src/host/webViewSettings.ts`): without them WKWebView pans the whole page up
   when a text box takes focus, so forms lose their header and full-screen search sheets go blank (found 2026-11-24).
   Android's equivalent is untested.
5. **Never run on a real phone yet.** Face ID / fingerprint prompts, the cookie hand-over to the WebView on both platforms, the
   foreground-service notification and file upload / camera inside the WebView all need a real-device test.
