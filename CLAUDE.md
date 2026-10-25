# Easy Stones Website

Live app with real users (sales/delivery/admin staff). Regressions in shared
components silently break screens far from the one being worked on — this
file exists to stop that class of bug from recurring.

## Known open issues live in `KNOWN_ISSUES.md`

Bugs that have been found but not fixed yet are tracked in
[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md). Check it before working on an area it
lists (currently transfers and the Daily Work Report), don't fix entries in it
unless asked, and when a fix lands move the entry to its **Fixed** table with
the commit.

## Shared components: audit every usage before changing rendering behavior

`src/components/shared/**` (`CustomSelect`, and anything else reused across
tabs/modals) is used inside many different containers: plain pages, scrolling
sidebars, and stacked modals. A change that fixes the screen you're looking
at can silently break the component everywhere else it's mounted, because
those call sites aren't visible from the one diff you're testing.

**Before changing how a shared component renders, positions, or stacks**
(anything touching `createPortal`, `position`, `z-index`, `overflow`, or
event listeners like click-outside):

1. `grep -rn "<ComponentName" src/` to list every place it's used.
2. Check what container each usage sits in — a modal, a scrollable panel, a
   sticky header — not just the one you're editing.
3. If the change affects stacking (`z-index`) or clipping (`overflow`),
   re-check it against `grep -rn "z-index" src/**/*.css` — see the incident
   below for why.

## Pagination: one component, one flow, everywhere

Every paginated list uses `src/components/shared/Pagination.tsx` with its page
state from `usePagination()` in `src/components/shared/paginationConfig.ts`.
Rows per page is always **25 / 50 / 100, default 50** (`ROWS_PER_PAGE_OPTIONS`,
`DEFAULT_ROWS_PER_PAGE`) — the component no longer accepts custom options.
Changing rows per page goes back to page 1; changing a search/filter/sort
calls `resetPage()`. Pass `totalCount` so the bar shows "Showing 1–50 of 312".
The look (numbered pages with "…", Rows select on the right) came from the
Customer List design, which the user preferred over the old "Page n of T" bar.
On phones (<600px) the same pager shows only the page numbers, centred,
after the last card and scrolling with the list — never pinned to the screen,
and with no box of its own. A screen whose list scrolls inside a panel must
let the pager scroll with it on phones (see the end of `src/features/checkin/log/CheckInLogPanel.css`).

When adding a list, don't hand-roll a pager or a different size set (the
Customer List had its own until 2026-10-03). Check the server endpoint's
`limit` cap allows 100 before wiring it up. If the page lives elsewhere (e.g.
the URL, like the Customer List's `?p=`), keep your own state but start at
`DEFAULT_ROWS_PER_PAGE` and reset to page 1 on a size change.

## Customers: one API, one dropdown list

Every customer route is under `/api/customers` (2026-10-06): create `POST`,
edit `PUT /:id`, delete `DELETE /:id`, the Customers page list `GET /list`
(+ `/cities`, `/view-counts`, `PATCH /bulk`, `POST /possible-duplicates`),
password reset `PUT /:id/password`, active/inactive `PATCH /:id/active`,
import and duplicates `/import/*`, `/duplicates/*`. The old addresses
(`/api/sales/customers`, `/api/partners…`, `/api/admin/customers…`) still
answer as aliases until cached apps update — see KNOWN_ISSUES.md's Cleanup
due. Don't add a customer route anywhere else: the cache-busting middleware
in server.js matches on the path, and a create living at
`/api/sales/customers` is why new customers didn't show in the dropdown for
ten minutes. **Bulk delete** (2026-10-17, the Customer List's selection bar,
Delete switch only) is `POST /bulk-delete` + `/bulk-delete/undo`
(`src/routes/customerBulkDelete.js`, tested): every customer is saved whole to
`customerdeletebackups` before it's removed, and Undo restores it under the
same id so what points at it by id finds it again. Above 10 the confirmation
asks for the count to be typed (`src/utils/customerBulkDelete.js`). What a create/edit may write is `src/utils/customerRecord.js`
(never password, login state, the map point or the rep's name).

Every customer dropdown reads the one shared list,
`useCustomerOptions()` in `src/api/customerOptions.ts` (or SalesPage's
`customerOptions`, which is the same list), shaped by
`src/utils/customerOptions.ts`: the name rule, A–Z sort, the city under the
name, and search by name/city/contact. A new customer dropdown uses those —
don't map `/api/customers/dropdown` by hand again.

## Sales reps: one rule, one list

Who can be picked as a sales rep is decided once, in `src/utils/salesReps.js`
(2026-10-10): `isSalesRep` (sales_rep, manager, director, admin — never the
shared `admin` login, drivers or CSRs). The customer rep picker and Customer
List filter use `toSalesRepList` (by id; deactivated reps kept, marked, for
filtering — the Add/Edit customer form offers them only when already set).
Every dropdown that saves a rep's **name** — Selection Sheet (the visit's
branch), Delivery (your branches), Location's sales person (any branch) —
uses `useSalesRepOptions()` in `src/api/salesRepOptions.ts`, built on
`salesRepNameOptions`: active reps only, A–Z, and whoever is already saved
stays at the top. A new rep dropdown uses those; don't filter
`/api/salesreps` by hand again.

Every rep dropdown and filter also **looks** the same (the Customer List
filter's format, the user's call 2026-10-10): a search box, None /
Unassigned first, then reps under a heading for their branch (branches and
names A–Z, "Other" last) with you marked "(you)" — `groupRepOptions`. On a
form that's `src/components/shared/form/RepPicker.tsx` (not FormPicker);
the Customer List filter and the Route Planner's rep filter render the same
groups. A new rep dropdown or filter uses these.

Something **new** at a branch starts with a rep by one rule too,
`startingRepFor`: the person creating it if they're a sales rep, else that
branch's **Sales person** (Users & Roles → Locations → Sales defaults; staff
read it as `defaultSalesRep` from `GET /api/admin/locations`), else what
the screen did before. New customers and deliveries get it on the form
(`useStartingRep()`), new check-ins from the server when they're logged
(so the Selection Sheet opens with a rep). It never replaces a rep someone
already set or picked. **Paused for check-ins since 2026-10-12** (owner's
request): `NEW_VISITS_START_WITH_REP = false` in `src/routes/checkIn.js`, so
new visits and their Selection Sheets start with None until it's set back
to `true`; customers and deliveries still use the rule.

## Locations: one dropdown, one order (2026-10-17)

