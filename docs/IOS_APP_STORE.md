# Easy Surfaces iPhone app — App Store submission

The app is `mobile/` (React Native / Expo): the live site in a WebView plus native sign-in, consent, location collector and
Locate now (see `mobile/README.md`). It replaced the Capacitor shell (`ios/`, kept in the repo, no longer the one shipped).
Bundle ID `app.easysurfaces`, name **Easy Surfaces**, version 1.0.0, **iOS build 13** is on TestFlight and the owner has been
using it on a real iPhone since 2026-11-26 (reports everything works). Rewritten 2026-11-26. Check each item against Apple's
current rules when you reach it. **Owner steps are marked ▶.**

## Before you submit

1. **The website side is already live** (checked 2026-11-26): the mobile commits (up to build 13, `a4c13bfc`) are on `origin/main` and
   the live `/api/health` reported commit `6bae639`, the same as `origin/main`. The app shows the live site, so it already has the
   native bridge, `phoneOwns` consent and consent version 4. (A local `main` branch can be stale — compare with `origin/main`.)
2. **Migrations on Render:** `npm run pg:migrate -- --apply` (location tables `0017`, `0019`, `0029`; push devices `0018`; anything
   newer) — the app's location and push features need them.
3. ✔ **Consent wording sign-off — done** (owner, 2026-11-26: HR / legal approved consent version 4 and the geofence restart).
4. ▶ **Make one review login** (never use a real person's): a staff login whose role has **Track location** and only a few harmless
   pages (a reviewer sees whatever real data those pages hold). Put its username in the review notes below and its password in
   App Store Connect only, never in the repo. **No supplier demo login:** the Purchasing / supplier module is not part of this
   launch (owner, 2026-11-26), so the listing and notes don't mention suppliers.
5. ▶ **Icon:** replace `mobile/assets/icon.png` (1024 × 1024, no transparency) if the mark is soft; check `mobile/assets/` too.
6. ▶ **Screenshots** (owner, 2026-11-26: **keep iPad support**, so both sets are needed and Apple reviews on an iPad too) —
   6.9-inch iPhone (1320 × 2868 or 1290 × 2796) and 13-inch iPad (2064 × 2752 or 2048 × 2732; the Simulator's "iPad Pro 13-inch"
   gives it): dashboard, route map, delivery board, Add receipt / camera, Team Location. No real customer names or people's
   locations — use the App Review login. Check the sizes against what App Store Connect accepts. Sign in once on an iPad (or the
   Simulator) first: the native sign-in and consent screens haven't been seen there.
7. **Build 14+:** bump `ios.buildNumber` in `mobile/app.json` for every upload; then `cd mobile && npx expo prebuild` and archive in
   Xcode (Product → Archive → Distribute → App Store Connect). `mobile/ios` is generated, not committed.

## Distribution and the account
- ▶ The account is an **individual** developer account. For an **unlisted** app (staff only) use Apple's unlisted
  app distribution request form after the first build is in App Store Connect — check Apple still offers it to an individual account.
- ▶ **Move to the company account** before people rely on the app: an app on a personal account disappears for everyone if that
  person leaves or stops paying. Get a **D-U-N-S number** for Easy Surfaces (free, days to weeks), enrol the company as an
  **Organization** (two admins), then in App Store Connect start an **App Transfer**. The bundle ID stays; the Team ID changes, so
  push (APNs key) and any associated domains are redone under the new team. This takes the longest, so start it now; it can run
  while the app is in review (Apple won't transfer an app with a version waiting in review).

## What the app asks the phone for (`mobile/app.json`)
Camera, photo library, Face ID, location when in use and **Always**; background modes `location` and `remote-notification`;
push (`aps-environment`). Apple reads the permission texts, so they say what the app does with each.
`ITSAppUsesNonExemptEncryption` is false. A privacy manifest is at `mobile/ios/EasySurfaces/PrivacyInfo.xcprivacy` (generated).
**Not carried over from the Capacitor app:** universal links (invite links opening the app) — `associatedDomains` isn't in
`app.json`; links open in Safari. Not needed for submission.

## Listing text (edit freely)
- **Name:** Easy Surfaces. **Subtitle:** Sales, deliveries and team. **Category:** Business. **Age rating:** 4+.
- **Privacy policy URL:** `<site>/privacy` (`src/pages/PrivacyPage.tsx`). It says what location is read, who sees it, the 90-day
  deletion, and that a manager can ask the phone for a one-off location with a reason. ▶ Have it read by whoever advises on privacy.
- **Description:** Easy Surfaces is the working app for our staff. Sales teams plan visits and routes, log visits,
  scan business cards and upload receipts. Delivery and operations teams run the schedule, check-ins and daily reports. Staff whose role includes it share their location during
  work hours so managers can see where the team is.
- **Keywords:** stone, slabs, quartz, deliveries, sales, route, inventory.

## App Privacy ("nutrition label") answers
Tracking: **No**. Data linked to the user, all for **App Functionality**: Contact Info (name, email); **Precise Location** (work
hours, background; and a one-off when a manager asks); Photos or Videos (only ones the user takes or picks); Other User Content
(notes, files, receipts, signatures); User ID; Device ID (push token); Usage / Diagnostics (sign-in and last-active times, battery
level and low-power state sent with the location heartbeat). Financial info: receipt amounts and card IDs are business expenses
the user enters; answer **Purchases / Other Financial Info** if Apple's wording covers it. No advertising use.

## Notes for App Review (paste into the review notes)
> Easy Surfaces is a private business app for the staff of Easy Surfaces, which does business as Easy Stones. It
> shows our web application inside the app and adds native features: a native sign-in with Face ID, a location consent screen,
> background location collection, camera capture for receipts / business cards / slab tags, and push notifications. It is
> distributed unlisted.
>
> **Staff demo:** ▶ username / password. After sign-in the app shows a consent screen; accepting triggers iOS's location prompt.
> Choose "Allow While Using", then "Change to Always Allow" when iOS offers it. Location is read in the background only between
> 7 AM and 6 PM on the user's workdays, for the user's manager (managers see their team's location and last-seen time; the user's
> own record of when they agreed is kept). Background location is essential to this feature, and it stops outside those hours.
> In addition, an authorised manager can request one location reading outside work hours, with a written reason that is logged;
> this is stated in our privacy policy. The user can switch location off in iPhone Settings at any time.
> Camera is used to photograph receipts, business cards and slab tags. Push is used for admin messages and
> receipt reminders.

## Risks to know
- **Guideline 4.2 (minimum functionality)** — Apple can reject an app that is mainly a website. The native sign-in, consent screen,
  background location, camera and push are the answer; the review notes lead with them. A second review round is normal.
- **Guidelines 5.1.1 / 5.1.2 (location consent)** — the in-app consent text (version 4) says location is used during work hours but does
  **not** say managers see it or that a manager can request a reading outside work hours (the owner chose that wording on
  2026-11-23); the privacy policy and these notes do say it. If App Review or HR objects, restore the longer wording
  (`consentBody`, bump `CONSENT_VERSION`); everyone is asked again.
- **Background location** can still be stopped by iOS if the person force-quits the app (the geofence may restart it; unproven) or
  turns location off. Locate now outside 7–6 waits until the app is next opened.
- The app needs a connection to open (no offline mode).
- Android is not part of this submission (needs Firebase push, a Google Play background-location declaration and a real-phone
  test — `docs/ANDROID_LAUNCH.md`).
