# Easy Surfaces iOS app — App Store checklist

The app is the live site in a Capacitor shell (`ios/`, `capacitor.config.ts`). Written 2026-11-19 on
`feat/ios-app`; check each item against Apple's current rules when you reach it. **Owner steps are marked ▶.**

## The order that is fastest
1. ▶ **Enrol as an individual** (decided 2026-11-19): developer.apple.com/programs/enroll with your Apple ID, ID check, $99/yr; usually approved in a day or two. The seller name on the listing is then your personal name. A company (D-U-N-S) account can be switched to later by an app transfer; the bundle ID stays.
2. ▶ Install **Xcode** (App Store). Run the app on your own iPhone with a free Apple ID (7-day install) to test.
3. Apply migration `0017_location_tracking` (`npm run pg:migrate -- --apply` on Render) and merge to `main`
   (the app loads the live site, so the website must already have these changes).
4. After approval, in Xcode: sign in, pick the team, set the bundle ID. Then send me the **Team ID** (universal links) and, for push, an APNs key.
5. Upload a build (Xcode → Product → Archive → Distribute) to **TestFlight**; staff try it.
6. Staff and suppliers can use **TestFlight** meanwhile. ▶ For a permanent install, ask Apple for **unlisted app distribution** (their request form) — check that Apple offers it to an individual account — then submit for review.

## What the build needs (done unless noted)
- App icon and launch image: `node scripts/make-ios-icons.ts`. ▶ Replace `public/favicon.png` with a larger copy of the logo
  mark before submitting (the current one is 156 px tall, so the 1024 px icon is soft), then re-run it.
- Bundle ID `app.easysurfaces` (owner's choice 2026-11-19; it can't change after the first upload).
- Permission texts are in `ios/App/App/Info.plist` (camera, photos, location when in use, location always). Apple reads them.
- Privacy policy page: `/privacy` on the website (`src/pages/PrivacyPage.tsx`). ▶ Have it read by whoever advises you on privacy.
  Its address goes in the listing as the Privacy Policy URL.
- Not done: universal links (invite links opening the app) and push notifications — both need the developer account.

## Listing text (edit freely)
- **Name:** Easy Surfaces. **Subtitle:** Sales, deliveries and suppliers. **Category:** Business. **Age rating:** 4+.
- **Description:** Easy Surfaces is the working app for our staff and suppliers. Sales teams plan visits and routes, log
  visits and scan business cards. Delivery and operations teams run the schedule, check-ins and daily reports. Suppliers
  upload bundle photos for their purchase orders in their own language. Staff whose role includes it can share their location
  during work hours so managers can see where the team is.
- **Keywords:** stone, slabs, quartz, deliveries, sales, supplier, route, inventory.
- **Screenshots:** the required iPhone size (currently 6.9-inch). Take them from the Simulator once it runs: a customer profile,
  the route map, the delivery board, the supplier portal, and the Team Location page.

## App Privacy ("nutrition label") answers
Tracking: **No** (nothing is used to track people across other companies' apps or sites). Data collected and linked to the user,
all for **App Functionality**: Contact Info (name, email); Precise Location; Photos or Videos (only ones the user takes or picks);
Other User Content (notes, files, signatures); User ID; Identifiers/Usage (sign-in and last-active times). No advertising use.

## Notes for App Review (paste into the review notes)
> Easy Surfaces is a private business app for the staff and suppliers of Easy Surfaces, which does business as Easy Stones; it is submitted under the account holder's name and the listing is unlisted. Sign in with the demo accounts
> below. The staff demo has location sharing turned on: after sign-in the app shows a consent screen explaining that location is
> read in the background, 7 AM–6 PM on workdays, for the user's manager; accepting then triggers iOS's location prompt.
> Background location is essential to this feature: managers use it to see where reps and drivers are during the workday. It
> stops outside those hours and the user can switch it off in Settings. The supplier demo account opens the supplier portal.
> Camera access is used to scan slab tags, receipts and business cards and to photograph material bundles.
>
> Staff demo: ▶ username / password (create one with a role that has Share location and a few pages).
> Supplier demo: ▶ email / password (create one supplier login with a sample PO).

## Risks to know
- Apple can reject an app that is only a website (guideline 4.2). The camera, consent screen and background location help;
  the review notes above explain why. A second review round is normal.
- The shell needs a connection to open (no offline mode).
- Background location can still be stopped by iOS if the person force-quits the app or turns location off.
