# Android: what is built, what Google Play needs, what is untested (2026-11-22)

The Android app is the same Capacitor shell as the iPhone app: it loads the live site, so every screen, the server and the
manager's Team Location are shared. Only the phone's native side differs. Branch: `feat/team-location-redesign`.

## Built
- `android/` — the Capacitor Android project (`npx cap add android`), app id `app.easysurfaces`, loads `CAP_SERVER_URL`.
- `plugins/location-health/android/` — the Java twin of the Swift plugin. Same methods and answers (`status`, `queueSave/Load/Clear`,
  `startSignificantChange` = "not-applicable" on Android), plus `requestAlways()` (the separate "Allow all the time" step Android 10+
  needs) and `openBatterySettings()`.
- Collecting is the community `background-geolocation` plugin's foreground service (a visible "Easy Surfaces — Sharing your location
  during work hours." notification while it runs, which Android requires).
- The consent screen is platform-aware (`platformWords` in `collectorRules.ts`): on Android it says location is used "when the app is
  closed or not in use" (Google Play's prominent-disclosure rule) and asks for "Allow all the time" right after Allow.

## Google Play: do these early, they are the slow part
1. **Background location declaration** (Play Console → App content). Core feature: staff location during work hours for their manager.
   Needs a short demo video showing the in-app disclosure, the permission prompt and the persistent notification.
2. **Prominent disclosure** — the consent screen is it; it must appear before the permission prompt and name what is collected, why,
   and that it happens when the app is closed. Do not shorten it.
3. **Data safety form**: precise location collected, shared with the company's own server only, encrypted in transit, deletable
   (kept 90 days), required for the app to function.
4. **Foreground service type "location"** declaration (Android 14+), same video.
5. Distribute as a **private / managed Google Play app** (the Android twin of the unlisted iPhone app) or internal testing first.
6. Account: a Google Play developer account in the company's name (one-time fee). As I understand Google's current rule (confirm in Play Console), a personal account created after Nov 2023 must run
   a 14-day closed test with 12 testers before production; an organisation account does not.

## Not built / not verified
- **Never run on a real Android phone.** Unverified: that the foreground service survives a whole workday, and what each phone
  maker's battery saver does (Samsung, Xiaomi, Huawei and OnePlus stop background apps; staff must set Battery to "Unrestricted" —
  the consent screen links to the battery list).
- **Push notifications on Android need Firebase Cloud Messaging** (`google-services.json`, a server sender); today pushes are Apple-only
  (`src/services/apns.ts`). Locate now and Send Notification therefore will NOT reach an Android phone until that is built.
- There is no Android equivalent of iOS's "relaunch after force-quit on a significant move". The foreground service keeps running; a
  force-stop from Settings ends collection until the app is opened.
- App icon, splash and the Play listing assets are Capacitor's defaults.
- Building needs JDK 21 and the Android SDK (`ANDROID_HOME`); `cd android && ./gradlew assembleDebug`.
