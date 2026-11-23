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
1. **No iOS "significant change" relaunch.** The Swift plugin asked iOS to restart a force-quit app when the phone moved. Expo has no
   such call; `startSignificantChange` answers `started: false`. A force-quit app stays stopped until opened.
2. **Background collection still runs in the website's JavaScript.** Positions come from an Expo background task and are handed to the
   page. If the OS suspends the WebView while the app is in the background, points are lost until it resumes. Moving the collector
   itself into React Native (headless task) is the next step if a real-phone day shows gaps.
3. **Push:** iOS gives the APNs token (the server's existing sender works). **Android needs Firebase Cloud Messaging** (a
   `google-services.json` and a server sender) — not built.
4. **Keyboard:** the website pads itself by the keyboard height (it was told the native resize is "none"); on Android check the page
   isn't resized twice (`android.softwareKeyboardLayoutMode`).
5. **Never run on a real phone yet.** Face ID / fingerprint prompts, the cookie hand-over to the WebView on both platforms, the
   foreground-service notification and file upload / camera inside the WebView all need a real-device test.