Every single-choice location field and filter is
`src/components/shared/form/LocationPicker.tsx` (the user's call): the
blank choice ("All locations" on a filter, None where a form allows it), the
home location marked "· Home", then every other location A–Z, with a search
box from 8 choices — `orderLocations` / `matchLocations` in
`src/utils/locationFilter.js`. It's in every Filters panel (LocationFilter's
`LocationField`, the Check-In Log's own panel), the customer, delivery
transfer From/To, freight, cart checkout, Location RDC and lost-sale forms,
the staff check-in page and the QR modal. Checkbox lists (Inventory, Users'
Locations, the Customer List filter, the import's branch mapping) and the
Daily Report's route cells keep their own controls but use `orderLocations`
(the route cells put the report's own branch first). A new location dropdown
uses LocationPicker; don't build a location `<select>` or FormPicker again.
Its list floats inside its field (never portaled), and it scrolls only
itself to keep the highlighted row in view — `scrollIntoView` scrolls `body`
too (it's a scroll box, index.css), which jumped the page when it opened.

## Dates: one calendar, one folder (2026-10-17)

Every date, month and year field is `src/components/shared/calendar/` (the
user's call; design in the claude.ai artifact **Calendar picker canvas**,
https://claude.ai/artifact/5kTECs8HvXNyPAnHTMHg3a): `DatePicker`, `MonthPicker`,
`YearPicker` and `DateTimePicker` in `Calendar.tsx`, the look in `Calendar.css`,
every date rule in `calendarDates.ts` (tested). Values are plain strings
(`YYYY-MM-DD`, `YYYY-MM`, `YYYY`, local `YYYY-MM-DDTHH:mm:ss.000`) and
`onChange` gets the string, not an event. **Never use a native
`<input type="date|month">` or build a picker by hand**, and don't do a
picker's date arithmetic (shift a day/month, clamp the 31st, name a month)
elsewhere — add it to `calendarDates.ts`. A calendar bug is in those three
files. The week starts on Monday (`WEEK_STARTS_ON`, matching the Delivery
Schedule board). The popover floats inside its field (never portaled — the
CustomSelect incident) and falls back to a bottom sheet on phones, or on
desktop when the box around the field (modal body, scrolling panel) has no
room (`choosePlacement`), so check a new use inside a short modal. Don't wrap a
picker in a `<label>` (a click inside the open calendar is forwarded to its
button and closes it) and don't put `overflow: hidden` on an ancestor of a
bare picker (the Daily Report's `.dr-datenav` lost its). A screen on a branch's
clock passes `today` (holds). The Check-In Log's Filters panel uses a
`MonthPicker` (sets month + year) and a `YearPicker` (clearing the year clears
the month). Not done: typing a date straight into the field (it was possible
with the native inputs).

## Phone tab bar (2026-10-18)

Under 640px SalesPage shows a bottom tab bar instead of the drawer
(`src/components/sales/PhoneTabBar.jsx` + `.css`; owner's design: claude.ai
artifacts **Phone tab bar canvas** https://claude.ai/artifact/Qxs7fJxBs6MGJYiXowkirQ
and **Phone menu search** https://claude.ai/artifact/GZ622Er9juw3MXzr6JjySA).
Dashboard · two modules (Sales, Operations by default) · **More**. What sits
on the bar, which tab is lit and what the page search finds are in
`src/utils/phoneNav.ts` (tested): the bar takes the first two modules the login
can open in the admin's Side Nav Order and More lists the rest, so a new page
or module in `navPins.js` shows up with no phone-specific change (its icon goes
in `src/components/sales/navIcons.js`, shared with the desktop rail). Customers
lives only inside Sales. More = account row (profile, cart, theme, sign out),
a search box for pages, Pinned, then the other modules; pins are still set on
desktop. Tablets and desktop keep the rail and the drawer. The bar sets
`body.has-phone-bar` (hides every page's drawer menu button —
`.sidebar-toggle-btn` and the Dashboard's `.dashboard-sidebar-toggle`; a new
page's own menu button needs adding there) and `body.phone-bar-up` while it's
on screen (`.sales-container` ends above it); it steps aside while a text box
has the keyboard. Its
z-index (96–98) is below every form, modal and the cart, so those cover it.

## Check In permissions: one card, one file (2026-10-14)

Check In, the Check-In Log and the Selection Sheet share one Users & Roles
card, **Check In**, with three sections: Check In (`create_checkins` — the
Check-In button, the staff `/checkin` page, saving a check-in and its phone
autofill; `view_checkin_qr`), Check-In Log (`view_checkins`,
`manage_checkins` = edit visitor details, `delete_checkins`) and Selection
Sheet (`edit_selection_sheets`, `send_checkin_email`). Every key, its section
and the rules live in `src/utils/checkInAccess.js`; the routes, the screens,
the side nav and the card all read it, never a hand-typed string. A save to
`PUT /api/checkin/:id` needs the switch for what it changes
(`missingEditPermission`: details vs. sheet fields). **A new permission for
any of these screens goes in that file, under its section** — the card is
built from it, and `checkInAccess.test.js` fails if a key has no switch or
lands on another card. Kept the old key names (stored on every role);
`CHECKIN_MIGRATION` gave both new keys once to every role holding
`manage_checkins` (owner's call: everyone keeps what they had). The
**Kiosk** role (seeded if missing, not a system role) holds only
`create_checkins`: a front-desk tablet's login. Anyone who can check in but
open no Sales page (`isCheckInOnly` in `navPins.js`) is sent from `/sales`
and `/` to `/checkin`, and the header hides its Sales link.

## No route answers "any login" (2026-10-14)

`authenticate` also accepts **website customer** logins (permissions `[]`)
and check-in-only ones (Kiosk), so a route with only `authenticate` /
`verifyAnyAuth` / `verifyToken` is open to them. Every Sales route needs a
permission check. A list many screens share (customer dropdown,
`/api/salesreps`, product admin and uploads, the ZIP lookup) uses
`requireSalesPage` — staff with at least one side-nav page (`hasSalesPage`
in `navPins.js`). Lost Sales uses `lostSaleAccess.js` (the screen's own
rules, shared with the server), the Dashboard's team resources need
`view_dashboard`, and a customer's quick note `view_customers`. Left open on
purpose: `/api/admin/locations` (already trimmed for non-managers; the
check-in page needs it), `/api/user/me`, change-password, the pinned-tabs
and route-planner-filter routers (the user's own data).

## Staff sign-in: temporary passwords and invites (2026-10-15)

Staff sign in on `/login` (the one door; `/admin/login` still works). A
**temporary password** (Add / Edit user) gets only a **setup session**: a
30-minute token signed with a key *derived* from `JWT_SECRET` and a cookie
scoped to `/api/auth`, so no other route or token check can accept it — keep
it that way rather than adding "refuse setup tokens" checks elsewhere. The
app opens on "Choose your password" (`ChoosePasswordPage`, shown by
`ProtectedRoute`), and saving it signs them in for real. Temporary passwords
expire after 7 days. An **invite link** (`/set-password?token=…`; old links say
`/admin/set-password`) works once, and saving it signs them straight in. Both
use `ChoosePasswordCard`. Every password change — their own, a first
password, an invite, an admin reset — bumps `sessionVersion`, which every
staff token carries as `sv` and `authenticate` checks, so older sessions end.
`authenticate` also refuses any account still on a temporary password. The
rules live in `src/services/staffSession.js`, the routes in
`src/routes/userOnboarding.js`; a new way to sign in or set a password goes
through them. Five wrong passwords lock an account for 15 minutes
(`User.incLoginAttempts`); Users & Roles and `/admin` badge it "Locked"
(`lockedUntil` in `src/utils/userForm.js`), Edit user → Sign-in has **Unlock
now** (`POST /api/admin/users/:id/unlock`, `manage_users`), and any password
reset or chosen password also lifts it (`clearSignInLock`).

## Users, Roles & Permissions, Locations; team access (2026-10-16)

Users & Roles is three Admin-rail pages (`users`, `roles`, `locations` in
`navPins.js`; one screen, `UsersRolesTab`, with a `section`). Users also opens
for **team access**: the `manage_team_users` permission (Users & Roles card →
Team) lets a manager/director see the people at their own locations, who is
online, and **deactivate / reactivate / unlock** them — nothing else (no add,
edit, delete, passwords, Roles, Locations; those stay `manage_users`). Which
people: the role's `manageableRoles` (Roles & Permissions → "People … can
manage", chosen per role by an admin), only those whose locations are **all**
the manager's, never themselves or an admin. Rules in `src/utils/teamAccess.js`
(shared), the guard in `src/services/teamAccess.js`; the Users list, presence,
active and unlock routes use `usersAccess` / `memberAllowed`. A new Users
action for managers must go through them. Nobody holds the permission until
an admin turns it on.

**One permission per action (2026-10-16).** Every Users & Roles action has its
own switch (`src/utils/usersAccess.js`: view/add/edit/reset sign-in/
deactivate/unlock/delete users; view/edit/add/delete roles; view/add/edit/
delete locations; side nav order), on the Users & Roles card in sections.
`manage_users` is now **Full access**: it holds every one, so existing roles
lost nothing. Any action in an area opens that area's page and loads its list
(no separate "view" needed). Routes use `requireAction(key)` /
`requireArea(area)` / `usersAccess(key)` (`src/services/teamAccess.js`), never
a hand-typed `requirePermission('manage_users')`; screens use `can(user, key)`.
A new Users & Roles action goes in that file's `USERS_ROLES_SECTIONS` (the
card is built from it; `usersAccess.test.js` fails if a key has no switch).
Left on `manage_users` on purpose: the Delivery Schedule's column arranging.

## Who is online (2026-10-16)

Users & Roles → Users list has an **Online** column, a live "Online now (N)"
filter and "Last seen …" for people who are away. Every signed-in tab opens a
socket (`PresenceReporter` → `src/api/presence.ts`) that says who it is
(`presence_hello`, a staff token only — customers are refused) and, at most
once a minute while the mouse/keys/touch are used in a visible tab,
`presence_active`. The server keeps the list **in memory**
(`src/services/presence.js`: one entry per tab, **Active** until 10 minutes
without activity, then **Idle**; device from the browser's User-Agent) and
pushes it (`presence_update`) only to sockets whose user has `manage_users`;
`GET /api/admin/users/presence` is the first load. `lastSeenAt` (written at
most every 5 min while online and on the last tab closing) and `lastLoginAt`
are on the User record. One server instance only — two would each hold half
the list. A phone's background tab disconnects, so it shows "Last seen". The
display rules are `src/utils/userPresence.ts`.

## Permits: sources and the accuracy rules (2026-10-11; King County 2026-10-14)

Sales · Permits (`src/permits/`) pulls building permits each morning from 20
offices in King, Snohomish and Whatcom counties. **One file per source** in
`src/permits/rules/` (who it is, its county, its exact lead type names, how a
record copies) plus a reader in `src/permits/sources/`, listed in `RULES`
(`permitRules.js`) and `readers.js` under the same id. `sync.js`, the API and
the screen are generic over them — adding an office is a rules file, a
reader and tests (`rules.test.js` checks every source keeps the contract).
The county filter lists all 39 WA counties (`places.js`); a county is
"covered" once a source names it.

- **Whatcom**: the county (Tyler EnerGov, contacts with phone/email) and
  Bellingham (ArcGIS layer, names only). The EnerGov search **ignores its
  date/type filters**, so the reader walks newest-issued-first.
- **King**: the county outside cities and Auburn, Bellevue, Burien, Issaquah,
  Kenmore, Kirkland, Mercer Island, Sammamish, Snoqualmie through
  **MyBuildingPermit**'s public search (no published API — the calls its page
  makes; it refuses big searches, so a week at a time, split down to a day,
  then by status; a row outside the asked days stops the run; its "to" date
  is midnight, so only offices that stamp a time of issue — Kirkland,
  `stampsTime` — are asked a day further, and a timed row from a midnight
  office stops the run); Seattle (open
  data + each permit's portal page for the contractor's license); Renton
  (EnerGov, same reader as Whatcom); Shoreline (eTRAKiT's CSV export, a day
  at a time, 100-row cap → fails loudly). Bellevue's own ArcGIS layer lags
  on status (new homes "Pending" for days after issue), so its list comes
  from MyBuildingPermit and the layer only adds value/owner/units per permit.
- **Snohomish** (2026-10-20, on `feat/snohomish-permits`): the county outside
  cities, read from its own monthly **Issued Residential / Commercial Permits**
  spreadsheets (`snohomishcountywa.gov/Archive.aspx?AMID=132` / `133`, no
  login; rules `rules/snohomishCounty.js`, reader `sources/snohomishCounty.js`).
  The PDS Permit Portal (Amanda) was checked: its public search only finds one
  permit by number or address (it's for scheduling inspections), so it's the
  "Look it up" link, not a source. Each file holds only its own month (a row
  from another month, a missing column or a non-spreadsheet stops the run), is
  posted around the 1st of the next month, so permits are up to a month
  behind. The applicant (name, company, mailing address) is the only contact —
  no phone or email; the report's `PDS_Contact_*` columns are the county's own
  staff and are never copied. Trade, land-disturbing and sign reports aren't
  read. My defaults on categories: duplex/townhouse → Multifamily, guesthouse
  → Other building, repairs/outbuildings/decks/foundation-only skipped. **The
  county's page says the data may not be used commercially** (RCW
  42.56.070(8)); the owner chose to use it for leads anyway (2026-10-20). Its
  cities sit under the same county filter (`county: 'snohomish'`): **Edmonds**
  through MyBuildingPermit (`rules/snohomishCities.js`, stamps a time of issue),
  and **Marysville** through its open eTRAKiT search
  (`rules/marysville.js`) — Shoreline's reader with Marysville's export columns
  (`createShorelineSource({ label, columns })`); contractor/applicant names,
  job value and description, no phone. **Monroe** reads the city's monthly "Issued Permits Report"
  spreadsheets (`rules/monroe.js`; the page lists only the last few months; a
  permit's valuation lines are added up; contractor phone is in the report) and
  the **City of Snohomish** (`snohomish_city`) reads its Tyler EnerGov site
  through the same reader as Renton in `modern` mode (newer EnerGov: the
  permit and its contacts are separate calls, names only, no phone).
  **Not covered yet** (checked 2026-10-21): Everett (eTRAKiT, login needed —
  my one scripted sign-in with the owner's account was refused, cause unknown),
  Lynnwood and Mukilteo (SmartGov Community portals; Lynnwood's public
  "Issued Permits By Department" report is at `/Public/ReportsView` but I
  couldn't get its form to open by script), Arlington and Stanwood (iWorQ,
  blocks scripts), Lake Stevens (Bitco PermitTrax, script-driven app), Mill
  Creek (OpenGov), Bothell (MyBuildingPermit has only inspections), Sultan
  (MyGov), and Mountlake Terrace, Brier, Granite Falls, Gold Bar, Darrington,
  Woodway (nothing public found). The month-so-far check is a re-read of the
  same report (no second source exists) and finds nothing until the month's file is out.
- **Skagit** (2026-10-21, on `main`): the county outside cities,
  Tyler EnerGov (`rules/skagitCounty.js`, the Whatcom/Renton reader, tenant
  `skagitcountywa`; contractor/owner/applicant with phone and email — an all-zero
  phone is dropped as a placeholder). Leads: Single Family Residence and Modular
  Building → New home, ADU, Residential Addition/Alteration, Duplex/Townhouse →
  Multifamily, Commercial New/Alteration/Addition. **Skipped by the owner's call:**
  accessory buildings/structures (shops, garages), manufactured homes, and trades.
  No monthly report exists to check against, so the month-so-far check is a second
  read of the same search. The county's data has one flood permit dated 2028.
  **Anacortes** (2026-10-22, `rules/anacortes.js`, `sources/anacortes.js`): the
  city's SmartGov portal publishes an **"Issued Permits with Valuation"** report
  (Reports page, no login) — an Exago report that asks for a Date Issued range. The
  reader runs it the way the page's own scripts do, **with no browser**: post the
  portal's form for the report (redirects into `reports-new.smartgovcommunity.com`),
  read the start-up settings from its page, then `wrajax/*.ashx` calls
  (`BaseExecuteCtrl.LoadCallback` → `StartExecute` with the filter string
  `Permits.Date Issued|^|bt|^|from|~|to|…` and export type `csv` → `GetStatus` until
  done → `TransmitExecution` → `ExecuteExport.aspx?eid=…`, a CSV). The range's end is
  midnight and leaves out its own day, so it asks to tomorrow; a row outside the
  window, a missing column or a non-CSV stops the run. If the city or Granicus
  changes that page, the run fails loudly and this is the first place to look. The
  report has the type and address in one cell (types are matched by the city's exact
  names), the applicant's name and the contractor's *name* — no phone or email (the
  WA L&I lookup supplies phones by contractor name), a value, no status. Leads:
  Single Family Building → New home, Cottage Unit and ADU → ADU (my default for
  cottages), Remodel with new sq ft → Addition, without → Remodel, Commercial Tenant
  Improvement → Commercial remodel, the broad "Commercial" → Other building; trades,
  re-roofs, siding, fences, decks, garages/accessory structures, solar, signs,
  right-of-way and land-use applications are skipped. About 100 permits and 10 leads
  a month. The month-so-far check is a second read of the same report.
  **Not covered** (checked 2026-10-21): Mount Vernon (SmartGov, no public reports —
  the city could publish one like Anacortes has), Burlington (email applications),
  Sedro-Woolley (paper), the small towns.
- **Pierce** (2026-10-22, on `feat/pierce-permits`): the county outside cities, from
  the county's public ArcGIS layer `Permits_Pierce_County` (fed from PALS+;
  `rules/pierceCounty.js`, reader `sources/pierceCounty.js` on the shared ArcGIS
  reader). Type, status, valuation, units, sq ft, address, description and a link
  to the permit — **no contractor, owner or applicant**, so no contacts and no
  registry phones. No city or ZIP (the layer is the county's own permits; its
  cities — Tacoma, Lakewood, Puyallup… — aren't in it and aren't checked yet).
  Same skips as Skagit (garages, decks/sheds, farm buildings, pools, walls, cell
  towers, demolitions); a blank work type or "Replacement Permit" is reported as
  unsorted. About 25 new homes a week. **The county's GIS data terms of use were
  not read** (the PDF wouldn't open) — read them before merging. The
  month-so-far check is a second read of the same layer.
  **Tacoma** (same branch): the city's open-data Accela layer
  (`rules/tacoma.js`, `sources/tacoma.js`), updated daily, one row per permit, with
  an **applicant name** (homeowner, contractor or solar company — it doesn't say)
  and no phone. Its types are broad, so Residential/Commercial **Alteration** is
  filed as Other building (never guessed from the description) and **New
  Building** as New home / Commercial new (a backyard cottage or a 6-unit
  houseplex is a "New Building" too — `units` says). Mechanical, plumbing, fire
  protection, demolitions and every non-Building permit are skipped. The layer's
  dates are midnight UTC, read as UTC (Pierce County's are real times, read as
  Pacific). About 7 new homes a week. No terms of use found on the layer beyond the
  city's open-data disclaimer.
- **Not covered** (no public data, checked 2026-10-14): Kent (login-only
  portal), Redmond (no public search), Federal Way and Bothell (nothing on
  MyBuildingPermit), the smaller cities, and every other WA county.
- **Lead types** are decided by each source's exact type names, never a
  source-side filter. An office that only publishes a broad type
  ("BUILDING", "Building - Residential", Bellevue's BT) files it as **Other
  building** (`building_other`) — never guessed from the description. A
  building type nobody has sorted is reported on the page.
- **Accuracy checks**: Whatcom against the county's monthly PDF; King County
  against its monthly "Issued Permits" spreadsheet (`kingCountyReport.js`,
  which also fills value/city/units, never over the pull's values); every
  source's month so far found a second way (`recheck`, or a second read).
- **Contractor phones**: the WA L&I registry (data.wa.gov `m8qx-ubtq`,
  `contractors.js`) — by license number (MyBuildingPermit, Seattle) or by
  exact business name with exactly one active license. Kept in its own
  collections and shown beside the source's contact, never written into it.
- **Contractor pop-up**: a license number + Enter in the Permits search box
  (or a contractor's name on a permit) opens `ContractorDialog` — the
  registry's license, insurance, bonds and principals read live
  (`GET /api/permits/contractor/:license`), their permits here (the
  `license` list filter, which also covers names the registry matched), and
  "Open customer profile" if they're a customer, else "Create customer",
  which opens the Add customer form pre-filled (`customerPrefillFor`,
  CustomerForm's `prefill`; the registry has no email — one from a permit is
  used when there is one). A save without details never overwrites a
  details-derived field (Bellevue's BB/BM category: `categoryIfNew`).
  The pop-up's design lives in the claude.ai artifact **Contractor pop-up
  canvas** (https://claude.ai/artifact/4PJbcGViAbRqCCb6iqKUkC — desktop,
  tablet, phone, and the customer / expired / saved-copy / not-found /
  loading / error states). It's built on `FormModal`; **any change to
  `ContractorDialog.jsx` or its `.pm-ct-*` CSS also updates that artifact**
  (owner's rule, 2026-10-14).
- First pull per source reads 6 months; then 5:00 AM Pacific daily, re-reading
  30 days (details re-read once a week where `detailsFreshDays` is set).
  Admin-only permissions to start (`view_permits`, `export_permits`,
  `refresh_permits`).

## SPS customer import: one identity, one plan (2026-10-17, on `feat/sps-connect`)

The plan is the claude.ai artifact **SPS Import Redesign**
(https://claude.ai/artifact/BcFNBYMJE9fQz6bxjmMCte); what's built and what
isn't is in KNOWN_ISSUES.md. A customer is an SPS customer by `sps.key` (its SPS
Name, trimmed and lowercased, inner spaces kept — `spsKey` in
`src/utils/spsSheet.js`), and the partial unique index refuses a name held
twice; never write it from a request body (`PROTECTED_CUSTOMER_FIELDS`).
**Connect existing customers** (Customers ⋯ → Connect customers to SPS,
`src/utils/spsConnect.js`, `src/routes/customerSpsConnect.js`) gives today's
customers their key: exact names unasked, the rest by a person. The **new
import** (Customers ⋯ → Import from SPS, `SpsImportModal.jsx`) is five steps
over saved runs (`SpsImportRun` / `SpsImportItem`): the planner
`src/utils/spsImportPlan.js` gives every SPS name exactly one outcome (held
key → update; exact name → connect; deleted before → asked, never silent;
look-alike → "Need a decision" with Add as new pre-set; else new), the plan is
**frozen into items** at Start and written in batches by
`src/services/spsImportRunner.js` (an upsert on the key, so a retry or a
restart never doubles; resumed at server start), then the checker looks every
name up and the run is green only with none missing. Undo needs Delete; an
undo's deletions are saved with source `sps-undo` so the next import doesn't
ask about them. What an import may change: SPS sets the rep (a blank one keeps
ours) and the branch, everything else only fills blanks. The old "Import from
Excel" stays until the new one has had a green real import.

## No site header on the staff screens (2026-10-18)

The site header (`Header.jsx`: Products, Live Inventory, Warranty, Contact,
Login) is the public website's. `/sales` and the staff `/checkin` page don't
show it (`hideHeader` in App.jsx, which puts `no-site-header` on `body`); the
side nav's account menu and the phone tab bar sign out, and `/checkin` has its
own Sales / Sign out row. Live Inventory moved into the side nav (Products,
`live_inventory` in `navPins.js`: a link that opens StoneProfits, never
pinned, never a Sales page). The old standalone `/checkin-log` keeps the
header. **Offsets for the header use `var(--app-header-h)`** (App.css: 82px,
0 without the header) — never a hard-coded 82px, which leaves an empty strip
at the top of every staff screen.

## Route Planner: scoped reps, loaded per rep (2026-10-18)

Who the Route Planner offers is decided once, in `src/utils/routePlannerScope.js`,
by the **locations assigned in Users & Roles** (not role name): admins and
all-location ('*') logins see every rep; anyone else sees the reps working at
their locations (a sales rep gets the same as a manager for now — the owner's
call; narrowing it later is a change to `repsInScope`/`inScopePins` only), their
customers, and the unowned ones at those locations ("Unassigned"). The server
routes live in `src/routes/customerMap.js` (tested, in-memory MongoDB):
`GET /api/customers/map?reps=<ids>,unassigned` sends only the named reps' pins
(reps outside the scope return nothing), `/map/rep-counts` feeds the Filter's
counts, and `/map/:id` returns one customer's contact details (404 outside the
scope). A **pin is slim** — phone, email, address, notes arrive only when a
customer is opened: the panel is the Customers tab's own `CustomerDrawer` (`src/features/customers/list/`)
(**shared — a change to it changes both screens; check both**), which fetches
the full record itself; `/map/:id` is only for a login without Full profile.
What the map adds is `MapActions` in the drawer's `mapSection` slot (last-visit
age, the stop or booking, Add to calendar / Remove / Reschedule, Add visit, Add
resource). The drawer's ↑↓ steps through the day's route stops when the customer
is on a planned day, and is absent otherwise. **Add to calendar** opens
`ScheduleVisitSheet` (a FormModal with the shared DatePicker: Tomorrow / Next
week / In 2 weeks, the first free start that day, what's already booked —
`src/utils/visitSlots.ts`, tested); it books that day, or moves the existing
entry (`PUT /api/schedule/:id`). On a phone the panel leaves a strip of map at
the top (`.cl-drawer.rpv2-host`). Only **checked reps' customers are loaded** (ticking
one fetches just theirs). The Filter reads Sales reps → Customer type → Days since
last visit; pins are map pins coloured by type (set A, `TYPE_COLORS` in
`routePlannerV2/helpers.js`) or by last-visit age (the "Type colours | Visit
colours" switch, saved as `routePlannerFilters.pinColors`). Saved filters load
once and save only on a real change (`saveFilter`) — saving the empty starting
value before the real one loaded is what used to reset the rep ticks on every
open. **Location** (`src/utils/geolocationAccess.ts`): nothing prompts on its own;
the map opens on the last known spot, only a tap on Locate asks, and once the
browser has it allowed the position is followed quietly (only while the screen
and tab are showing). The permission itself is the browser's, not ours to keep.
The phone bar is icons plus a three-line More menu (`MoreMenu.jsx`: Find new
leads, Live traffic — a new map option is another row there). The design lives in
the claude.ai artifact **Route Planner pin colours**
(https://claude.ai/artifact/BQ5XYqB2SjbnbgjLYSbnyh).

## Cart ticks are instant (2026-10-18)

An inventory checkbox shows the slab in the cart the moment it is clicked
(`pendingAdd`/`pendingRemove` in `src/features/holds/cartStore.ts`; `cartKeysOf` is what the
checkboxes read) and the server's answer replaces it — a refusal takes it back with
the reason. Your own change's socket echo is ignored and other people's events are
joined into one refresh of just the slabs that changed (`useSlabLocks`). The cart's
customer also shows at once, and Create hold follows the cart's customer rather than
copying it when it opens. Server: `findSlabs` reads the serial # through a
case-insensitive index (`InventoryItem.js`), and `addToCart` / bundle removal are one
write each. **Every Cart & Holds model is in `INDEXED_MODELS`** — autoIndex is off,
and until 2026-10-18 they weren't, so the unique indexes that stop two holds on one
slab were never created in production (a startup log line names any that fail, e.g.
on duplicates already there).

## Saving a visit: the server decides, the form doesn't wait (2026-10-23, on `feat/visit-save-server`)

Add / edit visit is `src/routes/visits.js` (tested in `visits.test.js`, in-memory
MongoDB; mounted in server.js where the old routes were). The rules are the
server's, from `src/utils/visitForm.js`: the type must be one of `VISIT_TYPES`
(a legacy type already on the visit may be kept on edit), a type with no
follow-up stores none (`cleanVisitFields`), dates are real days. A new visit
carries its own `_id` (`newVisitId()`); a repeat of the same POST answers 200
`alreadySaved` with the visit it has, so the client's retry can't double it. PUT
answers with the stored visit. Photos/PDFs go to `POST /api/customers/visit-attachments`
the moment they're picked (SalesPage `uploadVisitAttachment`) and Save sends
links; a photo whose early upload failed is still sent as data with Save. On Save
the form closes and the visit shows on the customer at once (`handleSaveVisit`);
the request goes behind it, a failure takes the visit back off and reopens the
form with what was typed, and closing the tab mid-send asks first
(`beforeunload`). A photo uploaded and then never saved stays in Cloudinary.

## Code layout: one folder per module, props between them (2026-10-23)

The design and its order are `MIGRATION_NOTES.md` §4 (owner's ask: no more
5,000-line files). New and moved screen code lives in `src/features/<module>/`
(page, `components/`, a `use<Module>Data` hook, `<module>Api.ts`, pure rules +
tests, and an `index.ts` that is the only thing other code imports). Data goes
down as props and changes come back as `on…` callbacks; when one module's save
must show in another, `SalesPage` wires the callbacks — modules never import
each other's internals or reach into the shell's state. Context only for
auth, theme and the toast. Files are split by what they do, not by a line count
(owner, 2026-10-24: no 500-line limit) — one clear job per file, so none is
overwhelming to read; a long file that does one thing can stay whole. A move
changes no DOM, class names or CSS. Each extracted module gets a render smoke
test (`*.test.tsx`, React Testing Library). `server.js` is being split the same
way into `src/routes/<area>.js` routers, checked against a route-table
snapshot so no path, middleware or order changes.

## TypeScript and Node 24 (2026-10-23, on `feat/typescript`)

The plan is `MIGRATION_NOTES.md` §1. Render runs `node server.js` on **Node
24** (owner's go-ahead 2026-10-23; `render.yaml`, `engines`, `.node-version`
pin 24.22.1), which strips TypeScript types itself, so any file may be `.ts`.
What the server loads must be **plain, erasable TypeScript** (no `enum`,
`namespace` or parameter properties — `erasableSyntaxOnly`), type-only imports
written `import type` (`verbatimModuleSyntax`), never `.tsx`, and every import
naming the file exactly, `.ts` included (`import x from './rules.ts'`) — Node
has no extension guessing. `scripts/check-server-ts.mjs` walks what the server
loads and fails on a `.tsx` or an import Node can't find as written (the
missing-`.js` crash of 2026-10-23); `npm run build` runs it first, so on Render
a bad import fails the deploy instead of the live server. `npm run typecheck`
= `tsc` + that check. `.ts`/`.tsx` are strict; JavaScript is read for its
exports but not checked. Shared shapes are in `src/types/` (`Loose` marks a
record not typed yet — a spot to tighten). A shared `.js` file a typed one
imports gets JSDoc types when TypeScript misreads a parameter (`= []` reads as
an always-empty list). A conversion is types only: `git mv`, annotations,
importers updated, no behaviour change; check with typecheck, `npm test`,
`vite build`, and the screen by hand — for a server file also boot `server.js`
(an in-memory MongoDB is enough).

## Forms: one template, everywhere

Every form (add/edit modals, Delivery, Visit, Lost Sale, imports, POD,
profile) follows [`FORM_TEMPLATE.md`](FORM_TEMPLATE.md), approved
2026-10-04. It covers sizes S/M/L and phone, field states, the required `*`,
no helper text, validation banner, saving lock, unsaved-changes check, edit
mode, and light/dark colors. It's built in `src/components/shared/form/`
(Add and Edit User, Add / Edit location, Add / Edit visit, Add / Edit customer, Add / Edit delivery, and the Selection Sheet are on it); move the others onto it one at a time and
re-check each by hand, since every form with a dropdown is subject to the
CustomSelect incident below.

## Incident: CustomSelect portal broke dropdowns inside modals (2026-08-13)

`CustomSelect`'s options popover was changed to `createPortal(…, document.body)`
so it would stop clipping inside a scrolling sidebar (`RoutePlannerTab`). That
fix was correct for the sidebar, but had an unintended side effect nobody
checked for: once the popover is a DOM sibling of `document.body`'s other
children instead of a descendant of the trigger's container, its stacking
order versus modals is decided purely by comparing `z-index` numbers — it no
longer inherits "on top of my modal" for free just by being nested inside it.

The popover's `z-index: 9999` had never had to beat a modal's `z-index`
before. `DeliveryModal`'s overlay was `10000`, so the modal silently painted
over the dropdown — the options were "open" in the DOM, but clicks landed on
the modal, not the option underneath it. Every `CustomSelect` inside every
modal was affected, not just the one that got reported.

Fix: `.custom-select-popover` z-index raised to `2147483647` (the app's max,
matching `.modal-overlay` in `index.css`) — see the comment on that rule in
`CustomSelect.css` before changing it.

**The general lesson, not just the specific number:** a change made to solve
one container's layout problem (clipping, overflow, positioning) needs to be
re-verified against every *other* container the same shared component
appears in, especially modals — not just the container where the bug you're
fixing was noticed.

## Incident: submitting a Daily Work Report wiped its own slabs/transfers (2026-08-28)

The Daily Work Report's Deliveries/Pick-ups slabs and transfer-line slabs are
meant to auto-update from the schedule (`deriveFromSystem` /
`applyDerived` in `src/routes/dailyReports.js`) until a person hand-corrects
one — `capacity: null` means "nobody's counted it yet," and a submitted
report is never re-derived again, since it's the permanent record of what was
true when it was signed off.

A fix for a *different* bug (slabs freezing permanently the first time
someone edited an unrelated field, because autosave PUT the whole report
verbatim) added stripping in the frontend: an untouched derived figure got
blanked back to `null`/removed before every save, so it would keep
re-deriving instead of freezing. That stripping ran on *every* save,
including the one `submitDay` fires immediately before locking the day.
`/submit` never re-derives — it just flips `status` on whatever the last PUT
stored — so the strip-for-drafts logic permanently wiped Deliveries/Pick-ups
slabs and transfer lines off of every report submitted while that code was
live, the instant it was signed off. Several already-submitted Seattle
reports had to be reconstructed from the underlying `Delivery` records by
hand.

**The general lesson:** a transform meant to keep a *draft* editable
(“don't persist this until a human confirms it”) is a different rule from
what a *final, frozen* save needs (“persist exactly what's on screen, because
nothing will ever fill this in again”). Before reusing one save path for both
“autosave” and “finalize,” check whether anything downstream of finalize ever
gets a second chance to fix what was sent — if not, finalize needs the real
values, not the draft's placeholder-stripped ones. The first fix sent the
page's figures verbatim for the save before Submit; since 2026-10-05 `POST
/:date/submit` instead re-derives (`applyDerived`, like the 11:59
auto-submit) before locking, so a sheet left open all day still signs off
the current check-ins and tickets, and every save is a draft save. That is
only safe because `GET /:date` also returns `handSet` (`handSetFigures`):
the slab figures a person saved on an earlier visit, which the sheet seeds
its touched sets from on load. Without it a correction looked untouched after
a reload and the next save (the one before Submit included) blanked it. See
`buildSaveBody`/`buildDraftPayload` in
`src/features/dailyReport/savePayload.ts` and their tests, the page's
load/autosave/submit hook `useDaySheet.ts` (its tests pin the flush on a
day/branch/view change and unmount, Submit stopping on a failed save, and a
late answer ignored), and
`applyDerived`'s tests in `src/routes/dailyReports.test.js` (including
"at submit") for the merge contract those payloads have to be correct
against.

## Automated tests are narrow — most verification is still manual

`npm test` runs Vitest (`vite.config.js`'s `test` block, `src/**/*.test.{js,ts}`).
As of 2026-08-28 that covers the pure, no-DOM business logic in
`src/utils/routePlan.js` and `src/components/sales/routePlannerV2/helpers.js`
(great-circle distance, point-in-polygon, stop ordering/scheduling math,
recency bucketing, small formatting/localStorage helpers), plus the Daily
Work Report's derive/save-payload rules (`src/routes/dailyReports.js`'s
`applyDerived`, `src/features/dailyReport/savePayload.ts`) added
after the incident above, and its payment methods and totals
(`src/utils/dailyReportPayments.js`: ACH, Cash, Credit Card, Check; reports
saved before ACH read it as unsaid), its transfer lines
(`src/utils/transferDirection.js`: one line per transfer with its one
Transfer # — a ticket line per ticket — so the count the month view, its
PDF and the CSV total is the number of lines, never typed; a hand-added
line's direction comes from its route (ending at the report's branch is
Incoming); `transferLineKey`, the per-transfer key a typed slab figure is
kept against, and how a draft saved per route carries over; and the notes
for a repeated transfer number, a route that skips the branch or repeats a
ticket line; the routes, in `src/routes/dailyReportManualTransfers.test.js`), and the customer list's rules
(`src/utils/customerList.js`: status labels, the ⚠ data-quality checks and
the "Incomplete" query that must match them, saved views, A–Z, role-scoped
filter options), the shared pagination sizes/range math
(`src/components/shared/paginationConfig.ts`), and the location-filter rules
every screen's location filter shares (`src/utils/locationFilter.js`: home
location, which branch a filter opens on, remembered picks, and the server's
home-location validation), and who can be picked as a sales rep (`src/utils/salesReps.js`: the role
rule, branches, deactivated and already-saved reps), and Add User's rules (`src/utils/userForm.js`:
username suggestion and format, required fields, temporary passwords, the
Locations/home rule, role summaries), and the Selection Sheet's slab-tag
scanner (`src/utils/stoneLabel.ts`: reading lot/slab/size/material out of OCR
text, rejecting wrong-rotation garbage, and when a lot may be matched to
stock or name the material; `src/utils/tagLine.ts`: what one printed tag line
says, how the tags in one photo combine — lot copies cross-checked, one row
per lot with its slabs together — and which sheet rows they fill;
`src/utils/tagPhoto.ts`: a photo's tilt, the printed line in a strip cut
beside a barcode, and the levelling score). The scan itself
(`src/features/checkin/selectionSheet/readTagPhoto.ts`: barcodes with zxing-wasm, then each
tag's line with Tesseract) is checked by hand on real tag photos — and Add / Edit location's rules (`src/utils/locationForm.js`:
required fields and formats, unique short name/code, which locations can be
an RDC, the record ↔ form conversion the API also runs, what non-managers
may read, and the selection-sheet letterhead with its Kent fallback), and
Add / Edit visit's rules (`src/utils/visitForm.js`: the visit types and
their stored values, which fields each type uses, required fields, the
change count, and the "Last changed by" note), and the Selection Sheet's
rules (`src/utils/selectionSheet.ts`: rows, the change count behind the
unsaved-changes check, the save body with its stale-save
`expectedUpdatedAt`, the escaped print page,
price per SF in cents and when it prints, internal vs printed notes, and
what the server accepts and when it re-emails the rep) plus its save/email
routes (`src/routes/checkIn.test.js`, in-memory MongoDB, including which
Check In switch each route needs), and the Check In permissions
(`src/utils/checkInAccess.js`: the sections, the Users & Roles card built
from them, what a check-in save needs, the migration) and Lost Sales access
(`src/utils/lostSaleAccess.js`), and the email's
contents (`src/services/emailService.test.js`),
and Add / Edit customer's rules (`src/utils/customerForm.ts`: stored option
values, new-customer defaults, record ↔ form mapping, required fields, the
email/marketing-email sync, the change count, and what a business-card scan
fills in), and the Delivery form's packing-list reader
(`src/utils/packingListPdf.js`: reading packing list #, Bill To / Ship To,
the order row and the slab count out of a StoneProfits packing list PDF, and
which empty form fields an upload fills — Sales Orders, Pick Tickets and
Invoices read the same way), and Add / Edit delivery's rules
(`src/utils/deliveryForm.ts`: which fields each delivery type uses, Pending
vs. a required date, the driver list with each truck's load and the full
ones greyed out, a 3rd-party truck's optional carrier / BOL / agreed price,
transfer checks, the change count, and the save body), and the customer
write rules (`src/utils/customerRecord.js`: what a create/edit may write,
defaults, the placeholder email, protected fields) and dropdown rules
(`src/utils/customerOptions.ts`: name, address parts, sort, search), and
the Check-In Log's branch clock (`src/utils/checkInClock.js`: which day and
month a check-in belongs to on its own branch's clock, the per-zone query the
list's month filter and counts use, and the date/time/"Today" shown and
exported), and the Check-In Log's exports (`src/utils/checkInExport.js`: the
Excel rows, the PDF's filter line, link and row cap; `src/utils/checkInLogPdf.js`:
that the PDF builds, pages, and survives characters its font lacks), and the
3rd-Party Freight screen's rules (`src/utils/freightView.ts`: its tabs and
counts, charges grouped by carrier, what a selection offers — Approve,
Approve & pay, Mark paid — and why not, payment wording and the Excel rows),
and the Delivery Schedule's column order per branch
(`src/utils/deliveryColumns.js`: the default — our drivers A–Z, 3rd-party
trucks, Will Call — a branch's saved order, where a new driver lands; its
routes in `src/routes/deliveryColumns.test.js`: the Arrange Driver Columns
permission, own locations only), and its stop
numbers (`src/utils/stopGrouping.js`'s `compactStopNumbers`: every driver's
run saved as 1, 2, 3… with no gaps, which the board, the Edit delivery form
and the driver's phone all show; the routes that keep it so after a delete,
cancel, move, edit or reorder, and the startup pass, in
`src/routes/deliveryStops.test.js`), the card's edge colour by ticket kind
(`ticketAccentFor` in `src/utils/deliveryTypes.js`), and the delivery write
rules (`src/routes/deliveryAccess.test.js`: a view-only login can't write, a
driver writes only an ePOD, a packing-list upload can't take another branch's
ticket id, reorders ignore tickets the board doesn't show, and a ticket with
no branch reaches every open branch room, and the ePOD save that writes the
ePOD and nothing else), and staff sign-in
(`src/services/staffSession.test.js`: the setup token failing every ordinary
check, temporary-password expiry, session versions;
`src/routes/userOnboarding.test.js`, in-memory MongoDB: a temporary password
→ setup session → own password → signed in, invite links once and racing,
change-password and admin resets ending older sessions — its `signIn` and
`authenticate` are stand-ins for server.js's, keep them in step).
Accounting's server rules and API have their own tests in
`src/accounting/*.test.js` (an in-memory MongoDB replica set, transactions
included). Cart & Holds do too: `src/holds/*.test.js` (expiry and totals
rules, the one-hold-per-slab lock, every edit, the expiry job, the customer
letter PDF and what its Hide boxes leave out — `holdLetter.js`), and
the Holds screens' rules in `src/utils/holdView.ts` (tabs, expiry wording,
which buttons each permission shows, the price editor, Extend's picks, cart
slabs offered to a hold, history wording, the Edit form's patch).
Permits do too: `src/permits/*.test.js` (every source's lead types and the
contract each source keeps, exact copying of each source's fields, every
reader's stop/short-answer rules against fake servers, the morning pull, both
counties' report checks, the WA contractor registry, the API and its county
filter with an in-memory MongoDB, and the list's PDF) and the screen's rules
in `src/utils/permitView.js` (the county tree, the place filter, registry
phones, and the PDF's rows, heading and link).
The calendar's date rules are covered too
(`src/components/shared/calendar/calendarDates.test.js`: parsing real days,
shifting with the 31st clamped, the Monday-first grid, week bounds, limits,
keyboard moves, the scheduler's date-time helpers); its rendering was checked by
hand in a browser.
Nothing else in the app has test coverage — no
rendered components, no other routes, no other server.js endpoints.

That means passing `npm test` only proves the math didn't regress; it says
nothing about whether a screen actually renders or behaves correctly.
Verification for everything else is still running the app (`npm run dev` /
`npm start`) and exercising the actual screen by hand, or, when real login
credentials aren't available in the current environment, reproducing the
specific DOM/CSS mechanism in isolation (see how the CustomSelect fix above
was verified). Flag this gap to the user if a change is high-risk enough to
want real regression coverage — don't assume "tests pass" or "it builds"
means the feature works, especially for anything touching a React component,
a page, or the map/Google Maps integration.

When adding a new pure/testable function elsewhere in the app, consider
adding it to this same narrow layer (a `<module>.test.js` beside the module)
rather than leaving it untested by default now that the harness exists.
