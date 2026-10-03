---
name: home-location-filters
description: "Home (\"parent\") location per user + one shared location filter on every screen — the user's decisions (2026-10-03)"
metadata:
  node_type: memory
  type: project
  originSessionId: 4b0b0400-85ea-4a12-98f7-413a8a47b326
  modified: 2026-10-03T20:35:05.722Z
---

Every user has a home location (User.location), set only by admins in Users & Roles; every location filter opens on it and lets them switch to their other locations. Decisions the user made on 2026-10-03:
- Keep "All locations" as an option in every filter (just not the default).
- Each screen remembers its own pick separately (Delivery Schedule and Sales Visits do NOT switch together).
- Admin sets the home location; users can't change their own.
- Look (user's request, 2026-10-03): every tab uses the Check-In Log's round filter-icon button, with the location choice INSIDE its Filters panel — not a dropdown in the toolbar. Check-In Log puts the shared `LocationField` inside its existing Filters panel.
- One reusable filter everywhere (`src/components/shared/LocationFilter.jsx` + `useLocationFilter.js`, rules in `src/utils/locationFilter.js`) — don't build a new location filter per screen.
- Lost Sales: limited to the user's assigned locations (screen and server).
- Inventory: opens on home, multi-select so they can add other locations; still offers every branch.
- Drivers don't get the Delivery Schedule location filter (their view is their own stops).

Built on branch `feat/home-location` (from `feat/shared-pagination`), committed and pushed 2026-10-03; not merged to main yet. `scripts/fix-home-locations.js` (dry run by default, `--apply` to write) must be run against live data once deployed.

**Why:** managers with several branches were seeing every branch's drivers/visits mashed together.
**How to apply:** any new screen with a location filter uses LocationFilter + useLocationFilter; ask before re-opening the decisions above. Related: [[customer-list-redesign]].
