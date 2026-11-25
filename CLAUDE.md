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
in server.ts matches on the path, and a create living at
`/api/sales/customers` is why new customers didn't show in the dropdown for
ten minutes. **Bulk delete** (2026-10-17, the Customer List's selection bar,
Delete switch only) is `POST /bulk-delete` + `/bulk-delete/undo`
(`src/routes/customerBulkDelete.ts`, tested): every customer is saved whole to
`customerdeletebackups` before it's removed, and Undo restores it under the
same id so what points at it by id finds it again. Above 10 the confirmation
asks for the count to be typed (`src/utils/customerBulkDelete.ts`). What a create/edit may write is `src/utils/customerRecord.ts`
(never password, login state, the map point or the rep's name).

Every customer dropdown reads the one shared list,
`useCustomerOptions()` in `src/api/customerOptions.ts` (or SalesPage's
`customerOptions`, which is the same list), shaped by
`src/utils/customerOptions.ts`: the name rule, A–Z sort, the city under the
name, and search by name/city/contact. A new customer dropdown uses those —
don't map `/api/customers/dropdown` by hand again.

## Sales reps: one rule, one list

Who can be picked as a sales rep is decided once, in `src/utils/salesReps.ts`
(2026-10-10): `isSalesRep` (sales_rep, manager, director, admin — never the
shared `admin` login, drivers or CSRs). The customer rep picker and Customer
List filter use `toSalesRepList` (by id; deactivated reps kept, marked, for
filtering — the Add/Edit customer form offers them only when already set).
Every dropdown that saves a rep's **name** — Selection Sheet (every branch, the
visit's branch group first — owner, 2026-11-07; it was the visit's branch only),
Delivery (your branches), Location's sales person (any branch) —
uses `useSalesRepOptions()` in `src/api/salesRepOptions.ts`, built on
`salesRepNameOptions`: active reps only, A–Z, and whoever is already saved
stays at the top. A new rep dropdown uses those; don't filter
`/api/salesreps` by hand again.

Every rep dropdown and filter also **looks** the same (the Customer List
filter's format, the user's call 2026-10-10): a search box, None /
Unassigned first, then reps under a heading for their branch (branches and
names A–Z, "Other" last) with you marked "(you)" — `groupRepOptions`. On a
form that's `src/components/shared/form/RepPicker.tsx` (not FormPicker);
the Customer List filter renders the same groups. A filter that ticks
**several** reps is `src/components/shared/form/RepFilterPicker.tsx`
(2026-11-01): the closed field says who is ticked ("All reps", a name,
"8 of 14 reps"); its list has search, optional All / None, `extras` rows
before the reps (Unassigned, Me, My team), the branch groups with an optional
count per rep, and a `note` line; it floats in its container (never portaled)
and is a bottom sheet on phones unless `phoneSheet={false}`. The Route
Planner's Filter uses it. A new rep dropdown or filter uses these.

Something **new** at a branch starts with a rep by one rule too,
`startingRepFor`: the person creating it if they're a sales rep, else that
branch's **Sales person** (Users & Roles → Locations → Sales defaults; staff
read it as `defaultSalesRep` from `GET /api/admin/locations`), else what
the screen did before. New customers and deliveries get it on the form
(`useStartingRep()`), new check-ins from the server when they're logged
(so the Selection Sheet opens with a rep). It never replaces a rep someone
already set or picked. **Paused for check-ins since 2026-10-12** (owner's
request): `NEW_VISITS_START_WITH_REP = false` in `src/routes/checkIn.ts`, so
new visits and their Selection Sheets start with None until it's set back
to `true`; customers and deliveries still use the rule.

## Team view: whose work a manager sees, by the rep's branch (2026-10-31)

Visits, resources, follow-ups and calendars go by **where the
rep works**, not where the customer is (owner's call): `src/utils/teamScope.ts`
(tested). A person's team is everyone whose location / assigned locations
include one of their assigned locations, deactivated people included, plus
themselves; someone assigned `'*'` is on no branch's team, even with a home
location (`teamLocationsOf`, 2026-11-01 — an admin's work stays out of a branch
manager's view; to put them on a team, assign that branch instead of All). Users & Roles →
Visits: View all → everyone, View branch → their team, neither → their own;
Edit / Delete branch → visits and resources **logged by** their team
(`canModifyVisit(user, visit, team)` — the third argument is the team, not a
customer location). The server reads the staff list per request
(`src/services/teamDirectory.ts`); screens use `useMyTeam` /
`usePeopleOptions` (`src/api/myTeam.ts`). The Sales dashboard's Filters panel
has a **People** field (Me / My team / reps by branch, `PeopleField.tsx` —
a dropdown in the Customer List rep filter's format since 2026-11-01,
value rules in `dashboardPeople.ts`, tested): it opens on **Me** (owner's
call), a pick is remembered for the session, and `?reps=` / `?location=` can
only narrow (`narrowPeople`). The location filter meant people working there **until 2026-11-18**: the dashboard has
**no Location filter any more** (owner's pick, claude.ai artifact **Dashboard People filter — branches inside**,
https://claude.ai/artifact/KThdThRAnAY2xGivwTZ4tM): People and Location both chose whose work you see and could
contradict (Atlanta reps + Seattle = nothing). Branches are **headings inside People**, each with "· 3 of 7" and
All / None (hidden when the viewer sees one branch); the closed field says "Atlanta (all 7)", "Atlanta + Seattle · 11
people", "Cristina + Jeremy" (`peopleSummary` with `branchesOf`, `tickBranch` / `untickBranch`, tested). **Which
headings and people come from the viewer's Visits permission** (`permittedBranches` / `branchHeadingFor` in
`teamScope.ts`: View all → every branch, View branch → their assigned ones; a person working at two branches sits
under the one the viewer may see), the viewer's own branch first; a remembered pick the viewer can no longer see is
dropped (`sanitizePeople`). The dashboard never sends `?location=` (the server still answers it for old links;
`dashboardLocation` is always '' and the panels' location props are inert — a cleanup due). Rows say who logged them once more than you is in view. Sales Visits
has a **List | By rep** switch (`RepBreakdownTable.tsx`, rules in
`repBreakdown.ts`, tested): visits, resources, follow-ups and late per person,
counted from the lists already loaded so the Total row matches the tiles;
every active rep in view gets a row, zeros included; opening it on Me widens
to My team, and a rep's row shows their work in the list. **Team calendar**:
Users & Roles → Visits → Team calendar (`view_team_calendar`; given once to
every role holding View branch or View all, `ACTION_MIGRATIONS`) lets the
Calendar tab, the Calendar tile, the Today panel and By rep's Today column
follow the People filter — `GET /api/schedule?scope=team&reps=…&location=…`
(`calendarPeople`, tested in `schedule.test.js`; each entry carries
`ownerName`; without `scope` the route is unchanged). Others' stops are read
only (PUT / DELETE still match your own id): no pencil, bin or ⋯; Add only
when you're in view; dragging only on your calendar alone (`useMoveStop`'s
`enabled` — a move is placed among the day's stops). The planner's cache keys
each range by whose calendar it holds (`plannerSchedule.ts`'s `rangeKey`), and
the schedule form's clash check reads your own day only. A new screen that
shows or edits visits or calendars uses these, never the customer's branch.

## Follow-ups: one list, ticked done, by due date (2026-10-31, on `feat/followups-redesign`)

Dashboard → Follow-up is design **A · Due list** on the claude.ai artifact
**Follow-ups redesign canvas** (https://claude.ai/artifact/5x7prJdkNJAKcViVbzeTbK).
A follow-up is a visit's `followUp` / `followUpDate`; it's due on its follow-up
date, else the visit's day. **Done** is on the visit: `followUpDoneAt`,
`followUpDoneOn` (the day on the ticker's clock), `followUpDoneBy` / `…ByName`,
`followUpOutcome` ("What happened"); blank = pending, never backfilled. Every
snooze (from → to), tick and reopen is **kept** in `followUpHistory` (owner's
call) — never trimmed; rows say "Snoozed from Oct 24" / "Snoozed 2× · first due
…" and the Excel has First due / Times snoozed. A tick finishes it in one click
(owner's call); Undo or "What happened?" are on the bar after.

**One time range for the whole dashboard** (owner's call): the header's
Today / 7 / 30 / **90 days** / YTD / All / **Custom** (From–To, the shared
DatePicker) drives every tab and tile — `RANGES`, `rangeQuery` in
`dashboardFocus.ts`, `dashboardRangeDates` in `src/utils/dashboardMatch.ts`
(tested) for the server's routes. Follow-ups reads it **by due date only**
(owner, 2026-11-01): **Today** = due today and every day after (upcoming below
today's); **7 / 30 / 90 days, YTD** = due in that period up to today — an older
overdue one drops off, nothing upcoming shows; **Custom** = due in its days;
**All** = every one. Done and pending are listed together (Status opens on
**All**; done ones show ticked), today and upcoming soonest first, then the past
newest first. No totals tiles (removed 2026-11-01). The Follow-up tile and By
rep's Follow-ups column count **what that list holds under its Status / Due**
(owner, 2026-11-01: All = 31 when all 31 are ticked; the tile's footer says
"Pending · …" / "Done · …" when it isn't All). The dashboard holds Status / Due
(`followUpFilters` in `useDashboardData`, kept across tabs for the session),
`/api/dashboard/stats` sends `followUpCounts`, and `countForFilters` picks the
number; By rep's Late is never a ticked one.

Every rule is `src/utils/followUpList.ts` (tested), shared by the server and
the screen. `GET /api/dashboard/followups?timeRange=…&status=…` (server.ts:
`rows`, `counts` for the range, `summary` for the list, `doneThisWeek`) and
`PATCH /api/customers/:customerId/visits/:visitId/follow-up` (`src/routes/visits.ts`,
tested; whoever may edit the visit, `canModifyVisit`). The screen is
`src/features/dashboard/followUps/` (`useFollowUps`): grouped Today / Next 7
days / Later, then Earlier this week / Last week / by month (Pending alone:
Overdue / Today / Next 7 days / Later); Snooze moves the due day; the Filters panel holds
People, **Status** (Pending / Done / All) and **Due**. Done ones are off the
Visits tab's panel (`followUpPanel.ts`) and its count.
Calendar stops are no longer listed here (the Calendar tab shows them).

## Dashboard: one header, one +, one search box (2026-11-01, on `feat/dashboard-one-header`)

Design: claude.ai artifact **Dashboard tabs — Visits, Resources, Follow-ups,
Calendar** (https://claude.ai/artifact/YVvwQh1LL7HC3rPnM2AW1X, section "One
header"; the owner's comments on it set every rule here). Every dashboard tab,
every size:
- **One header** (`DashboardHeader.tsx`): title and date, the time range, then
  **Filters** (round funnel icon) and **⋯** — always there; only what they hold
  changes with the tab. Visits and Calendar render theirs in the header;
  Resources and Follow-ups keep their filters' state and portal their Filters
  and ⋯ into the header's slot (`toolSlot`, `TABS_WITH_OWN_TOOLS`). What's
  filtered shows **only inside Filters** — no chip row on the page; the gold dot
  says one is on. Under 1024px the range is its own row under title / Filters /
  ⋯; on a phone the Calendar tab has no range (it has Day / Week / Month).
  Calendar's ⋯ holds Sync calendar.
- **One +** (`components/DashboardAddButton.tsx`): round gold, bottom right,
  menu Add visit / Add resource / Schedule activity on every tab (Schedule
  activity opens the Calendar and its form: `scheduleRequest` → the planner's
  `openAdd`). No Add buttons in the header or the planner's toolbar. It opens
  as a **speed dial** (owner's pick, 2026-11-01; claude.ai artifact **Dashboard
  + menu opening**, https://claude.ai/artifact/KsDZ3TUpkexMDGgTJaUNZb, option
  B): each action a label + round button popping out nearest first, the page
  dark and blurred behind (a tap there only closes), the + turning into × with
  a gold ring; hover only where there's a mouse.
- **One search box** (`src/components/shared/DashboardSearch.tsx`, shared since
  2026-11-02 — Payments uses it with its own `placeholder`): "Search customer,
  contact, note", 300px (full row on a phone), "/" jumps into it, "2 of 17" and
  ✕ when typed. Each tab's title bar is just its title and this box (no count
  under the title). The Calendar's filters its stops (`search` prop).
- **Find a customer** (2026-11-04, on `feat/dashboard-customer-search`; claude.ai
  artifact **Dashboard customer search**, https://claude.ai/artifact/7JSB6KcbPKb6a1ZPHjcuha,
  owner's pick: **B on a laptop / desktop, A on an iPad / phone**): a round 🔍
  before Filters on every tab (`view_customers`), also Ctrl / ⌘ K (not over
  another pop-up). `components/CustomerFinder.tsx` picks the look by
  `HEADER_FIELD_QUERY` — 1024px+ **and** a mouse / trackpad, so an iPad in
  landscape still gets A: B is `HeaderCustomerSearch.tsx` (the 🔍 grows left
  into a field over the time range, which is hidden via `:has()` so nothing
  moves; the list drops down under it; Esc, a pick, or a click elsewhere with
  the box empty closes it), A is `CustomerSearch.tsx` (pop-up, full-screen sheet
  on a phone). Both share `useCustomerFinder` + `CustomerFinderList`, read the
  shared list (`useCustomerOptions`) — no Customers page load — and open on the
  last 5 customers opened (per person, this device); typing matches name /
  contact / city, names starting with it first, 50 rows max
  (`src/utils/customerQuickSearch.ts`, tested). A pick opens the full profile
  (`onOpenCustomer`; ✕ comes back to the Dashboard), or the basic card without
  Full profile; no match offers Add customer with the name filled in. A pop-up
  near the top on desktop / tablet. On a phone a sheet with Cancel from under
  the Dashboard's title row, which shows dimmed above it (owner's pick
  2026-11-04, option A of the artifact **Dashboard search with a peek**,
  https://claude.ai/artifact/Pei1RCubnrXnthu6S68DWb): a tap there, Cancel or
  dragging the handle down closes it.
- **Follow-up rows** (`followUps/FollowUpRows.tsx`): tick · date block coloured
  by how due · customer + 📍 location · note · rep chip with initials + logged
  day · due pill · ⋯ (Call, Snooze, the visit, the customer). On a phone, cards:
  customer + due pill / location + due day / note / rep, day and ⋯ (Done is in ⋯).
- Tiles are 4 across on a tablet; Visits' Today / Follow-ups go under the list
  below 1024px. Layout CSS is the end of `DashboardFocus.css`.

## Where a visit or resource was logged: required, one reading (2026-11-19, on `feat/visit-location`)

Design: claude.ai artifact **Visit location stamp** (https://claude.ai/artifact/Fiu5mUw8yn7ftVsEbHggRK; the owner's
answers of 2026-11-19 set every rule here). **Every new visit and every new resource carries one reading of where its
logger was** — phone or computer, every visit type including calls, no exceptions (owner). `src/utils/visitLocation.ts`
(tested) is the rule: `parseReading` / `readingProblem` (a reading older than 15 min is refused), `loggedFromFor` works the
distance and mark out **on the server** against the customer's map pin (`visitCustomer` returns `coordinates`), never from
the browser: **On site** ≤ 0.25 mi and accuracy ≤ 400 m, **Nearby** ≤ 1 mi, else **N mi away**; calls, notes and admin
types keep the reading as `recorded` (no verdict); a customer with no pin is `noPin`; accuracy over 150 m sets
`approximate`. `POST /:customerId/visits` and `POST /:customerId/resources` answer 400 `location_required` /
`location_stale` without one. It is stored once as `loggedFrom` on the **visit** (`visits.logged_from` jsonb, migration
`0016`; a resource's reading rides on its placement visit) and an edit can't send or change it. The screens:
`src/features/location/` — `useLocationReading` (starts when Add visit / Add resource / Log call opens, retries, follows the
browser's permission), `LocationLine`, `LocationBlocked` (replaces the form with the steps to turn location on), and
(there is **no** "Allow location" sheet when the app opens — `LocationGate` existed 2026-11-19 to 2026-11-20 and the owner had it
removed, website and iOS app; the browser or iOS asks the first time Add visit / Add resource opens); Save stays locked
until a reading is in, and edits ask for nothing. `geolocationAccess.ts` still owns the Route Planner's quiet follow.
A web app can't tell "allow once" from "always", can't read in the background and can't re-prompt after a block.
**Step 2 (on `feat/visit-location-marks`):** Users & Roles → Visits → **Where logged** (`see_visit_locations`, given once
to every role holding View branch / View all, `ACTION_MIGRATIONS`; manager defaults too). `canSeeVisitLocation`
(`visitAccess.ts`): your own always, your team's with the switch (team rule), nobody else. The **only** way a reading
leaves the server (besides the answer to the add that made it) is `POST /api/visit-locations` (`src/routes/visitLocations.ts`,
tested; `customerData.visitLocations`), which returns only what the caller may see, so the existing readers (profile,
dashboard, lists) still never select `logged_from`. Screens ask through `useVisitLocations` (`src/api/visitLocations.ts`)
and show `LocationChip`: the dashboard's Visits list, the customer's Visits tab and both Resource lists (shared
`ResourceTable` / `ResourceCards`, so Dashboard and profile change together), plus `LocationDetails` ("Where it was
logged": mark, distance, time and accuracy, device, a Google Maps link, "Logged on …" when read on another day) in the Visit
view and View resource. Viewers with the switch also get Filters → **Where logged** (`WhereLoggedField`, `matchesWhere`;
needs every visible visit's mark, fetched in calls of 500), the visit and resource Excel exports' **Where Logged / Distance From Customer / Logged From** columns (`locationExportColumns`; only with the switch, so nobody else's file changes) and By rep's **On site** column ("13 of 16", `onSiteTally`: only
in-person visits with a pin count). Nothing is built beyond this; a mark never changes after the save. `withoutLoggedFrom` stays on every
visit answer apart from the add's. A new place that creates a visit or resource from
the app needs `useLocationReading` and must send `loggedFrom`.

## Locations: one dropdown, one order (2026-10-17)

Every single-choice location field and filter is
`src/components/shared/form/LocationPicker.tsx` (the user's call): the
blank choice ("All locations" on a filter, None where a form allows it), the
home location marked "· Home", then every other location A–Z, with a search
box from 8 choices — `orderLocations` / `matchLocations` in
`src/utils/locationFilter.ts`. It's in every Filters panel (LocationFilter's
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
files. The week starts on **Sunday** (`WEEK_STARTS_ON = 0`, owner 2026-11-16, matching
the phone's calendar). Anything that draws or groups a week reads it
(`startOfWeek` / `weekBounds` / `monthGrid` / `weekdayLabels`): the pickers, the
Sales Planner (`weekStartOf`), Resources' week headings, the Route Planner's
Schedule panel grid, Follow-ups. Never hand-roll a "Monday of this week" or a
month grid again. The one exception is the Delivery Schedule board, a
Monday–Friday work week of its own (`utils/deliveryWeek.ts`). The popover floats inside its field (never portaled — the
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

## Scheduling: one form, one rule set (2026-10-29)

Anything that puts an entry on a rep's calendar is
`src/components/shared/schedule/ScheduleActivityForm.tsx` (design: claude.ai
artifact **Schedule activity form canvas**, https://claude.ai/artifact/UZhEot9fsANGStM4yKyAaQ):
the Sales Planner's add / edit activity (`ActivityDialog`), the Route Planner's
Add to calendar / Reschedule (`ScheduleVisitSheet`) and its Schedule panel's
add / edit. Each is a thin adapter that passes a fixed customer or a picker,
`bookedOn(date)` and an `onSave`; don't build a fourth. It's on FormModal (no
Cancel, the ✕ asks about unsaved changes). The rules are `src/utils/visitSlots.ts`
(tested): opens on today until 6 PM, tomorrow after (`defaultVisitDate`); the
start is the first free slot between 9 and 5, or the next quarter hour today
(`earliestStart`); a new visit is **30 minutes** and a booking with no end time
counts as 30 whatever length is chosen (`DEFAULT_VISIT_MINUTES`, in
`scheduleRecord.js`, which the .ics feed uses too). Overlaps, the same customer
twice in a day, a start already past and a full day **warn and never block**
(two reps can visit at once). No Today / Tomorrow chips (owner, 2026-10-29).
Type (Visit / Call / Drop-off / Other) is on every screen. The server checks
every write (`src/utils/scheduleRecord.ts`: real times, end after start, a known
type; PUT can't change userId or source) and a new entry carries its own `_id`
so a repeated POST answers 200 `alreadySaved`. Old entries with no end time are
not backfilled.

## Sales Planner on a phone (2026-10-29)

Under 640px (where the phone tab bar is) the planner is laid out by the last
block of its rules in `src/pages/SalesPage.css` ("Sales Planner on a phone");
tablet and desktop keep the rules above it. Design: claude.ai artifact **Sales
Planner mobile redesign** (https://claude.ai/artifact/GumfdseBzFVABVrq5jAwMn).
One header row ‹ date ›, the Day / Week / Month switch under it, a "Today"
button only when the period on screen doesn't hold today
(`isCurrentPeriod`), the Day view's subtitle ("Today · 9 stops",
`relativeDayLabel`), no column header in the Day view, and **adding is the
dashboard's round +** (`DashboardAddButton`, fixed above `--app-bottom-h`; the
toolbar's Schedule Activity button and `.pl-new` are gone since 2026-11-01). A stop shows its time in its own column and its length when
it saved an end; the pencil and bin become one "⋯" (`.pl-kebab`) that opens
a bottom sheet (`PlannerActionsSheet`: Directions / Open profile / Edit schedule / Delete
activity), built on the form template's sheet (`.fm-sheet`, `--fm-*` tokens, 48px `.fm-opt` rows, Cancel in `.fm-sheet-foot`; 2026-11-17). **Calendar redesign (2026-11-16, on `feat/calendar-redesign`):** a phone has
**Day and Month only** (a left-over Week becomes Day), no ‹ › arrows, no Today button
and no week strip — the date is the button that opens the shared calendar picker, and
Month is a number and a stop count per day where a tap opens that day
(`MonthGrid`'s phone branch, `.pl-pcell`). Above 640px each Week/Day column's header is
the date on the left, a gold route icon (that day's Optimize route, two or more of your
stops) and + on the right, then one line saying how full the day is (`daySummary`, tested)
with a load bar; a stop's menu is **⋯** — Directions, View details, Open profile, then Edit schedule and
Delete under a line (`PlannerStopMenu`; Edit / Delete only when it's your stop).
On a phone the **Day view is a timeline** (design A of the 2026-11-16 canvas): the time left of a
rail, a dot per stop and a card beside it; today's list gets a red **NOW** line (`DayStops`,
`nowLineIndex`) and stops that have ended fade (`isPastStop`, `useNow` ticks each minute).
The Visits tab's **Today panel** (`DashboardAside`) is the same timeline in small (time, rail and dot, customer,
**⋯**, red NOW line, ended stops fade) with the planner's stop menu (`salesPlanner/stopActions.ts`, a separate
entry so the Dashboard doesn't pull in the planner chunk): Directions, View details, Open profile, Edit in Calendar.
**Directions** reads the customer record when tapped (a stop carries only a name) and opens
Google Maps (`directions.ts`). **View details** (2026-11-17) opens the customer's basic card, the
one the dashboard's Find a customer opens without Full profile (`onOpenVisitCard`, threaded as
`onViewDetails` through `CalendarPanel` / `DashboardAside`); Open profile is still the full profile.
Rules in `SalesPlannerMobile.css` / `SalesPlannerWeek.css`, checked by `e2e/planner.mobile.spec.ts`). The extra parts (`.pl-time`, `.pl-kebab`,
`.pl-drawer`, `.pl-sub`) are in the markup on every screen and hidden above
640px. `.pl-more` is the Month view's "+N more", not the ⋯.

## Sales Report tab: monthly sales per customer (2026-11-18, on `feat/customer-sales-report`)

Customer profile → **Sales Report** (`profile/SalesReportTab.tsx`) shows one customer's sales by
month from the SPS report **Sales by Customer - Monthly** (tax not included, all locations). The
owner uploads the Excel in the app: Customers ⋯ → **Import sales** (`import/SalesImportModal.tsx`,
needs Import); the file is read by `src/utils/customerSales.ts` (`readSalesSheet`, tested — one
year, Jan–Dec, names unique, amounts in cents) on the screen for the preview and again by the
server, which refuses a file it can't trust before writing. **Postgres only** (new since the
customer cutover, no MongoDB copy): `customer_sales_monthly` (one row per year / month / report
name) and `customer_sales_imports` (the log, with the names that matched no customer), migration
`drizzle/0014_customer_sales.sql`, data layer `src/db/customerSales/` (tested on PGlite). An
import **replaces its whole year**. Rows are matched to a customer **when read** — its `sps.key`,
else its company name, both through `spsKey` — so connecting or renaming a customer needs no
re-import; names matching nobody are listed after the import (no fuzzy matching, owner's call).
**Import sales is three steps like Import from SPS** (design: claude.ai artifact **Import Sales Flow**,
https://claude.ai/artifact/Nvgh55Mf4aa5C9SwCDx3Pp): Upload and file check → Check names → Results. A report
name that matches no customer is listed with look-alike suggestions (`suggestCustomers`) and a customer
dropdown; the person picks or skips, and a pick is saved in `customer_sales_links` (migration 0015, gone with
the customer) so the next file's same name goes straight there. Routes `src/routes/customerSales.ts`:
`GET /api/customers/:id/sales?year=` (needs the full-profile switch), `POST /sales/preview` (writes nothing)
and `POST /sales/import` (with `links`), mounted before the other customer routers. Not built: per-location
splits, more than the monthly report. New tables reach RDS with `npm run pg:migrate -- --apply` on Render.

## Customer profile header and tabs (2026-10-29)

Design: claude.ai artifact **Customer profile header redesign**
(https://claude.ai/artifact/Ghe3d6UBu5zmFKYDU5pKbN — desktop, tablet, phone,
dark, empty, loading, long lists, delete check, phone ⋯ menu). The header is
`src/features/customers/list/CustomerProfileHeader.tsx` with its styles in
`profile/CustomerProfile.css` (`.cp-*`, on the Customer list's `--cl-*` tokens,
so dark/light follow the app). There is **no Dashboard icon and no Customers
button**: a **✕** goes back to the list, and a **⋯** menu holds Edit customer /
Delete customer… only for logins with `manage_customers` / `delete_customers`
(`canEditCustomers` / `canDeleteCustomers`). What the menu holds and where it
shows is `profile/profileHeaderRules.ts` (tested): up to 700px the status picker
moves into it, on a phone so do Call and Directions. The ✕ and ⋯ copy the forms
template (`.fm-close`, the Selection Sheet's "…"). The sections show as labelled tabs when they fit beside the Add button, else as **one section bar that opens a menu card** (`profile/SectionMenu.tsx`; design: claude.ai artifact **Profile Section Menu**, https://claude.ai/artifact/CgPSBxMgobnNkVuvXU2Vui). The header measures the space (`asMenu`, `.cp-bar--menu`), so a phone, a narrow tablet or a seventh tab need no breakpoint. Add is the round + on a phone (above `--app-bottom-h`). Each
tab has **one** Add button in the header (Add visit / resource / contact, Link
partner); a tab with nothing on it shows `TabEmpty` (which holds the button) and
the header's hides. Visits and Resources use the shared `Pagination`. The
Resources tab is Dashboard → Resources' own rows (`ResourceTable` /
`ResourceCards` from `features/dashboard/resources`, `showCustomer={false}`;
owner 2026-11-06: both look the same) — **a change to those rows changes both
screens; check both**. A row opens View resource (files, notes, status); the
server names who logged each one (`uploadedByName`, `customerHistoryResponse`).

The Customers list owns the Edit customer form and Delete and stays mounted under
the profile, so the profile asks for them through `customerBridge.ts` (window
events: edit / delete request, and "saved" so the profile reloads). Delete asks
its own check first (`DeleteCustomerDialog`), then the list deletes without
its native `confirm`. A row menu in a table is `profile/RowMenu.tsx`: it sits on
the screen beside its button (the list's `anchoredMenuStyle`) because the tables
clip, which is why `.resources-table tr:hover` no longer scales — a transformed
row becomes the reference frame of a fixed menu inside it and sent the menu off
the page. A new menu inside a table must be checked with the mouse over the row.

## Visit types and Resource types: in the database, set by managers (2026-10-31, on `feat/admin-types`)

The lists behind the Add visit and Add resource dropdowns are the `VisitType` /
`ResourceType` collections, edited in Admin → **Visit Types** / **Resource
Types** (`src/features/types/`, one `TypeListTab` for both). Nothing in the
code names a type any more: `VISIT_TYPES` and `resourceTypes.ts` are gone, and
`familyOf` became `typeInfoFrom` (family, label and order come from the
record). A new dropdown, filter or rule reads them through `useVisitTypes()` /
`useResourceTypes()` (`src/api/typeLists.ts`); the server checks a visit's type
against the collection (`src/routes/visits.js`). `name` is what records store
and never changes; `label` is what staff read and can be renamed. Managers add,
rename, hide / show and **reorder** (the order is everyone's dropdown order;
saves on drop through `PATCH /reorder`, which takes the whole id list). A hidden
type can't start a new visit but stays valid on the ones that have it; delete is
never for the 10 built-in visit types, and a type records use is deleted only
by **moving them to another shown type** in the same step (the delete check's
"Move them to", 2026-11-01): `src/services/typeReplacement.ts` (tested in
`typeLists.test.ts`) rewrites the visits' purpose / the resources' type, a
title, placement visit and calendar note that still say the old type, links an
older resource to its placement visit, and deletes, in one transaction; an
ambiguous older placement is a 409 that changes nothing. A visit
type carries `fields` (notes, outcome, follow-up none / optional / always) that
the form and `cleanVisitFields` follow — `visitFieldsFor(type)` takes the
record, not a name. Each list has four switches on the Users & Roles card (add,
edit, reorder, delete; `src/utils/usersAccess.js`), plus one **Manage both type
lists** (`manage_type_lists`) that holds all eight; `manage_users` holds them too.
No migration grants them to other roles. `src/services/seedTypeLists.ts` fills
an EMPTY collection once, from the old lists plus any name old records carry
(hidden); after that editing it changes nothing. A resource's type is checked against the list on
add and on a change of type (`resourceTypeRefusal` in server.js): unknown or hidden
is refused, the type it already has can stay.

**Resource families are a list too** (2026-11-01, on `feat/moda-counts`): the
`ResourceFamily` collection, managed in a **Families** section under the
Resource Types list (the same `TypeListTab` / `TypeForm`, `kind: 'family'`,
`/api/resource-families` on the same router; the four Resource Types switches
cover it — no new permission). A type's `family` stores the family's `name`;
the server refuses a family that isn't on the list or is hidden (the one a
type already has can stay). The five the code used to name are built in
(`STARTING_RESOURCE_FAMILIES`, seeded once into an empty collection): renamed,
reordered, hidden, never deleted — `tower` and `binder` are what the Moda
counts read. Deleting a family moves its types to another shown one
(`replaceFamily`, recounting Moda in the same transaction). The family order
is the Family dropdown's and Dashboard → Resources' Filters groups'; a family
a manager added shows in Other's colour with the first three letters as its
phone tag (`familyColour` / `familyTag` in `resourceList.ts`). Read the list
through `useResourceFamilies()`; never name a family in code again.

## Moda Display and Binders: counted from resources (2026-11-01, on `feat/moda-counts`)

Design: claude.ai artifact **Moda counts from resources**
(https://claude.ai/artifact/RwLQGxLHFaVfpf8HiinAEk). The profile's Display and
Binders are the customer's **Active** resources by family — a **Display
towers** resource makes Display Yes (Installed; tabletops don't), a **Sample
binders** one adds its Qty — plus `modaEarlier`, what was typed or imported
before that no resource accounts for (owner's calls: tower only, Inactive /
Archived don't count, Edit customer may still type a total, recount every
time). The rule is `src/utils/modaTotals.ts` (tested); `modaDisplay` /
`modaBinder` stay stored so the list, filters, map and export read them as
before. **Every write that changes a customer's resources recounts** in the
same save (`src/services/modaCount.ts`: `resourcesOf` before, `recountModa`
after): resource add / edit / move / delete (`customerResources.ts`), the Visits
tab's placement delete (server.ts), a type's records moved on delete
(`typeReplacement.ts`), a type's family change (`recountForFamilyChange`) and
a duplicate merge (`customerMerge.ts`). A new one must too. Edit customer's
typed values go through `typedModaFields` (never below what Active resources
hold — 400 with the reason). A customer saved before the rule gets its earlier
count the first time its resources change, so no count goes down;
`scripts/moda-switch.ts` (dry run, then `--apply`) does everyone at once.
Screens: `GET /api/customers/:id/moda` (`useModaSummary`), the drawer's
`ModaTiles.tsx`, and Add / Edit resource's "Binders" / "Towers" Qty label
(Binders starts empty) and its change line ("Binders 6 → 9").

## Resources and Team Files (2026-10-30, on `feat/resources-redesign`)

Design: claude.ai artifact **Resources Redesign Canvas**
(https://claude.ai/artifact/TSMaMjGbsD5o1WDD7CYUiu, Option A). Dashboard →
Resources is one list, the resources placed at customers
(`src/features/dashboard/resources/`): search, the shared `LocationFilter`
panel with resource types (grouped by family — tower, tabletop, binder,
samples, other: `familyOf`) and Logged by inside it, what's ticked shown as
removable tags, and ⋯ (`RowMenu`) with **Export this view** / **Export all
resources**. A table on desktop (Note and Logged by fold away under 1024px),
cards grouped by week on a phone (`useIsPhone`); a row opens the resource.
The rules are `resourceList.ts` (tested). A resource has a **Qty**
(`src/utils/resourceForm.ts`, shared with the server: a whole number 1–999,
missing = 1; never backfilled). Add / Edit / View resource is
`src/features/resources/form/` on FormModal (no Cancel; View is the same
shell read-only with Edit resource); `components/sales/ResourceModal.jsx` is
gone. Who may edit / delete one is the visit rule with its uploader as the
logger (server's `resourceAccessArgs`, the screens' `canModifyVisit`).
`GET /api/dashboard/resources` also sends `qty`, `notes`, `status`,
`customerLocation`, `city`, `company`, `contactName` and `uploadedByName`.

Resource writes now live in `src/routes/customerResources.ts` (2026-10-31).
The actor owns a new resource; clients cannot change ownership or link metadata.
A resource's `visitId` and its placement visit's `resourceId` are durable links.
Resource/history/calendar creation, edits, deletes and moves commit together in
one transaction; notify after commit. Legacy matching must be unique across
exact title/type, day, author and available metadata; ambiguous matches return
409 without changing anything. Never restore first-title-match synchronization.
`src/services/resourcePlacement.ts` also resolves deletion through the Visits tab.
Customer profile/detail reads and customer create/edit responses share
`customerHistoryResponse` in `src/routes/customerHistory.ts`: full-profile
permission does not widen the separate Visits read scope.

Incoming transfers (owner's decision, 2026-10-31; status added 2026-11-03): a
receiving branch may change only **expected delivery date, slab count and
status** — Scheduled / Delayed / Completed / Cancelled (`RECEIVING_STATUSES`),
once the sender has it on a truck; once cancelled only the sender restores it
— through `PATCH /api/deliveries/:id/receiving` and `IncomingTransferForm.tsx`.
On the receiving side **Completed = received**: setting Completed marks it
received, leaving Completed un-marks it, and Mark received completes it
(`receivedFieldsForStatus` / `statusForReceived` in `transferAccess.ts`). The
sender controls driver/ship date, dispatch, Pending and deletion. Read access to both
branches must never be reused as shipping-write access (`transferAccess.ts`).
A transfer the sender never logged is recorded by the receiver with **Log
arrival** (2026-11-03, owner's calls: ship date = arrival day, added to both
Daily Reports even when submitted, anyone with Edit on the Delivery Schedule
at their own branch): `POST /api/deliveries/arrivals`, saved as the sender's
transfer, received — see `src/features/delivery/README.md`. That is the one
place a submitted report gains a line without being reopened.

**Team Files** is its own Sales page (`team_files` in `navPins.js`, still
opened by `view_dashboard`; `src/features/teamFiles/`). The page is the old
list and pop-ups unchanged; the redesign on the **Team Files Page Canvas**
(https://claude.ai/artifact/NRBYg5zf4Ycw8NCuMrpd97 — tree, preview, pinning,
size, own permissions) is not built.

## iOS app and Team Location (2026-11-19, on `feat/ios-app`)

The iOS app is the live site in a Capacitor shell (`ios/`, `capacitor.config.ts`; it loads the site so the
sign-in cookies stay first-party). The app is named **Easy Surfaces** (bundle ID `app.easysurfaces`); the company is Easy Surfaces, doing business as Easy Stones, and the website keeps the Easy Stones name. **Staff sign-in only** on `/login`: the supplier-portal fallback (`supplierSignInFallback.ts`) was removed
2026-11-22 at the owner's request, who will handle suppliers' sign-in later; suppliers use `/supplier` directly. **Location tracking** is `src/utils/locationTracking.ts` (tested): 7 AM–6 PM on the person's workdays
on their **branch clock** — **workdays** = Monday–Friday, minus a day they logged **Personal Time Off**, plus a
Saturday / Sunday when they have a non-cancelled calendar entry or (a driver) a delivery on their `drv_<username>`
column (`DayFacts`, read per request by `src/db/locationPoints/workDays.ts`; an In-office admin day is a normal workday) — enforced by the server (`POST /api/location-tracking/points` drops anything
outside) as well as the app; kept 90 days (`src/jobs/locationRetention.ts`); table `location_points`
(Postgres only, with `location_consents`: migration `0017_location_tracking`). Switches on
Users & Roles → **Location Tracking**: `track_location` (that role is tracked) and `view_team_locations` (sees the
tracked people on their team, by `teamScope.ts`; others answer 404). Nobody holds either until an admin ticks it.
**Admin → Team Location** (`src/features/teamLocation/`, nav `team_location`) is the manager's screen: people
with last seen, a Google map, and one person's trail for a day. **The phone collector** (`src/features/locationCollector/`, mounted in App.tsx): only in the iOS app, only for a
staff login whose role has `track_location`; consent screen first (`CONSENT_VERSION` — bump it when the wording
changes), then the community background-geolocation plugin collects inside 7–6 (a point per 45 s), unsent points
queue in localStorage per person and go in batches of up to 200, "Location on until 6 PM" pill, Settings prompt
when iOS location is off. Info.plist has the Always / When-in-use text and `UIBackgroundModes` location. **Never
run on a real phone yet** — test a full day on an iPhone. **Consent is recorded on the server** (`location_consents`, one row per person per
`CONSENT_VERSION` — bump it in `utils/locationTracking.ts` when the wording changes): Allow calls
`POST /api/location-tracking/consent`, the server refuses a person's points (403 code `consent`) until the row
exists, `/status` says `consented`, and Team Location shows "Hasn't agreed to share location yet". The record is
never deleted with the points. Not built: universal links and push (need the Apple
developer account).

**Locate now — outside the window, only when an admin asks (2026-11-20, on `feat/locate-on-request`).** The owner
first wanted continuous 24/7 tracking of everyone with the app, including personal phones; I advised against it
(privacy law, App Review, HR's sign-off covers 7–6 only) and they chose **location after 6 PM only when an admin
requests it**. Rules `src/utils/locationRequests.ts` (tested): switch `locate_on_request` (Users & Roles → Location
Tracking → **Locate on request**, nobody holds it until ticked); the person must be tracked, on the asker's team
(404 otherwise) and have agreed to the **current** wording (`CONSENT_VERSION` is now **3**, one short paragraph, `consentBody` in
`collectorRules.ts`: when, why, that your manager sees it, and that a manager may also request it outside work hours — the
owner asked for little detail (2026-11-22); version 2 was the long wording; everyone is asked again); a
**reason of 5–200 characters is required** and kept; one open ask per person (15-minute `REQUEST_TTL_MS`, then it
expires); you can't ask about yourself. Routes `src/routes/locationRequests.ts` (tested): `POST /locate`,
`GET /locate?userId=` (the log), `GET /locate/:id`, and for the phone `GET /locate/pending` (who asked and when —
**never the reason**) and `POST /locate/:id/answer`. The answer is kept **with the ask** in `location_requests`
(migration `0019`, `src/db/locationPoints/requests.ts`, 90-day cleanup with the points) and **never in
`location_points`**, so ordinary points are still dropped outside 7–6. **The person is NOT notified when asked and
nothing is shown on their phone** (owner, 2026-11-22; consent wording bumped to `CONSENT_VERSION` 3, `consentBody` in
`collectorRules.ts`, so everyone re-agrees — the old "you get a notification each time" promise is gone, and the
`askedNotice` push + the "Location sent to …" notice were removed). Phone: `useLocateRequests` (in `LocationCollector`)
answers an open ask silently whenever the app is in front — at start, on resume, every minute — with one
`@capacitor/geolocation` reading (`answerRequests.ts`, tested). Admin: Team Location's **Locate now** button (greyed until the person has agreed to
the current wording), `LocateDialog` (FormModal S, reason required), a status line while it waits (checked every 4 s),
the answer as a blue ring on the map, and the person's log of asks. **Not built / limits:** a *silent* push that
wakes a closed app to answer — iOS doesn't guarantee background wake, so an ask to a force-quit or Low Power phone
stays "Waiting" until the app is next opened (that needs native Swift in `AppDelegate` and a real iPhone with the
APNs key; the next phase). New HR / legal sign-off should cover the changed wording before this goes live.

## Location tracking v2: complete data, live view, why-quiet, access log (2026-11-22, on `feat/location-tracking-v2`)

The owner's calls: **completeness over battery** (full accuracy all window, Low Power Mode doesn't reduce it; a dead
phone is the only gap and the screen says so), **live view by polling, not push** (Lambda can't hold sockets; 150–200
tracked people), **the access log is admin-only and the tracked person never sees it**, **no 24/7 tracking** (the 7–6
window and Locate now stay; I advised against 24/7 — if it is ever built it is an opt-in tier with its own consent
wording, the window then becomes per-person data). Tables (migration `0029`, Postgres only): `location_latest` (one
row per person, written in the same transaction as the points and **only forward in time**, so a late backlog never
moves anyone back), `location_device_health` (the phone's heartbeat: battery, charging, queued, app version; newest
wins) and `location_view_log` (append-only; kept **1 year**, `VIEW_LOG_RETENTION_DAYS`, not deleted with the points).
`GET /team` reads `location_latest` + health + `dayFactsForPeople` (three queries for everyone) — one small snapshot per
poll (the screen polls every 15 s, never two at once, refetches when the tab returns); it returns `quiet` (why a person
who should be reporting isn't: permission, battery ≤15/≤5 %, Low Power, a backlog, plain silence — `quietReason` in
`src/utils/locationHealth.ts`, only on a day tracking is on) and `device`. `POST /heartbeat` needs `track_location`, holds
no position. `cleanPoints` also drops a **bad fix** (a jump over 300 m faster than 90 m/s from the previous / newest
saved point, `dropped.teleport`) and a point may now be **48 h old** (`MAX_POINT_AGE_MS`; the window is still read on the
point's own time). A trail answers with `gaps` (`trailSegments`, 12 min); miles are summed per segment and the map draws
no line across a gap. **The access log** is written only by the server: every trail (fail-closed — no trail is shown if its
line can't be written), every Locate now, and the map once per viewer and person per 12 h (`LIVE_LOG_EVERY_MS`, best
effort). `GET /access-log` needs `view_location_audit` (Users & Roles → Location Tracking → Access log; **404** without
it); Team Location has an **Access log** tab, and that switch alone opens the page. Phone: flush every 30 s / 10 points,
a heartbeat every 5 min and at once when the battery falls to 15 % / 5 %, and a "still here" position after 5 quiet
minutes (the watcher only fires on movement, so a gap really is missing data). **Native plugin (2026-11-22, `plugins/location-health/`, Swift, linked through `ios/App/CapApp-SPM/Package.swift` by
`npx cap update ios`):** the real permission level ("always" / "when-in-use" / "denied"), Low Power Mode, battery and
charging (it replaced `@capacitor/device`), **significant-change monitoring** (iOS may relaunch a force-quit app when the
phone moves; needs "Always"; the plugin restarts it when it loads again) and a **durable on-disk queue** of unsent points
per person (`PointStore`, Application Support, readable after the first unlock; the collector keeps localStorage too and
joins the two by point id, `mergeQueues`). Web side `locationHealthPlugin.ts` + helpers in `backgroundLocation.ts`; every
call is guarded because **the app shows the live site, so this web code also runs in older builds** that have no plugin
(they report "unknown" and behave as before). Swift tests: in `plugins/location-health`, `xcodebuild test -scheme
LocationHealth -destination 'platform=iOS Simulator,id=…'` (not `swift test`: Capacitor is iOS-only); the whole app
builds for the simulator with it. **Needs a new app build (and `cap update ios` already done) before any of it exists on a
phone, and has never run on a real iPhone:** unproven are whether a background relaunch by significant change actually runs
the web layer's collector (the Swift side only restarts monitoring; iOS gives a relaunch ~10 s), and how long
"Always" stays granted. **Not built:** marker clustering, stops (dwell), the access-log Excel, a silent-push wake before
7 AM. **Run `npm run pg:migrate -- --apply` on Render for `0029`.** The retention job is still in-process
(`startLocationRetention`) — it needs an EventBridge schedule when the server moves to Lambda, and Lambda needs RDS
Proxy (or connection reuse) for 200 phones posting every 30 s.

**Android (2026-11-22, on `feat/team-location-redesign`):** the same Capacitor shell, `android/` project and a Java
`LocationHealth` plugin (`plugins/location-health/android/`, same interface as the Swift one; plus `requestAlways` and
`openBatterySettings`). The collector already ran on any native platform; the consent screen is platform-aware
(`platformWords`) and discloses use "when the app is closed or not in use" for Google Play. **Never run on a real Android
phone**; **pushes (Locate now, Send Notification) are Apple-only until FCM is built**; Google Play's background-location
declaration is the slow step. Everything is in `docs/ANDROID_LAUNCH.md`.

**React Native app (2026-11-22, `mobile/`, on `feat/team-location-redesign`):** the owner chose to move the Swift code to React Native
(Expo), so the app is now `mobile/` — the live site in a WebView plus native screens in TypeScript — replacing the Capacitor shell and its
Swift / Java plugins (those stay in the repo until the new app is proven on real phones; nothing is deleted). Sign-in (`mobile/src/auth`,
the Swift `NativeLogin` ported: staff and supplier through `POST /api/customer/login`, Face ID / fingerprint through the secure store) and
a **bridge** (`mobile/src/host`): the website's `@capacitor/core` plugin calls (App, Keyboard, PushNotifications, Geolocation,
BackgroundGeolocation, LocationHealth) are answered by Expo modules through `CapacitorCustomPlatform` + `PluginHeaders` +
`nativePromise/nativeCallback`, so **no website code changed**; `src/features/nativeApp/hostBridge.test.ts` runs the real `@capacitor/core`
against it. **The collector runs in React Native, not the page** (`mobile/src/collector/`, `expo-location` + `expo-task-manager`; the
owner chose `expo-location` over a paid background-geolocation library, 2026-11-22): `core.ts` is its rules as plain TypeScript with
every outside thing passed in (`core.test.ts`, 15 tests, run by the root `npm test` — `vite.config.ts` includes `mobile/src`), driven by
the background task and a 30 s timer, resumed from saved state on a launch with no page. **Consent, the "location is off" banner and
answering Locate now are native too** (`mobile/src/location/`, `mobile/src/locate/`, mounted in `mobile/App.tsx` over the site): the
phone shows the agreement itself and posts it to `/api/location-tracking/consent`, the website draws neither inside the app
(`phoneOwns` in `useLocationCollector`), and an open Locate now ask is answered silently at most once a minute (collector timer and
app foreground). **The page's own `navigator.geolocation` is answered by the phone too** (2026-11-23, `mobile/src/host/geolocationShim.ts`, injected with the bridge shim; tested): without it WKWebView asked for location a second time for the website (Route Planner's dot, Optimize route) although the app already had it. Page calls go to the app's `Geolocation` plugin, which returns the collector's newest point if under 20 s old (`host/lastFix.ts`); a visit's stamp asks for `maximumAge: 0` and still gets a fresh read. App only, needs a new app build; not tried on a real iPhone. **A closed iPhone app is restarted by a geofence (2026-11-23, after a phone showed no data 8:53–11:06 AM; `mobile/src/collector/wake.ts`, tested):**
the collector keeps a 200 m circle around the newest in-window position, `WAKE_TASK` calls `wake()` (→ `resume()` + tick) when iOS fires it, and
Team Location's "No data" line now says the app may not have been running (`PersonPanel.tsx`). Unproven: whether iOS (26 especially) relaunches a
force-quit app, and a phone that never crosses the circle isn't woken. Android is not restarted. Still true: an ask outside 7–6 waits until the app is next opened, and none of it has run on a real phone. Known
losses and unverified parts are in `mobile/README.md` (Android push needs FCM; **never run on a real phone**; the Android debug app builds, the iOS build is
untried because CocoaPods isn't installed). The web `/login` page renders nothing in any native app (`CustomerLoginPage`), so a native
sign-in screen is mandatory on every platform (the earlier Capacitor Android app had none: its login was blank).

## Send Notification: an admin's message to people's iPhones (2026-11-21)

Admin → **Send Notification** (`src/features/notifications/`, nav `send_notification`): pick people (search, a
branch heading ticks only those with a phone) and send a message of up to 120 characters under the fixed title
"Easy Surfaces". Rules `src/utils/pushSend.ts` (tested), API `src/routes/pushSend.ts` at `/api/push-send`
(`GET /people`, `POST /`; tested), the sender is `sendPushToUsers` (`src/services/apns.ts`). Switch
`send_notifications` (Users & Roles → **Notifications**; nobody holds it until an admin ticks it). Recipients are
limited to the **sender's team** (`teamScope.ts`; All-location logins reach everyone), deactivated people excluded;
an id outside the team is dropped, never confirmed. Only a person with a **registered phone** (signed in to the iOS
app, notifications allowed) receives it — the screen greys out the rest and the answer names who had none. **Not
built:** a log table (each send is only a server log line), scheduling, templates, sending to a role, and opening a
specific screen on tap (every push opens `/sales`). `POST /api/push-devices/test` also takes an optional `message`.

## Phone tab bar (2026-10-18)

Under 640px SalesPage shows a bottom tab bar instead of the drawer
(`src/components/sales/PhoneTabBar.tsx` + `.css`; owner's design: claude.ai
artifacts **Phone tab bar canvas** https://claude.ai/artifact/Qxs7fJxBs6MGJYiXowkirQ
and **Phone menu search** https://claude.ai/artifact/GZ622Er9juw3MXzr6JjySA).
Dashboard · two modules (Sales, Operations by default) · **More**. What sits
on the bar, which tab is lit and what the page search finds are in
`src/utils/phoneNav.ts` (tested): the bar takes the first two modules the login
can open in the admin's Side Nav Order and More lists the rest, so a new page
or module in `navPins.js` shows up with no phone-specific change (its icon goes
in `src/components/sales/navIcons.ts`, shared with the desktop rail). Customers
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
and the rules live in `src/utils/checkInAccess.ts`; the routes, the screens,
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

## Selection Sheet: one customer copy, printed and emailed (2026-11-07, on `feat/selection-sheet-print`)

What a customer or fabricator gets is direction A of the claude.ai canvas
**Selection Sheet — customer copy** (https://claude.ai/artifact/F6qJqYpyfiuWiqyvaS8Viz;
the owner's comments on it set every rule here; the staff form keeps its own
canvas). **The email is the printed sheet** (owner's call): logo + "Stone
Selection" with the day and branch; Prepared for / Fabricator / Your sales rep,
each a name over a phone or email; Your selections (#, material, lot, slabs,
size, Price / SF only when asked — **no slab count per row**, "Ask your rep"
for a material with no price); Notes (printed notes only); **Hold Policy** —
the policy word for word plus three steps; footer with the branch address left
and **its phone right** (`letterheadFor(loc).phone`, only with the branch's own
address). What it says is `sheetDoc` in `src/utils/selectionSheet.ts` (tested);
`buildSelectionSheetHtml` (print) and `selectionSheetEmailHtml`
(`src/services/emailService.ts`) only lay it out — change both together. The
print page sets `@page { margin: 0 }` so browsers print no date / about:blank /
page count of their own. The email is fluid with no media queries and survives a **forward** (an
Outlook forward dropped our text-align and text-transform): the three people
are blocks in an `align="left"` cell, written with no space between them,
three across the 600px email's width and on a phone one per line (so an email
address stays on one line; each width is a table's width attribute, which a
forward keeps — 2026-11-09), labels typed in capitals; one row per material. A forward
also ignores `color: inherit` (links went blue) and a `<div>`'s width / height
(the step rings stretched into their words; the people lost their widths):
name colours outright, size with table-cell attributes, space with margins
or padding (2026-11-09). In
**dark mode** it shows the gold mark (`favicon.png`) beside "EASY STONES" as
text, never the full logo image (its dark lettering vanished), and phones /
emails are our own `tel:` / `mailto:` links in the text's colour. Subject
"Selection Sheet: <name>", sent as "Easy Stones" (owner, 2026-11-07), reply-to the rep.
The Email pop-up asks **Home Owner** (their email, without prices first) or
**Fabricator** (typed address — a check-in keeps no fabricator email — with
prices first); both send the same sheet.

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
rules live in `src/services/staffSession.ts`, the routes in
`src/routes/userOnboarding.ts`; a new way to sign in or set a password goes
through them. Five wrong passwords lock an account for 15 minutes
(`User.incLoginAttempts`); Users & Roles and `/admin` badge it "Locked"
(`lockedUntil` in `src/utils/userForm.ts`), Edit user → Sign-in has **Unlock
now** (`POST /api/admin/users/:id/unlock`, `manage_users`), and any password
reset or chosen password also lifts it (`clearSignInLock`).

## Users, Roles & Permissions, Locations; team access (2026-10-16)

Users & Roles is three Admin-rail pages (`users`, `roles`, `locations` in
`navPins.js`; one screen, `UsersRolesTab`, with a `section` — the module is
`src/features/users/`, Side Nav Order included). Users also opens
for **team access**: the `manage_team_users` permission (Users & Roles card →
Team) lets a manager/director see the people at their own locations, who is
online, and **deactivate / reactivate / unlock** them — nothing else (no add,
edit, delete, passwords, Roles, Locations; those stay `manage_users`). Which
people: the role's `manageableRoles` (Roles & Permissions → "People … can
manage", chosen per role by an admin), only those whose locations are **all**
the manager's, never themselves or an admin. Rules in `src/utils/teamAccess.ts`
(shared), the guard in `src/services/teamAccess.ts`; the Users list, presence,
active and unlock routes use `usersAccess` / `memberAllowed`. A new Users
action for managers must go through them. Nobody holds the permission until
an admin turns it on.

**One permission per action (2026-10-16).** Every Users & Roles action has its
own switch (`src/utils/usersAccess.ts`: view/add/edit/reset sign-in/
deactivate/unlock/delete users; view/edit/add/delete roles; view/add/edit/
delete locations; side nav order), on the Users & Roles card in sections.
`manage_users` is now **Full access**: it holds every one, so existing roles
lost nothing. Any action in an area opens that area's page and loads its list
(no separate "view" needed). Routes use `requireAction(key)` /
`requireArea(area)` / `usersAccess(key)` (`src/services/teamAccess.ts`), never
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
(`src/services/presence.ts`: one entry per tab, **Active** until 10 minutes
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
  Bellingham's month check also looks up a saved permit by number if it drops
  out of the issued-date query (2026-10-24): the city can move or clear its
  issue date. Only a source-confirmed correction updates it. A cleared date is
  saved as null, retaining the record while excluding it from issued leads,
  exports and contractor counts; an unexplained disappearance stays a warning.
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
  posted some days into the next month, so permits are up to a month
  behind. Months are read **whole**, and while the window's month isn't posted
  the newest posted one is re-read (`monthlyReadFrom` in `common.ts`, Monroe
  too, 2026-11-02) — the 30-day window used to fail as empty from the 1st and
  then skip the first days of a month posted late; a month still missing a
  month after it ended fails the run. The applicant (name, company, mailing address) is the only contact —
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
  towers, demolitions); a blank work type or "Replacement Permit" is **Other
  building** (2026-10-24), following the broad-type rule, never inferred from its
  description. About 25 new homes a week. **The county's GIS data terms of use were
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
  **Lakewood** (2026-11-01, on `feat/lakewood-permits`): the city's public permit
  portal is a Clariti / OnCamino Public Portal (`lakewood_wa.claritilaunch.com`)
  whose pages call a **public GraphQL API with no login**
  (`api.app.oncamino.com/api/v1/graphql`, organization id 450; `rules/lakewood.ts`,
  `sources/lakewood.ts`). The reader asks for the ids of every type under
  "Building Applications", reads the list **newest change first** (checked as it's
  read — out of order stops the run), and takes each issued/finaled/closed lead's
  **issue day from its status history** (the list has none); a permit issued before
  the window is dropped. A permit's page adds description, applicant, owner and
  contractor names (no phone or email), units, parcel and expiry; **no project
  value** is published (the "Building Valuation Fee" is a fee). Leads: Single
  Family New Construction → New home, ADU → ADU, Major/Minor Remodel → Remodel,
  Major/Minor Tenant Improvement → Commercial remodel, "Commercial Building" →
  Other building (broad). Skipped by exact name: trades, re-roofs, windows, water
  heaters, signs, gates, accessory structures, manufactured homes, adult family
  homes, demolitions, solar, walls, pools, change of use. ~30 leads a month; a
  month-so-far check is a second read of the same portal. This is an undocumented
  API behind the portal's own pages: if the city or Clariti changes it, the run
  fails loudly and the query strings in `sources/lakewood.ts` are the first place to
  look. **Puyallup not built** (checked 2026-11-01): its portal
  (`permits.puyallupwa.gov`, CityView) answers scripts with a Cloudflare 403, and
  the city's ArcGIS `PermitToParcelJoin` layer stops at an issue date of 2023-10-12.
  Ask the permit center (253-864-4165) for a feed or recheck.
- **Benton and Franklin (the Tri-Cities)** (2026-11-01, on `feat/benton-franklin-permits`):
  **Richland** (`rules/richland.ts`, tenant `RichlandWAProd`) and **Kennewick**
  (`rules/kennewick.ts`, tenant `EnerGov_Prod`) are Tyler EnerGov, the Renton /
  Skagit reader, with valuation, square feet and contacts with phone and email
  (about 30 and 50 leads a month). Kennewick's "Alteration/Addition" types don't
  say which, so they're Other building; adult family homes, foundation-only,
  decks and outbuildings are skipped. **Pasco** (`rules/pasco.ts`) is eTRAKiT
  hosted by CentralSquare (`pas.csqrcloud.com/community-etrakit`, the old
  `egov-pasco.com` redirects there): Shoreline's reader with Pasco's export
  columns, names only, a day at a time (about 20 leads a fortnight, ~25 s). The
  form's "OWNER BUILDER" / "NONE" / "INFORMATION PROVIDED AT A LATER DATE" are
  not companies. **Not covered:** Benton County outside cities (the only layer,
  `BuildingPermitsAll`, is the assessor's table — issue dates run to the year
  2107 and it was last changed 2022), West Richland, Franklin County outside
  Pasco, and **Yakima County** (Accela, `aca-prod.accela.com/YAKIMACO`, plus
  weekly "Building Permits Issued" PDFs — not read yet).
- **Yakima** (the city; 2026-11-01, on `feat/yakima-permits`): the city's SmartGov
  Community portal (`ci-yakima-wa.smartgovcommunity.com`) publishes the public
  Exago report **Issued Permits for New Buildings** (`rules/yakima.ts`,
  `sources/yakima.ts`). Its runner was lifted out of the Anacortes reader into
  `sources/smartgovReport.ts` (`createExagoRunner`, same browserless steps; both
  cities use it, Anacortes' tests unchanged). **New buildings only** — new homes
  (single family, master plan), duplexes and multifamily, new commercial — with
  the applicant's name and the description; no remodels, no value, no contractor,
  no phone or email. About 17 a month. The city's other report, "Building
  Permits Issued - Previous Month", refuses CSV and is one fixed month, so it
  isn't read; the city could publish a wider report like Anacortes' "with
  Valuation". If the city changes a column the run fails loudly.
- **Kitsap** (2026-10-22, on `main` 2026-11-01): the county's
  Department of Community Development layer behind its Permit Explorer map
  (`rules/kitsapCounty.ts`, the shared ArcGIS reader). Unincorporated land and its
  UGAs only — Bremerton, Port Orchard, Poulsbo and Bainbridge have their own
  offices and aren't read. Value, units, square feet and address, a SmartGov
  link, **no contacts**, no city/ZIP. Same skips as Skagit; ADUs and guest houses
  are ADU / detached; `R-SFR/REPLACE` and `C-DAMAGE` are reported as unsorted.
  The county refreshes the layer in batches (last edit 12 days old when checked).
  About 25 new homes a month. Its GIS terms weren't read.
- **Clark** (same branch): the county's one "Permits - Building" layer for every
  office in Clark County (`rules/clarkCounty.ts`, `sources/clarkCounty.ts`).
  Clark County and Vancouver refresh weekly, **the other cities (Camas, Battle
  Ground, Ridgefield…) only quarterly**. The layer has no address, so the reader
  looks each lead's address/city/ZIP up by parcel serial number in the county's
  address layer (a failed lookup fails the run). Contact is the applicant's name
  (person, builder or architect — not said); no value, size or units. Case types
  RES / NHC / SFR / CMI; re-roofs, solar, signs, racks, cell and inspection-only
  skipped. About 90 new homes a month, ~150 of them Vancouver. Not read: its GIS terms.
- **Thurston** (checked 2026-10-22, **not built**): the only public data is
  Thurston Regional Planning Council's annual residential-permit layer (last
  edited 2024-11, 2019–2023 — useless for leads). The county's Accela portal is
  being replaced by a new Permit Customer Portal (launch announced 14 Oct 2026);
  recheck once it has a public search. Olympia, Lacey and Tumwater not checked.
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
`src/utils/spsSheet.ts`), and the partial unique index refuses a name held
twice; never write it from a request body (`PROTECTED_CUSTOMER_FIELDS`).
**Connect existing customers** (Customers ⋯ → Connect customers to SPS,
`src/utils/spsConnect.ts`, `src/routes/customerSpsConnect.ts`) gives today's
customers their key: exact names unasked, the rest by a person. The **new
import** (Customers ⋯ → Import from SPS, `src/features/customers/import/SpsImportModal.tsx`,
its state `useSpsImport.ts`, each step in `import/sps/`) is five steps
over saved runs (`SpsImportRun` / `SpsImportItem`): the planner
`src/utils/spsImportPlan.ts` gives every SPS name exactly one outcome (held
key → update; exact name → connect; deleted before → asked, never silent;
look-alike → "Need a decision" with Add as new pre-set; else new), the plan is
**frozen into items** at Start and written in batches by
`src/services/spsImportRunner.ts` (an upsert on the key, so a retry or a
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

Who the Route Planner offers is decided once, in `src/utils/routePlannerScope.ts`,
by the **locations assigned in Users & Roles** (not role name): admins and
all-location ('*') logins see every rep; anyone else sees the reps working at
their locations (a sales rep gets the same as a manager for now — the owner's
call; narrowing it later is a change to `repsInScope`/`inScopePins` only), their
customers, and the unowned ones at those locations ("Unassigned"). The server
routes live in `src/routes/customerMap.ts` (tested, in-memory MongoDB):
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
one fetches just theirs). The Filter reads Sales reps → **Level** (2026-11-18: a multi-select dropdown under the reps, Level 1–4 with counts, `LevelFilterPicker`; pins carry `level`, none counts as Level 3; saved as `activeLevels`) → Customer type → Days since
last visit; pins are map pins coloured by type (set A, `TYPE_COLORS` in
`features/routePlanner/helpers.ts`) or by last-visit age (the "Type colours | Visit
colours" switch, saved as `routePlannerFilters.pinColors`). Saved filters load
once and save only on a real change (`saveFilter`) — saving the empty starting
value before the real one loaded is what used to reset the rep ticks on every
open. **Location** (`src/utils/geolocationAccess.ts`): nothing prompts on its own;
the map opens on the last known spot, only a tap on Locate asks, and once the
browser has it allowed the position is followed quietly (only while the screen
and tab are showing). The permission itself is the browser's, not ours to keep.
The phone bar is icons plus a three-line More menu (`rail/MoreMenu.tsx`: Find new
leads, Live traffic — a new map option is another row there). The design lives in
the claude.ai artifact **Route Planner pin colours**
(https://claude.ai/artifact/BQ5XYqB2SjbnbgjLYSbnyh). The screen is
`src/features/routePlanner/` (2026-10-24): the page `RoutePlannerV2.tsx`, one
hook per job (`useSavedFilters`, `useMapPins`, `usePanels`, `useDayPlan`,
`useScheduleData` / `useScheduleActions`…), and `map/`, `rail/`, `panels/`,
`customer/` for its parts.

## Cart ticks are instant (2026-10-18)

An inventory checkbox shows the slab in the cart the moment it is clicked
(`pendingAdd`/`pendingRemove` in `src/features/holds/cartStore.ts`; `cartKeysOf` is what the
checkboxes read) and the server's answer replaces it — a refusal takes it back with
the reason. Your own change's socket echo is ignored and other people's events are
joined into one refresh of just the slabs that changed (`useSlabLocks`). The cart's
customer also shows at once, and Create hold follows the cart's customer rather than
copying it when it opens. Server: `findSlabs` reads the serial # through a
case-insensitive index (`InventoryItem.ts`), and `addToCart` / bundle removal are one
write each. **Every Cart & Holds model is in `INDEXED_MODELS`** — autoIndex is off,
and until 2026-10-18 they weren't, so the unique indexes that stop two holds on one
slab were never created in production (a startup log line names any that fail, e.g.
on duplicates already there).

## Saving a visit: the server decides, the form doesn't wait (2026-10-23, on `feat/visit-save-server`)

Add / edit visit is `src/routes/visits.ts` (tested in `visits.test.js`, in-memory
MongoDB; mounted in server.ts where the old routes were). The rules are the
server's, from `src/utils/visitForm.ts`: the type must be one of `VISIT_TYPES`
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
A visit save refreshes through `refreshVisitData`
(`src/features/visits/refreshVisitData.ts`, tested), for this browser's save and
another's `customer_update {kind:'visit'}`: the dashboard's visit data, the
open profile and the Customers list cache (Last visit) — not the customer
dropdown or resources. A new visit-changing route should emit the scoped event.

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
test (`*.test.tsx`, React Testing Library). `server.ts` is being split the same
way into `src/routes/<area>.js` routers, checked against a route-table
snapshot so no path, middleware or order changes.

## TypeScript and Node 24 (2026-10-23, on `feat/typescript`)

The plan is `MIGRATION_NOTES.md` §1. Render runs `node server.ts` on **Node
24** (owner's go-ahead 2026-10-23; `render.yaml`, `engines`, `.node-version`
pin 24.22.1), which strips TypeScript types itself, so any file may be `.ts`.
What the server loads must be **plain, erasable TypeScript** (no `enum`,
`namespace` or parameter properties — `erasableSyntaxOnly`), type-only imports
written `import type` (`verbatimModuleSyntax`), never `.tsx`, and every import
naming the file exactly, `.ts` included (`import x from './rules.ts'`) — Node
has no extension guessing. `scripts/check-server-ts.ts` walks what the server
loads and fails on a `.tsx` or an import Node can't find as written (the
missing-`.js` crash of 2026-10-23); `npm run build` runs it first, so on Render
a bad import fails the deploy instead of the live server. `npm run typecheck`
= `tsc` + that check. `.ts`/`.tsx` are strict; JavaScript is read for its
exports but not checked. Shared shapes are in `src/types/` (`Loose` marks a
record not typed yet — a spot to tighten). A shared `.js` file a typed one
imports gets JSDoc types when TypeScript misreads a parameter (`= []` reads as
an always-empty list). A conversion is types only: `git mv`, annotations,
importers updated, no behaviour change; check with typecheck, `npm test`,
`vite build`, and the screen by hand — for a server file also boot `server.ts`
(an in-memory MongoDB is enough).

## Daily Report: More menu and View Log (2026-11-04, on `feat/daily-report-log`)

The day sheet's top bar has one **More** menu (`components/MoreMenu.tsx`, was
Export): the PDF / email / CSV items, then **View Log** under a line (a
branch's day only). The log is `DailyReport.log`, written **only by `$push`**:
Submit, the 11:59 PM job (`claimSubmission(report, log)` — build `log` with
`submitLogFor` *before* setting the submit fields), Reopen with its reason,
both emails (branch list from `notifyDailyReportSubmission`, the Email button
with sender and addresses) and a transfer added after submit (Log arrival). A
new way to submit, reopen or change a submitted day writes its line too.
Rules and wording: `src/utils/dailyReportLog.ts` (tested); route `GET
/:date/log` (`src/routes/dailyReportLog.test.ts`, in-memory MongoDB). Days from
before the log show the one submit / reopen their fields kept (`earlier`),
copied into the log on the next write so nothing overwrites them. Why: Seattle
Nov 3 2026 emailed twice — Jeremy reopened it ("update payments") five minutes
after Scott submitted, nobody re-submitted, and the job signed it off.

## Payments: one entry per payment (2026-11-02, on `feat/payments-page`)

Operations → **Payments** (`src/features/payments/`, nav `payments`): every
payment a branch takes, one entry each, by branch and day — instead of typing
totals into the Daily Report (owner's ask). Design and the owner's calls: the
claude.ai artifact **Payments page prototype**
(https://claude.ai/artifact/4zkVgFWTfDFdtLdfVJjjQh). Rules are
`src/utils/paymentsReceived.ts` (tested), shared by the server and the screen:
Company (the shared customer list), date, method and amount required; methods
are the report's four plus **Return**, saved **negative whatever is typed**
(1000 or -1000 → −$1,000.00); a minus on any other method is refused; a card
reference keeps its last 4 digits only; amounts are cents. A payment is
**voided with a reason, never deleted**, and every add / edit / void is kept in
its `history`. **A day whose Daily Report is submitted is locked** — every
write to it, or moving a payment into or out of it, answers 409; reopening
the report unlocks it (owner's call, so the 11:59 PM auto-submit locks it too).
API `src/routes/paymentsReceived.ts` (tested): `/api/payments-received`
(list by branch + day with the day's status and the branch's own today,
`/summary`, add with the screen's own `_id` so a repeat answers
`alreadySaved`, edit, void). Branch access is the Daily Report's
(assignedLocations). Users & Roles → **Payments** card: View / Add / Edit /
Void, given once to roles holding `edit_daily_report` (all four) or
`view_daily_report` (View) — `PAYMENTS_MIGRATION`. The screen: title with
branch · day; DashboardSearch and the shared Filters (Day, Location — one
branch, no "All" — Method, Show voided) together at the right; a tile per
method that also filters; the list's total line for what's shown (to check
against a deposit slip / card batch / cash count); the round gold + (no Add
in the header); phones put the tiles behind a stats button. The form's
dropdowns use **`keepInForm`** (FormPicker / FormSearchPicker, opt-in, owner
2026-11-02: never the bottom sheet on desktop — below if it fits, above if it
all fits, else the roomier side sized to it, scrolling inside — the form never moves); other forms are unchanged
until the owner decides app-wide. **The Daily Report reads it** (switch-over,
owner's go-ahead 2026-11-02): from `PAYMENTS_FROM_PAGE_SINCE` (2026-11-02, in
`src/utils/dailyReportPayments.ts`) `deriveFromSystem` reads the day's live
entries and `applyDerived` sets the report's Payments from them (every method,
**Return** a fifth method with a negative amount, the total the net) — read
only on the sheet; "Nothing taken today" (every method 0) stands while there
are none; a stored grid with no entries left goes back to not recorded.
Submit / auto-submit freeze it like every derived figure; a day with only
payments counts as activity for the 11:59 auto-submit. The PDF, month view
and CSV (Return count / amount columns) follow. Days before the start keep
their typed grid (no Return row) and show "Payments page: $X" under it
(`usePaymentsSummary`). Tests: `src/routes/dailyReportPaymentsFromPage.test.ts`.

## Credit Card Receipts: the upload is the expense (2026-11-05, on `feat/card-receipts`)

**Moved to the Sales module 2026-11-19** (owner's ask): nav `card_receipts` is under Sales, not Accounting; permissions and routes unchanged.

Sales → **Credit Card Receipts** (`src/features/cardReceipts/`, nav
`card_receipts`) and Admin → **Receipt Categories** (`receipt_categories`).
Design and the owner's calls: the claude.ai artifacts **Credit Card Receipts
Architecture** (https://claude.ai/artifact/64fQdQpmprHrsVuMbnBYDh) and **Credit
Card Receipts UX** (https://claude.ai/artifact/CjnEH4QoPTtBwKt7hWYEvC). Rules are
`src/utils/cardReceipts.ts` (tested), shared by the server and the screens; API
`src/routes/cardReceipts.ts` (tested, in-memory MongoDB) at `/api/card-receipts`;
models `src/models/CardReceipts.ts` (`CompanyCard`, `ReceiptCategory`, `CardExpense`).
- **One card per person** (`CompanyCard`, unique active per user and per card
  ID like `MARU92069`: first 4 letters of the name + the last 5 digits).
- **The cardholder uploads the receipt right after paying, and that upload is
  the expense.** It belongs to the uploader and their card — never to a name or
  digits printed on the receipt (Apple Pay prints other digits). The branch is
  their home location, saved on the expense. The photo / PDF uploads when picked
  (`POST /attachments`); the screen makes the `_id`, so a repeat answers
  `alreadySaved`; the same day + total already saved answers 409 `repeat` until
  "Save anyway" (`confirmRepeat`).
- **Draft → Waiting for approval → Approved**, or **Sent back** with a comment.
  Complete = a receipt or a **lost-receipt reason**, a category, and the
  category's own fields (customer, and a **note** when the category requires one — 2026-11-23: a category's
  "Required on every receipt" ticks are Customer and Note; Who attended and Business purpose were removed, old receipts keep
  theirs and nothing asks for them; Postgres `receipt_categories.needs_note`, migration `0031`); until then it saves
  as a draft. Approved can't be edited; voided with a reason, never deleted.
- **Approval: Accounting always, a second person from $150** (owner, 2026-11-23, on `feat/receipt-approvals`; replaces the
  old "each role lists the roles whose receipts it approves" — `Role.approvesCardReceiptsOf` and its Roles screen picker are
  gone, nothing reads it). **Every rule is `src/utils/receiptApproval.ts` (tested); never re-implement one, never check a
  role name elsewhere.** Every receipt needs the **Accounting approval** (an Accounting member, or an Admin standing in —
  two Admins cover it when Accounting is away); **$150.00 and above** (`needsSecondApproval`; `isBigReceipt` is the same
  line now) also needs a **second approval, in parallel, by a different person**: for a staff member's receipt their branch's
  manager / director (`isBranchManagerOf`: home or assigned location, an all-locations '*' login is on no branch) **or** an
  Admin; for a manager's, director's or Accounting member's, an Admin; an **Admin's own** receipt needs Accounting only, at any
  amount. Nobody approves their own; a lost receipt needs the approver's comment. Stored on the expense as `approval` (the
  Accounting one, with `as`), `secondApproval`, `ask` and `reminders` (`card_expenses`, migration `0032`, which also moves a
  waiting receipt's old step 1 to the matching approval and turns an Admin's Missing rows into Waiting). The screens read
  the server's per-viewer `actions` / `chips` / `waitingReason`, not the rules. **Ask** (Accounting or an Admin; the target
  must be an active person whose role holds Approve — branch manager / Admin for staff receipts, an Admin otherwise): they
  comment, which **approves** (fills the second approval when theirs); asking takes back an Accounting approval, so
  Accounting gives the final one; while a question is open nobody else approves, and it can be withdrawn. **Send back**
  (comment) clears both approvals and the question; **Reopen** (reason) puts an approved receipt back to Waiting; **a holder's
  edit clears both approvals**. An **Admin's charge with no upload** is Waiting, never Missing (Statements shows "Waiting for
  Accounting"); Accounting fills category / type / customer / note (`PUT /expenses/:id/details`) and approves it with no
  receipt. Accounting, Manager and Director roles are given Approve once (`NEW_PERMISSION_GRANTS` in server.ts), which
  chains to **Send receipt reminders** (`send_receipt_reminders`, `ACTION_MIGRATIONS`). **Reminders**
  (`src/utils/receiptReminders.ts`, tested; job `src/jobs/missingReceiptReminders.ts`, hourly): a Missing receipt gets one email
  to the holder and their branch managers (Admins if none) + a phone push to the holder 48 h after its row was made, and one to
  the holder, branch managers, every Accounting member and Admin at 72 h (an older row gets the 72 h one only; stamps in
  `reminders`, set before sending so a crash can't double-send). A person sends more with **Send reminder** on one or several
  receipts (`POST /api/card-receipts/expenses/remind`, `src/routes/cardReceiptReminders.ts`): Accounting / Admins for anyone,
  managers for their team, **once per receipt per Pacific day**, one email per person listing their receipts, written in the
  receipt's history without moving `updatedAt`. Push is iPhone only (no FCM yet) and a tap opens the Credit Card Receipts page (2026-11-23: an app already open on Sales used to stay where it was — the URL's `?tab=` is only read at load, so `PushRegistrar` also fires `requestSalesTab`, `src/utils/salesTabEvent.ts`, which `useSalesNavigation` answers if they may see the page); it still doesn't open the one receipt.
  **Not tried on a real phone or with real mail**; the owner has not answered whether an Admin's own Missing row should get a
  reminder (it doesn't) or how a receipt with no branch is handled (Admins get the 48 h email).
  **Send reminder redesign (2026-11-23, on `feat/reminder-design`; claude.ai artifact **Receipt Reminder Canvas**,
  https://claude.ai/artifact/X8An8cCBgbQVXuHYWqwGsZ):** the form names who each group means
  (`POST /expenses/remind/preview` → `previewGroups`, never the sender) and the Send button says "Send to N people"; the answer
  lists who was reached, each skipped receipt with its reason and who got only one way (`RemindOutcome`); a receipt whose only
  possible people is the sender is skipped with that reason (`nobodyReason`), not stamped; the email lists each receipt as a row
  with its amount and a total for several (`EmailWords.rows` / `total`, table layout so a forward keeps it). Not built from the
  canvas: the "no phone" warning before sending (it's in the answer after). **What the answer says is true (same day):** the
  server sends *before* answering; someone with neither an email nor a phone is never counted as reminded (the receipt is
  skipped, unstamped, and they're listed in `noContact`); if nothing got through, the day's stamp is cleared (`lastDay: ''`)
  with a "reminder not delivered" history line and the receipt is skipped with "Try again"; the preview leaves out receipts
  the send would skip (`remindProblem`) and returns them with their reasons.
- **Adding a receipt for someone** (2026-11-23, on `feat/receipt-on-behalf`; owner's ask): switch `add_receipts_for_others`
  (Users & Roles → Credit Card Receipts → **Add receipts for others**; Admins hold it, nobody else until ticked). `POST /expenses`
  takes `onBehalfOf` (a cardholder's id): the receipt is **theirs** — their card (their other card by `cardId`), name and home
  location, they edit it, the Amex check matches it as theirs — and only the history says who typed it ("added · on behalf of
  Maria"; `createdBy` is the adder). The photo must be one the adder uploaded. Refused: without the switch (403), an inactive
  person (400), a person with no card (409). The form's "Receipt for" picker (search) comes from `GET /add-for-holders`
  (active people with an active card); the round + shows for someone with the switch even with no card of their own. Editing,
  voiding and the rest stay the cardholder's / Approve's.
  **The person who added it can't approve it** (owner, 2026-11-23): `addedById` on the expense (`card_expenses.added_by_id`,
  migration `0033`; Mongo `addedById`) counts like the cardholder in `receiptApproval.ts`'s `isHolder` — no Approve, Ask, Send back,
  Reopen or Answer, never asked, not a reminder recipient — so someone else does the Accounting approval and the second one. The
  drawer says "Added by". Receipts added before this have no `addedById`. **Run `npm run pg:migrate -- --apply` on Render for 0033.**
- **Categories** are a list in the database, seeded once
  (`STARTING_CATEGORIES`); `name` is stored and never changes, `label` is shown.
  A hidden one can't start an expense but stays valid on old ones; one in use is
  deleted only by moving its expenses to a shown one.
- **Excel** starts with the six columns of the card log accounting keeps today
  (Transaction Date MM-DD-YYYY · Location · C C Holder Name · Credit Card Number ·
  Description · Spent Amount; owner's sample), new fields after (`exportRows`; a **Bank** column right after
  Spent Amount since 2026-11-23). **Download by bank (2026-11-23, on `feat/receipt-categories-list`):** every expense the list
  sends carries its card's `issuer` (`issuersByCard` / `viewOf` in `src/routes/cardReceipts.ts`; a row with none is Amex,
  `onBank`), the Filters panel has a **Card** field (Amex and Encore / Amex / Encore) and "Export this view" follows it
  (switch `export_card_receipts`). **Export all months** is a second switch, `export_all_card_receipts` ("Export all",
  Users & Roles → Credit Card Receipts; nobody holds it until an admin ticks it — admin through
  `ALL_CARD_RECEIPT_PERMISSIONS`): `GET /api/card-receipts/expenses/export?bank=` answers every month for one bank or both,
  only the people the caller may see (View all → everyone, View branch → their team, else their own), capped at
  `EXPENSE_LIST_CAP` with `truncated`. The server checks the switch; the menu item is only its mirror.
- Switches (Users & Roles → Accounting · Credit Card Receipts and Admin ·
  Receipt Categories, `CARD_RECEIPTS`): My receipts, View all, Approve, Export,
  Manage cards; categories add / edit / reorder / delete. Admin gets them through
  `ALL_ACCOUNTING_PERMISSIONS`; nobody else until an admin turns them on.
- **Reading the receipt** (2026-11-20, on `feat/receipt-scan`): after an upload the
  form asks `POST /api/card-receipts/scan` (`src/routes/cardReceiptScan.ts`, its own
  router; tested with a fake scanner) and Claude reads the photo / PDF
  (`src/services/receiptScan.ts`, `@anthropic-ai/sdk`, structured output, low effort).
  Rules in `src/utils/receiptScan.ts` (tested): the schema and prompt, `cleanScan`
  (a date that isn't real / is in the future / over 400 days back, non-money amounts and
  hidden or unknown categories become blank — never guessed), `fillFromScan` (fills
  **only empty fields**, and a new form's untouched starting date; never what was typed).
  The line under the photo says what was filled ("Check them"). Only files the app stored
  are read (`isFilesCdnUrl` / Cloudinary). Off without `ANTHROPIC_API_KEY` (503, the form
  says nothing); `RECEIPT_SCAN_MODEL` picks the model (default `claude-opus-5-5`, server-side
  fallbacks on). The card and person never come from the receipt. Compare models on real
  receipts with `scripts/receipt-scan-test.ts <folder>` before choosing (Oct 2026 volume:
  ~1,050 charges a month). Not done: a real-receipt test.
- **Add / Edit receipt looks like Splitwise's bill screen** (owner, 2026-11-20, on
  `feat/receipt-bill-screen`; a deliberate step away from FORM_TEMPLATE's field-by-field
  layout for this one form): a **Bill details** card (`components/BillCard.tsx`: photo,
  merchant, total · date, Subtotal, Tax, Tip or "+ Add tip", Total, and the reading's note),
  then Category (with what that category asks for: customer, attendees, purpose) and a Note.
  The **pencil** (or "+ Add tip") swaps the same FormModal to **Edit bill details**
  (`components/BillDetailsEdit.tsx`: merchant, date, total, subtotal, tax, tip; Save goes back,
  ✕ puts back what was there). A save missing merchant / date / total, or a server answer about
  them, opens that screen; after a photo, if the reading left merchant or total blank (or reading
  is off) it opens by itself with the photo large. Total is what was charged to the card;
  subtotal / tax / tip are information only — nothing adds them up.
- **An opened receipt: View full size stays in the window** (2026-11-24, on `feat/receipt-view-fullsize`; claude.ai artifact **Receipt full-size viewer**,
  https://claude.ai/artifact/VFEf8Ffa4RZqTeMNr3b1a1 — boards 1–7 light, 8–11 light and dark; the owner's comments set every rule). The photo
  thumbnail is a button with a "View full size" chip; it swaps `ExpenseDrawer`'s body for `ReceiptPreview variant="viewer"` (Back to receipt, − / + / fit,
  double-tap and pinch; ✕ and Esc go back, not close) — never a new tab. A **PDF** opens the same way, drawn by pdf.js (`receiptPdf.ts`, a copy of the Hold
  letter preview's loader: the receipt file route answers with `sandbox`, which blocks the browser's own PDF viewer in a frame, and iOS frames show page 1 only);
  a file it can't fetch (an old Cloudinary / CDN address with no CORS) says so and links "Open it in a new tab". The Add / Edit form's thumbnail does the same.
  The header carries no amount (the Total row does, gold from $150); the status band and the reminder pill sit directly above Activity (`.ccr-state`).
  Every colour is a token, so light and dark follow the app. Phone: the viewer is the full-screen sheet. Not tried on a real iPhone.
- **Add receipt asks how first** (2026-11-21, on `feat/receipt-capture`; claude.ai artifact **Receipt capture flow**,
  https://claude.ai/artifact/XZPwWL45sLa6o2EbQZPKDU): the round camera opens `AddReceiptChoice` (a size-S form, ✕, no
  footer — `FormModal`'s `hideFooter`): **Open Camera** (`CameraCapture`: `getUserMedia` back camera, corner guides, flash
  where the camera has one, Retake / Use photo; blocked or unavailable → it says so and offers the phone's own camera),
  **Upload Photo**, **Upload File**, **Lost Receipt** (opens the form on the lost reason), and a drop box with a mouse. A
  chosen file reaches the form as `initialFile`, uploads and is read as it opens. `receiptFileProblem`
  (`src/utils/receiptFile.ts`, tested) turns away anything but a photo / PDF ≤10 MB in the window and in the form. On a phone
  the choice is the form template's full-screen sheet, not the canvas's bottom sheet. Not built: the canvas's step list while
  reading. **Never tried on a real iPhone** (camera permission text is in Info.plist; test the shutter there).
- **Review of 2026-11-20 (on `main`, owner's calls):** the **$150 second step stays a fixed limit** (no per-role
  dollar limit yet; since 2026-11-23 it is `needsSecondApproval` in `receiptApproval.ts`, and the old
  `BIG_RECEIPT_APPROVER_ROLES` / `canApprove` / `approvalStep` in `cardReceipts.ts` are left unused — delete them). **View branch** (`view_branch_card_receipts`, Users & Roles →
  Credit Card Receipts) shows the expenses of the caller's **team by where the person works** — the Visits rule, `teamOfRequest`
  (`GET /expenses?scope=all`); View all still wins; the Cards tab stays View all / Manage cards only. An expense that
  answers an Amex charge keeps Amex's **date and total** (`matchedChangeProblem`; the rest is still editable). The
  receipt link must be a file this app stored in the `CardReceipts/` folder (`isReceiptFolderUrl`, both on save and in
  `/scan`, which no longer reads any other CDN file); new file keys are random (`randomBytes`, not `Math.random`);
  `/attachments` has a 10 MB cap and 40 per 10 minutes per person, `/scan` 20 per 10 minutes and 100 a day (in memory,
  per instance); Approve / Send back send `expectedUpdatedAt` and answer 409 `changed` if the cardholder edited it since.
  **Private receipts (2026-11-20):** a new receipt is stored in S3 under `private/CardReceipts/` (uploader kept in the
  object's metadata) and the expense saves the app's own address `/api/card-receipts/files/<name>`, never a CDN link.
  `GET /files/:name` (`src/routes/cardReceipts.ts`) streams it only to who may see the expense — the holder, View all,
  View branch over the holder, or an approver of that holder (or the over-$150 second step) — and before it is on an
  expense only to its uploader; everyone else gets 404. A save only takes a private file the person uploaded.
  `/scan` reads a private file itself (bytes, uploader only). The aws-infra files stack answers 403 for everything
  under `private/` (`PRIVATE_BLOCK_FUNCTION`; **needs `cdk deploy` of the files stack**, order doesn't matter). The
  Excel's Receipt link is the site address (opens only when signed in). Only S3 can keep a private file (Cloudinary /
  disk stay public); receipts saved before 2026-11-20 are still public links until a copy script moves them
  (not written). **Not done:** the Cardholder filter, not the dashboard's People field, narrows the list.
- **Hardening of 2026-11-24 (review S5–S8, on `fix/card-receipts-hardening`):** a PDF sent to `/attachments` must start
  with `%PDF-` (`src/utils/receiptPdf.ts`); **setting up a card from the Statements tab** (`POST /statements/cards`, or card
  picks in a preview / import) needs **Manage cards**, not just the Amex check; `/api/card-receipts` parses JSON up to
  **15 MB** (server.ts, before the global 200 MB parser); the upload and AI-scan limits count in **Postgres**
  (`rate_limit_hits`, migration `0035`, `PostgresRateLimitStore`) so every Lambda instance shares them — if the database
  can't be reached the request passes (`passOnStoreError`). **Run `npm run pg:migrate -- --apply` on Render for `0035`.**
  A new limit that guards money uses that store, never the default in-memory one.
  **Limits raised 2026-11-24 (owner):** uploads 100 per 10 min, AI scan 40 per 10 min and 200 a day; files — a **photo** up to
  25 MB on the phone (`MAX_RECEIPT_PHOTO_BYTES`; the browser shrinks it to 2000px JPEG before sending, so the wire is small), a
  **PDF** up to 20 MB (`MAX_RECEIPT_PDF_BYTES`; sent as it is, never recompressed — a bigger scan should be a photo), JSON for
  `/api/card-receipts` up to 30 MB. **Receipt photos are saved as JPEG** (quality 85, mozjpeg, white behind any transparency —
  `format: 'jpeg'` on `processBase64Image`); visits and resources still save WebP; receipts stored earlier as WebP still open.
  Not built: HEIC conversion for Chrome / Firefox on a desktop (those can't open a HEIC photo; iPhones / Safari can) — add
  `heic2any` if staff hit it. On Lambda a request body is capped at about 6 MB, so uploads will need to go straight to S3.
- **Edit any, Void any, Delete** (2026-11-24, on `feat/receipt-edit-any`; owner's ask — Accounting fixes any receipt, admins delete):
  three switches on the Credit Card Receipts card, nobody holds them until an admin ticks them (Admins hold every key):
  `edit_any_card_receipt` — `PUT /expenses/:id` for anyone's receipt, approved ones too, never a voided one; a waiting or approved
  receipt **keeps its status and approvals** (`statusAfterAnyEdit`: a typo fix isn't approved again), a missing / draft / sent-back one
  follows the usual rule, the card choice is the holder's, history says "edited for <first name>"; an Amex-matched receipt still keeps
  Amex's date and total. `void_any_card_receipt` — `POST /expenses/:id/void` for anyone's, approved ones too, reason required; a charge
  on a bank statement still can't be voided. `delete_card_receipts` — `DELETE /expenses/:id` with a reason of 5+ characters
  (`deleteReasonProblem`): the whole record is saved first to `card_expense_deletions` (Postgres, migration `0034`; MongoDB's
  `cardexpensedeletions`) with who and why, then removed with its history; a bank-statement charge's row can't be deleted. The
  drawer's ⋯ shows Void receipt / Delete receipt… by these switches. **Run `npm run pg:migrate -- --apply` on Render for `0034`.**
  Void and Delete are also in each desktop row's ⋯ (a last column in `ExpenseList`, the shared `RowMenu`) and, for **ticked**
  receipts, in the header ⋯ under Export… ("Void 3 selected…" / "Delete 3 selected…", `BulkReasonForm`: one reason, each goes through
  the single route, a refused one is listed and the rest still go). Phone cards have no row ⋯ — a tap opens the receipt, whose ⋯ has them.
  Not built: reading a deleted receipt back in the app (an admin reads the table), restoring one.
- **Add several receipts** (2026-11-24, owner's ask — to clear a pile of pending receipts at once; design: claude.ai artifact
  **Add several receipts**, https://claude.ai/artifact/S2vxNjAb6abdokf1qRtDqJ — made after the build, so change one with the other): Add receipt →
  **Add several**, only with the switch `add_several_card_receipts` **and** `add_receipts_for_others` (Users & Roles →
  Credit Card Receipts → Receipts; admins hold it, Accounting is ticked by an admin). One **cardholder and one card per
  batch** (locked once files are in; people with two cards pick one), up to 25 files (`src/utils/receiptBatch.ts`, tested).
  Each file uploads and is read as it's picked; each row has its own category / customer / note; **Save all** sends one
  ordinary `POST /expenses` per row with the row's own id (a retry can't double it, the Amex check still matches each to
  its charge and clears its Missing row), complete rows go to approval, incomplete ones are kept as **drafts** (owner's
  call), a row that looks like a repeat waits for its own Save anyway. A save carries `batch: {n, of}`: the server
  needs both switches for it and the history says "added in a batch (3 of 5)". The one-person rule is the screen's (the
  server can't see across requests). Screen `src/features/cardReceipts/bulk/` (`useReceiptBatch`, `BulkReceiptsForm`).
- **Custom date range** (2026-11-24): the Expenses tab's month stepper has a **Custom** button — From / To days
  (shared `DatePicker`, at most a year, both ends included) in place of the month; **Month** goes back. The server
  answers `GET /expenses?scope=…&from=&to=` (rules `rangeProblem` / `inRange` / `rangeLabel` in `src/utils/cardReceipts.ts`;
  filter kind `range` in `src/db/cardReceipts`, Mongo and Postgres, parity-tested) with the same people rules as a month.
  Waiting for me, To do, Statements and Export… are unchanged (Export still asks for a month or all months).
- **Not built yet** (owner's plan, in this order): the weekly **Amex
  PDF** check (a line with no upload → `missing` "Missing receipt"; needs a
  sample statement), the daily reminder email, closing a month.
  The `missing` status and `approvesCardReceiptsOf` already exist for them.
- **Export… (2026-11-23, claude.ai artifact **Card Receipts Export Pop-up**, https://claude.ai/artifact/Kwi3UnW7tYAb7j56F6295p):**
  the ⋯ menu has one item that opens `components/ExportDialog.tsx` — **Card** (Amex and Encore / Amex / Encore, starts on the
  Filters panel's Card), **Months** (This month / All months; hidden without Export all) and **Format** (Excel / PDF). Rules in
  `src/utils/cardReceiptsExport.ts` (tested): This month needs Export, All months needs Export all, and **a PDF is one month
  only** (PDF and All months grey each other out). "This month" is the month's receipts for the bank, ignoring the other
  filters (the old "Export this view" is gone, my call — owner unanswered). The PDF (`src/utils/cardReceiptsPdf.ts`, pdf-lib in
  the browser, same rows as the Excel minus the link / approver / notes columns, 2,000-line cap, total of the whole month) is
  written by `exportFiles.ts`. Never opened in a real PDF reader yet.

**The Amex check** (2026-11-20, on `feat/amex-check`; owner's answers that day — it replaces the
weekly PDF plan): Credit Card Receipts → **Statements** tab (switch `check_amex_statements`,
"Amex check" on the Users & Roles card; admin gets it with the other Accounting keys). Accounting
uploads Amex's activity export (.xlsx, sheet "Transaction Details"); rules
`src/utils/amexStatement.ts` (tested), read in the parse worker (`amex-activity`), API
`src/routes/cardReceiptStatements.ts` at `/api/card-receipts/statements` (tested on PGlite, with
the receipts router), data `src/db/cardStatements/`, tables `card_statement_lines` (id = Amex's
**Reference**, so a re-upload or overlapping week adds nothing) and `card_statement_imports`,
migration `0023_card_statements` — **Postgres only** (the area was cut over and locked 2026-11-14).
A charge's card is its **last 5 digits** (Amex's Account #), never the name; a match is the **same
card, exact amount, at most 2 days apart**, automatic (the cardholder enters the total with the
tip — no hand-linking). **Credits / payments / refunds and interest / fees need no receipt**
(`kindOf`); freight and subscriptions do. A charge with no upload becomes a real `missing`
expense for its holder (Amex's day, merchant, amount), which they finish like a draft; only charges
from `MISSING_FROM` (**2026-11-01**) do — earlier ones are listed and matched only. A receipt saved
later claims its charge and voids that Missing row (`afterReceiptSaved` in `POST /expenses`, which
no longer calls a Missing row a repeat); an expense that answers a charge can't be voided. Cards
Amex names that nobody set up are listed (only cards with a charge), picked in the upload or the
tab, and set up as `FIRS12345` in the same transaction as the check. Amex's "Receipt" `*` is
ignored (merchant e-receipts; staff don't use the Amex app). **A card may have no holder yet**
(2026-11-20, migration `0024`: `company_cards.user_id` nullable; owner's call so every card from the
card-holder sheet exists before each holder has a login): `scripts/card-holders-setup.ts <sheet>
[--unassigned] [--leave=ID,ID] [--apply]` (dry run by default; matches by email, never a mailbox shared
by several holders, then name) — the sheet itself stays out of the repo, it's public. Charges on such a
card link to it and show **Missing receipt** (owner, 2026-11-20: the card is enough to identify the charge; counted in the still-missing total); the openable Missing row is made only once Cards →
**Assign to a person** gives it a holder, which re-runs the check (`afterCardSaved`). **A replaced card** (lost / reissued: new digits, same Card Member name; owner 2026-11-20): Set up card / the upload's picks accept a person who already has a card; the old card is deactivated (history kept) only when the screen confirmed it (`replace: true`), the login manages company cards (`manage_company_cards`: accounting / admin) and Amex's name on the new digits is that person's — else the usual "deactivate it under Cards first" refusal. Not built: the daily reminder email.

**To do and near matches** (2026-11-24, on `fix/card-receipts-todo-match`; review B1–B3): a cardholder's **To do** is
every month's own Missing receipt / Draft / Sent back (`GET /expenses?scope=todo`, `TODO_STATUSES`), shown above the list on every
screen size — a charge from last month found by this month's statement used to sit only in last month. The automatic match stays
**exact** (owner's rule), but a Missing receipt row offers its holder their own receipts **close** to the charge (`isNearMatch` in
`amexStatement.ts`: a week either side, within $5 or 10%; `GET /expenses/:id/near-receipts`) and **"This is my receipt"**
(`POST /expenses/:id/use-receipt`, `matchReceiptToCharge` in `db/cardStatements`, under the check's lock) links the charge to it: the
receipt takes the bank's day, total and card (what a matched receipt keeps), a changed total takes back its approvals, and the
Missing row is voided. Holder only; never automatic. A PUT that corrects the day or total looks for the charge again (3fdf09b9), and
the screen drops the Missing row it replaced.

**Refunds, previews and replacements** (2026-11-24; review B7–B9): a refund pairs with its charge (`pairRefunds`: same bank and card,
the exact amount back, up to 30 days after, never a card payment) and that charge reads **Refunded** — no Missing row is made, one
already made is voided ("Charge refunded"). Nothing is stored: the pairing is worked out each check and each view. A **preview**
takes no global lock (it rolls back anyway) and gives up after 2 s on a row a real upload is writing (409 "try again"); only a real
upload takes `card_statement_check`. An upload sends `replace` only for the cards the person confirmed in the dialog.
Not done: a refunded charge on a card nobody holds yet still counts in "still missing".

**Export and public links** (2026-11-24; review S2 / S3): both exports read `GET /expenses/export` — `?month=` needs Export (or
Export all), no month needs Export all; the same people rules as the list apply and each export is logged (who, scope, count). The
screen no longer builds a month's file from the list it already holds. A **public** receipt link (an old one, or a store that can't
keep it private) is refused when another person's expense already holds it (`receiptLinkProblem`).

**The Encore check** (2026-11-21, on `feat/encore-statements`; owner's answers that day: Encore cards are **additional**
to Amex, a person may hold one of each, and some holders are new): Statements → **Upload statement** has a **Bank** choice
(Amex | Encore). Encore's export is one sheet, one row per transaction (`src/utils/encoreStatement.ts`, tested; worker kind
`encore-activity`): the card is only **…last 4** (`448462******3992`), the holder's name is a column, the day is **Occurred**
(same 2-day / exact-amount match), Debit/Credit `C` rows are credits, and its **Reference Number is not unique** (a fee
shares its charge's, the annual fee and the auto payment have none), so a line's key is `ENC-<reference>-<last4>-<cents>`,
or `ENC-h-<hash of day, merchant, card, amount>` with no reference. The auto payment has no card and is stored with no
digits. Everything else is shared with Amex through `issuer` (`amex` | `encore`) on `card_statement_lines` /
`card_statement_imports` / `company_cards` (migration `0028`): `cardForDigits(cards, digits, issuer)` (an Encore line only
fits an Encore card; an Amex line never does), `unknownCards` per bank, card IDs like `PATH3992` (4 letters + 4 digits).
**One active card per person per bank** (`company_cards_active_user_issuer_key`; `activeCardClash` takes the issuer).
**Until 2026-11-24 a charge matched a receipt of the same holder on either bank** (and moved the receipt to that card); that is
**gone — see "One bank at a time" below.** A new receipt is saved on the card the person picks (the first card, Amex, by default).
New tables/columns reach RDS with `npm run pg:migrate -- --apply` on Render.

**One bank at a time** (2026-11-24, owner: "if the transactions are with Encore don't run that check — match with that report
only"): `check(tx, by, missingFrom, bank)` in `src/db/cardStatements/index.ts` looks only at the **uploaded bank's** charges
(`importStatement` passes its issuer; `recheck` after a card is set up or changed passes that card's bank; `afterCardSaved(by,
issuer)`), and a charge matches a receipt of the same holder **at the same bank** (`holderOf` is `userId:issuer`, so a card
replaced at that bank still matches and its receipts move to the new card). `claimUpload` (a receipt saved) looks at the holder's
cards at the receipt's own bank only. So an Encore upload never reads, matches or makes anything at Amex, and an Amex receipt is
never matched to an Encore charge by the check. The one way across is a **person's click**: a Missing receipt row's near
receipts (`openReceiptsNear`, any of the holder's cards) and "This is my receipt" move it to the charge's card. Tests:
`cardReceiptStatementsBanks.test.ts` (fails on the old check).

**Statements are kept apart by bank** (2026-11-23, on `feat/receipt-categories-list`; claude.ai artifact **Statements by bank**,
https://claude.ai/artifact/XVMYJJRpHrrxSfTQ2Ey2pD; the owner's calls on it): the Statements tab has an **Amex | Encore** switch (remembered
on the device, default Amex, **no "All" tab** — my default, owner unanswered) and everything under it — tiles, lines, last upload, the
still-missing count (`missingByBank` from `statementView`, uploads carry `issuer`), the uploads log — is that bank's alone; Upload statement
opens on the chosen bank. **Cards not set up moved to the Cards tab** (`statements/UnknownCards.tsx`, both banks, each with its badge,
needs the Amex-check switch); Statements keeps a one-line "2 Encore cards not set up · Set up in Cards" notice and an orange dot on the
tab. A login with the Amex check but **no Cards tab** (`canCards` false) still gets the box on Statements, so nobody is stranded.

**The whole page in the Customers tab's look; Statements rows coloured by match** (2026-11-24, on `feat/ccr-customers-look`; claude.ai
artifact **Statement row colours**, https://claude.ai/artifact/GSbdExUZTArcH7EgsDWQjP, board C — the owner's comments on it set every
rule here). Every tab uses the Customers spacing (`CustomerList.css`): the title 22px / 750 with a gold count (`.ccr-hcount`), 44px tabs
with icons and Customers' count pill, a 42px table header and 60px rows (`.ccr-table th/td`), a 44px checkbox and 48px ⋯ column, 12px
between sections. A computer gets **Add receipt** as the gold header button (Expenses / Waiting for me; the round camera stays on a phone
and on the other tabs). **Statements:** the bank is a **Bank** dropdown (Amex / Encore, still one at a time, remembered), beside
**Status** and **Cardholder** dropdowns on the tab row after the month (`statements/FilterMenu.tsx`, the Customers `.cl-dd` look; the
panel portals them into the page's `ccr-tab-tools` and its search + **Upload statement** into the header's `ccr-tools`, so nothing floats
outside the page); the tiles are gone. Columns (owner's order): **Date · Cardholder & card** (initial avatar, name, branch pill in the
Customers location-badge colours, card ID) **· Merchant** (bank's line bold, city under) **· Category · Amount · Status**. A **matched**
line's row is **green**, one **waiting for its receipt red** (no Receipt column — the colour says it, owner's call), lines needing no
receipt fade. **Status** is the Customers dot + word with a grey line under it, worked out on the server by `src/utils/statementStage.ts`
(tested) and sent as each line's `stage` (with the holder's `branch`) from `linesWhere`: a matched line's approval stage from
`receiptApproval.ts` — Waiting for Accounting / for Manager or Admin / for Admin / for both ("$150+ · needs both"), Asked …, Sent back,
Draft, Approved (last approver · day) — else "No receipt · N days", "Waiting for Accounting" (an Admin charge), Card not set up, etc.
Not built: checkboxes / bulk actions and a row ⋯ on Statements (reminder emails stay off until the owner says). Phone: one list box
with dividers, the same row colours.

**Expenses / Waiting for me follow it** (2026-11-24, same branch, owner: "build it to match"): on a computer the tiles and the Filters
panel are gone — **Queue** (approvers, Waiting for me), **Card**, **Status**, **Category** and **Cardholder** are dropdowns on the tab row
(`components/FilterMenu.tsx`, shared with Statements; each choice carries its count given the others, **Clear all** appears once one
narrows the list), and what the tiles held — each status's money and the month's total — sits in the pager's bar (`.ccr-pg-totals`).
A **phone keeps the Filters panel**. Rows: Cardholder & card (avatar, branch pill), Status as the dot + word with the approvals / what's
owed under it (`ExpenseStatus`), **Missing receipt rows red** (`tr.is-miss`, the `--ccr-row-miss` colours now on `.ccr-`). Dropped
`StatusTiles.tsx`. An empty list with a filter on says "Nothing matches", never "No receipts for <month>".

**Expenses say whether a bank statement line answers them** (2026-11-24, owner: "show if they are matched with the Amex report or not in
expenses as well"). The server adds `onStatement` to every expense it sends (`viewsOf` in `routes/cardReceipts.ts`, from
`linkedExpenseIds` in `db/cardStatements`, through `statementMatches` in its hooks): **true** when a statement line points at the expense
(an upload matched to its charge, or the Missing receipt row made for it), **false** when none does and the expense is on an Amex / Encore
card dated **2026-11-01 or later** (`MISSING_FROM`; the same start as the check), **null** otherwise (earlier days, another bank, or
Credit Card Receipts still on MongoDB / the lookup failed — nothing is claimed). The row's background says it (`rowTone` in
`ExpenseList.tsx`): **green** on the statement, **red** a Missing receipt row (on the statement, no receipt yet), **plain for everything
else** — not matched (owner, same day: "which are not matched don't keep any color", so the amber and its tag were removed) or not known;
a hover `title` says what green / red mean. A **Statement** dropdown (All / Matched / Not matched, with counts; a field in the phone's Filters panel too) filters them
(`ReceiptFilters.statement`, `statementState`): **Matched is exactly the green rows; Not matched is everything else** (owner: "everything
apart from what matched with reports") — an unmatched receipt, one from before the check began or on another kind of card, and a charge
still waiting for its receipt. The MongoDB / Postgres parity test leaves `onStatement` out (Postgres-only data).

## Supplier POs and the supplier portal (2026-11-07, on `feat/supplier-portal`)

Design and the owner's calls: the claude.ai artifact **Supplier Portal Design**
(https://claude.ai/artifact/KbEE97GomxC1ANhshGNwoU). Purchasing → **Supplier
POs** (`src/features/suppliers/`, nav `supplier_pos`, a new **Purchasing**
module) and Products → **Incoming Material** (`incoming_material`). A PO
(typed, or "Fill from SPS" from `InventoryTransitShipment`; one PO # is one PO,
`poKey`) is assigned to a supplier; the supplier offers **blocks** against a
material line, each with 7–8 **bundles, one photo each**. Two steps, bundle by
bundle or the whole block: **1 Approve** (`review_supplier_blocks`) → **2 Final
approval** (`final_approve_supplier_blocks`), never by the person who approved
it in step 1 (`SAME_PERSON_BOTH_STEPS = false`, my default — owner unanswered).
Reject / New photo take a reason from the list (`REJECT_REASONS` /
`RETAKE_REASONS`, words in every language). Approved = **locked**; Unlock
(`unlock_supplier_bundles`, with a reason) sends it back through both steps.
**No prices anywhere in this module.** Rules: `src/utils/supplierBlocks.ts`
(tested); permissions `src/utils/supplierAccess.ts` (one switch per action,
Users & Roles card "Purchasing · Supplier POs"; admin all, directors view /
both steps / unlock / incoming; everyone else ticked by an admin). Staff API
`src/routes/suppliers.ts` at `/api/suppliers`; models `src/models/Suppliers.ts`.

**The supplier portal** (`/supplier`, `src/features/supplierPortal/`, API
`src/routes/supplierPortal.ts` at `/api/supplier-portal`) has **its own
sign-in** (`src/services/supplierSession.ts`): a token on a key derived from
JWT_SECRET in a cookie scoped to `/api/supplier-portal`, so no staff route
accepts it and no portal route accepts a staff token — keep it that way. One
login per supplier (`MAX_LOGINS_PER_SUPPLIER`), invite / reset links single-use
7 days, five wrong passwords lock 15 minutes. Every portal read and write is
limited to the login's own supplier; what a supplier sees is
`supplierBlockView` / `supplierPoView` in `src/services/supplierViews.ts`
(never a staff name — notes go out without `by`), what sales see is
`incomingView` (never the supplier or the PO). The portal's words, reasons and
emails are `src/utils/supplierI18n.ts` in 9 languages (my translations — have
native speakers check them); `supplierI18n.test.ts` fails if a language misses
a key. Free-text notes are machine translated only when
`GOOGLE_TRANSLATE_API_KEY` is set (`src/services/translate.ts`), and always
keep the original. Photos are shrunk on the phone (1800px) and upload when
taken, waiting for signal when there is none (`usePhotoUploads.ts`). Emails:
the supplier on PO assigned, on decisions that need them and on final approval;
the PO's buyer when a block is sent. **Not built** (canvas phase 3): loading
documents (container, seal, B/L) and the arrival check against the photos.

**Purchasing can enter a block for its supplier** (2026-11-07, owner's ask —
suppliers who email or WhatsApp the photos): the PO's **Add block** and a
block's **Enter what they sent** (`components/BlockEntryForm.tsx`, anyone with
`manage_supplier_pos`; photos upload when picked, several at once fill the
bundles in file-name order). Routes `src/routes/supplierBlockEntry.ts`
(`POST /block-photos`, `POST /pos/:id/blocks`, `PUT /blocks/:id/entry` with
`expectedUpdatedAt`), rules `applyEntry` in `supplierBlocks.ts` (tested): only
the bundles the supplier could change (draft, new photo asked, unlocked, a new
bundle), only photos we stored (`isStoredPhotoUrl`), never a block the
supplier is still putting together. The block stays the supplier's (their
portal shows it), is marked `enteredBy` ("Added by …" on the block, never
shown to the supplier) and goes through both steps; whoever entered it **may
give it step 1** (owner's call). A supplier with **no portal login** gets the
decision and unlock emails at the supplier's own email, in its language, with
the bundle photos instead of a portal link (`supplierRecipients`).

## Project Leads: ConstructConnect projects to contact (2026-11-20, on `feat/project-leads`)

Sales → **Project Leads** (`src/features/projectLeads/`, nav `project_leads`): construction projects
from a ConstructConnect export (apartments, single family, townhomes; first file "Construct Connect
Data 6-25-26", 2,195 projects / 18.5k companies) with the owner, developer, architect, designer and
contractor on each, so sales can phone or email them to onboard or send samples. **Postgres only**
(new tables `project_leads`, `project_lead_companies`, `project_lead_imports`, migration `0020`,
data layer `src/db/projectLeads/`; no link to a copied table, so the Mongo copy never touches them).
Rules are `src/utils/projectLeads.ts` (tested): the export's "Design Team" sheet is one row per
company per project; `roleGroup` sorts roles into owner / architect / designer / contractor / other
(engineers and consultants are "other", folded away on the screen); "Custom" adds units and owner
type, matched by title + street. The workbook is read in a **worker thread** (`runWorkbookParse`
kind `project-leads`, `projectLeadsWorkbook.ts`). An import **adds new projects and refreshes the
file's own fields** on ones it already has (matched by Project Id, companies replaced); **status,
who has it, note and history are staff's and an import never writes them**; projects missing from a
file stay. **The import is three steps like Import from SPS / Import Sales** (`LeadImportModal.tsx`, reusing
their `spsi-*` / `spsc-*` styles): Upload + file check → Review (`POST /import/preview` writes nothing: new /
changed / the same, contacts added / dropped, samples of what changes, a warning when the file looks **older**
than what's stored) → Results. **The latest import can be undone, once** (Results, or ⋯ → Undo last import;
`undoImport`, migration `0021`): every touched project is saved first in `project_lead_import_backups`
(only the latest import's are kept); undo puts refreshed projects and their companies back and removes the
ones the import added — unless staff already set a status / note / assignee on them, which stay. Staff set a status (New / Contacted / Samples sent / Onboarded / Not a fit — each change
kept in `history`, never trimmed), take or release a lead ("Take this lead" saves their name — my
default, not the Rep picker), and write a note. Each company has tel: / mailto: links and
**Create customer**, which opens Add customer pre-filled (`customerPrefillForCompany`, the Permits
contractor pop-up's route). API `src/routes/projectLeads.ts` at `/api/project-leads` (tested);
switches (`src/utils/projectLeadAccess.ts`, Users & Roles card "Project Leads"): View, Edit, Import,
Export — **admin only to start**, an admin ticks the rest. **On a phone (<640px) Filters is a bottom sheet** (`FilterSheet.tsx`, design: the claude.ai artifact **Project Leads — all screen sizes**, https://claude.ai/artifact/8jKDapsQW5FiLFj3875VCi): the same fields as the desktop panel (**State is one multi-select dropdown on every screen size**, `StatePicker.tsx`, owner 2026-11-20 — its list opens inline under the field because the panel and the sheet both scroll and would clip a floating one), a live "Show N projects" button, page locked behind it, pinned to the screen. **Who a lead is with** is the first thing in the panel (a gold callout, owner 2026-11-20) and is enforced on the server: **taking** is for yourself, by anyone with Edit, only while nobody has it; **releasing** is the person it's with **or their superior** — the existing Visits rule (`canModifyVisit`: **Edit all**, or **Edit branch** over someone on your team), so no new switch (`canTakeLead` / `canReleaseLead` in `projectLeadAccess.ts`, tested; the assignee's user id is `assigned_to_id`, migration `0022`). Every lead the API sends carries `canTake` / `canRelease` for the caller, and every take and release is a line in its history. Not built: a rep dropdown for assigning,
a reminder when a lead goes quiet, the old projects' relevance
(the file goes back to 2012; the Updated filter narrows it).

## File storage: one store, Cloudinary → S3 (2026-11-08, on `feat/s3-file-storage`)

Every upload and delete goes through `src/services/fileStore.ts` (`getFileStore()`,
tested): `put(buffer, { key: 'folder/name', kind, overwrite })` → `{ url, id }`,
`remove(url | 's3:<key>' | public_id)` (never throws). `FILE_STORE` picks the backend —
unset/`cloudinary` = as before; `s3` = the bucket behind CloudFront (`FILES_BUCKET`,
`FILES_CDN_URL`, `AWS_*`; the aws-infra repo's **files** stack in account 533848567248,
us-east-2 — owner's call: in the dev environment, but retained, versioned and
termination-protected). Old Cloudinary URLs keep working and still delete through
Cloudinary, so keep the `CLOUDINARY_*` keys until nothing points there. Never call the
Cloudinary SDK or check for `cloudinary.com` elsewhere: "is this a file we stored" is
`src/utils/fileUrls.ts` (`isHostedFileUrl`; anything the server trusts uses
`isFilesCdnUrl` with the configured base — `isStoredPhotoUrl` does). Keys keep the
file's extension (`storageKey`, `src/utils/fileStoreRules.ts`) so `isPdfSource` still
works; fixed-name delivery files are put with `overwrite` (S3: `Cache-Control: no-cache`).
A download name is `?download=<name>` on a CDN URL (a CloudFront function sets
Content-Disposition; `downloadUrlFor`). Moving the existing files is
`scripts/migrate-cloudinary-to-s3.ts` (dry run → `--copy` → `--apply`, `--undo <run>`;
engine `src/services/cloudinaryToS3.ts`, tested on in-memory MongoDB): it copies each
file under the same folder/name, rewrites only fields whose file copied, backs every
old value up in `cloudinarytos3backups`, and skips a record edited mid-write. Run it on
a local copy first — the local `.env` is the live database. The login page's two
resized slabs are now `public/images/login/`.

## Postgres on AWS RDS: customers first (2026-11-08, on `feat/postgres-customers`)

MongoDB → **PostgreSQL on AWS RDS** (no Aurora), owner's calls; the server goes to
Lambda after. MongoDB stays the live database until AWS is tested — nothing writes to
both. Postgres is a copy: `scripts/pg-copy.ts` (reads MongoDB only; dry run,
`--write`, `--verify`, `--lock` at cutover). Customers are split into tables linked by
id (visits keyed by visit id with `customer_id`, likewise resources and contacts); the
tables, the time rules and what the first copy found are in `src/db/README.md`. A new
field on a customer, visit, resource, contact, schedule or the activity log needs its
column (`src/db/schema/`, then `npx drizzle-kit generate`) and its line in the copy
(`src/db/copy/`), or the copy silently leaves it behind.
## Email: Amazon SES first, Gmail as the backup (2026-11-08, on `feat/ses-email`)

Every email goes through `sendEmail` in `src/services/emailService.ts` (owner's call):
SES (`SES_FROM_EMAIL`, an address on the domain the aws-infra `email` stack verifies;
`SES_CONFIGURATION_SET`; the AWS_* key on Render) and, if SES isn't set up or refuses
or fails, the Gmail SMTP account (`SMTP_*`). Resend is gone. Both get the same
nodemailer message, so attachments and Reply-To behave alike; the result says `via`.
While SES is in its sandbox it refuses unverified recipients and Gmail sends them. A
new email goes through `sendEmail` — never its own transport. Tests: `emailSend.test.ts`.
Every email is sent as **Easy Surfaces** (owner, 2026-11-08; `SENDER_NAME` in
`src/utils/emailSender.ts` — callers add a word, `${SENDER_NAME} Check-In`), from
**noreply@easystones.com**, a Microsoft 365 shared mailbox. Until easystones.com's DNS
records are in, SES sends from a single verified address (aws-infra `email.verifiedAddress`)
and Outlook shows "via amazonses.com" with an "unverified sender" warning — tested
2026-11-08 — so Render's SES settings wait for the DNS.

## Forms: one template, everywhere

Every form (add/edit modals, Delivery, Visit, Lost Sale, imports, POD,
profile) follows [`FORM_TEMPLATE.md`](FORM_TEMPLATE.md), approved
2026-10-04. It covers sizes S/M/L and phone, field states, the required `*`,
no helper text, validation banner, saving lock, unsaved-changes check, edit
mode, and light/dark colors. It's built in `src/components/shared/form/`
(Add and Edit User, Add / Edit location, Add / Edit visit, Add / Edit customer, Add / Edit delivery, and the Selection Sheet are on it); move the others onto it one at a time and
re-check each by hand, since every form with a dropdown is subject to the
CustomSelect incident below. A form dropdown (FormPicker, FormSearchPicker,
RepPicker, LocationPicker, Users' LocationsPicker) floats inside the form body
and, when the body has no room for its list above or below the field (a
two-field S form), opens as the phone bottom sheet instead
(`useMenuPlacement` in `formFocus.ts`, 2026-11-01) — the list used to be cut
off by the body's scroll box.

## Phones: pop-ups, sheets and the iPhone keyboard (2026-11-04)

Check every phone-size pop-up, sheet or full-screen panel that has a text box
against these, on a real iPhone (the emulator has no keyboard):

- **Don't size or place it from `visualViewport`.** iOS reports its height and
  offset late while the keyboard slides and sometimes stale after it closes, so
  a sheet that follows them squeezes, jumps, and is left sitting too low. Pin
  it to the screen (`position: fixed; inset: 0`) and let the keyboard cover its
  bottom, as iOS's own sheets do; only the scrolling list's end padding follows
  the keyboard (a stale value there is just blank space). Reference:
  Dashboard → Find a customer (`CustomerSearch.tsx` / `.css`, `--dcs-kb`).
  FormModal still follows `visualViewport` (full-screen, top included) and
  works; don't copy that onto a sheet that leaves part of the page showing.
- **Cover the whole screen behind it.** Any strip of the page left uncovered
  (between the sheet and the keyboard, say) takes the drag and scrolls the page.
- **A drag outside the list moves nothing.** A non-passive `touchmove` on the
  pop-up calls `preventDefault` unless the finger is in the list and the list
  can still scroll that way; the list has `overscroll-behavior: contain`. Without
  it, scrolling the sheet scrolls the Dashboard behind, and with the keyboard up
  iOS pans the whole screen. Pointer-event drags (a sheet's handle) still work.
- **Lock the page** with `lockPage` / `unlockPage` (`components/shared/pageLock.ts`).
- **Focus without moving it**: `focus({ preventScroll: true })`, and don't
  slide the box in on open — iOS draws the caret where the box was when it got
  focus.
- **Text boxes are 16px** (or iOS zooms) and get `no-capitalize` when they
  shouldn't take the global capitalize (index.css), e.g. search boxes.
- **In the app, the web view itself must never scroll for the keyboard** (2026-11-24: forms lost their header and
  search sheets went blank when the keyboard opened in the React Native app). Every rule above assumes the page stays at
  offset 0 while the keyboard is up, because the site pins forms and sheets to the screen. A WKWebView left alone pans
  its scroll view (and adds a bottom inset) to clear the keyboard, taking everything pinned with it. The Capacitor app
  stopped that (`scrollEnabled: false`, its Keyboard plugin zeroing offset and inset); the React Native app does it with
  `keyboardSafeProps` in `mobile/src/host/webViewSettings.ts` (tested), used by `WebHost.tsx` — don't remove those props.
  FormModal's keyboard maths is `keyboardInset.ts` (tested): in the app the form is the screen minus the keyboard,
  whether or not the web view's own viewport also shrinks. **Never tried on a real iPhone** — check Add receipt's Category
  search, a visit's note and the sign-in-adjacent forms with the keyboard up.

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
`applyDerived` in `src/routes/dailyReports.ts`) until a person hand-corrects
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
`applyDerived`'s tests in `src/routes/dailyReports.test.ts` (including
"at submit") for the merge contract those payloads have to be correct
against.

## Automated tests are narrow — most verification is still manual

`npm test` runs Vitest (`vite.config.ts`'s `test` block, `src/**/*.test.{js,ts}`).
As of 2026-08-28 that covers the pure, no-DOM business logic in
`src/utils/routePlan.ts` and `src/features/routePlanner/helpers.ts`
(great-circle distance, point-in-polygon, stop ordering/scheduling math,
recency bucketing, small formatting/localStorage helpers), plus the Daily
Work Report's derive/save-payload rules (`src/routes/dailyReports.ts`'s
`applyDerived`, `src/features/dailyReport/savePayload.ts`) added
after the incident above, and its payment methods and totals
(`src/utils/dailyReportPayments.ts`: ACH, Cash, Credit Card, Check; reports
saved before ACH read it as unsaid), its transfer lines
(`src/utils/transferDirection.ts`: one line per transfer with its one
Transfer # — a ticket line per ticket — so the count the month view, its
PDF and the CSV total is the number of lines, never typed; a hand-added
line's direction comes from its route (ending at the report's branch is
Incoming); `transferLineKey`, the per-transfer key a typed slab figure is
kept against, and how a draft saved per route carries over; and the notes
for a repeated transfer number, a route that skips the branch or repeats a
ticket line; the routes, in `src/routes/dailyReportManualTransfers.test.ts`), and the customer list's rules
(`src/utils/customerList.ts`: status labels, the ⚠ data-quality checks and
the "Incomplete" query that must match them, saved views, A–Z, role-scoped
filter options), the shared pagination sizes/range math
(`src/components/shared/paginationConfig.ts`), and the location-filter rules
every screen's location filter shares (`src/utils/locationFilter.ts`: home
location, which branch a filter opens on, remembered picks, and the server's
home-location validation), and who can be picked as a sales rep (`src/utils/salesReps.ts`: the role
rule, branches, deactivated and already-saved reps), and Add User's rules (`src/utils/userForm.ts`:
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
tag's line with Tesseract) is checked by hand on real tag photos — and Add / Edit location's rules (`src/utils/locationForm.ts`:
required fields and formats, unique short name/code, which locations can be
an RDC, the record ↔ form conversion the API also runs, what non-managers
may read, and the selection-sheet letterhead with its Kent fallback), and
Add / Edit visit's rules (`src/utils/visitForm.ts`: the visit types and
their stored values, which fields each type uses, required fields, the
change count, and the "Last changed by" note), and the Selection Sheet's
rules (`src/utils/selectionSheet.ts`: rows, the change count behind the
unsaved-changes check, the save body with its stale-save
`expectedUpdatedAt`, the escaped print page,
price per SF in cents and when it prints, internal vs printed notes, and
what the server accepts and when it re-emails the rep) plus its save/email
routes (`src/routes/checkIn.test.ts`, in-memory MongoDB, including which
Check In switch each route needs), and the Check In permissions
(`src/utils/checkInAccess.ts`: the sections, the Users & Roles card built
from them, what a check-in save needs, the migration) and Lost Sales access
(`src/utils/lostSaleAccess.ts`), and the email's
contents (`src/services/emailService.test.ts`),
and Add / Edit customer's rules (`src/utils/customerForm.ts`: stored option
values, new-customer defaults, record ↔ form mapping, required fields, the
email/marketing-email sync, the change count, and what a business-card scan
fills in), and the Delivery form's packing-list reader
(`src/utils/packingListPdf.ts`: reading packing list #, Bill To / Ship To,
the order row and the slab count out of a StoneProfits packing list PDF, and
which empty form fields an upload fills — Sales Orders, Pick Tickets and
Invoices read the same way), and Add / Edit delivery's rules
(`src/utils/deliveryForm.ts`: which fields each delivery type uses, Pending
vs. a required date, the driver list with each truck's load and the full
ones greyed out, a 3rd-party truck's optional carrier / BOL / agreed price,
transfer checks, the change count, and the save body), and the customer
write rules (`src/utils/customerRecord.ts`: what a create/edit may write,
defaults, the placeholder email, protected fields) and dropdown rules
(`src/utils/customerOptions.ts`: name, address parts, sort, search), and
the Check-In Log's branch clock (`src/utils/checkInClock.ts`: which day and
month a check-in belongs to on its own branch's clock, the per-zone query the
list's month filter and counts use, and the date/time/"Today" shown and
exported), and the Check-In Log's exports (`src/utils/checkInExport.ts`: the
Excel rows, the PDF's filter line, link and row cap; `src/utils/checkInLogPdf.ts`:
that the PDF builds, pages, and survives characters its font lacks), and the
3rd-Party Freight screen's rules (`src/features/freight/freightView.ts`: its tabs and
counts, charges grouped by carrier, what a selection offers — Approve,
Approve & pay, Mark paid — and why not, payment wording and the Excel rows;
the page itself has a render smoke test, `freight.test.tsx`),
and the Delivery Schedule's column order per branch
(`src/utils/deliveryColumns.ts`: the default — our drivers A–Z, 3rd-party
trucks, Will Call — a branch's saved order, where a new driver lands; its
routes in `src/routes/deliveryColumns.test.ts`: the Arrange Driver Columns
permission, own locations only), and its stop
numbers (`src/utils/stopGrouping.ts`'s `compactStopNumbers`: every driver's
run saved as 1, 2, 3… with no gaps, which the board, the Edit delivery form
and the driver's phone all show; the routes that keep it so after a delete,
cancel, move, edit or reorder, and the startup pass, in
`src/routes/deliveryStops.test.ts`), the card's edge colour by ticket kind
(`ticketAccentFor` in `src/utils/deliveryTypes.ts`), and the delivery write
rules (`src/routes/deliveryAccess.test.ts`: a view-only login can't write, a
driver writes only an ePOD, a packing-list upload can't take another branch's
ticket id, reorders ignore tickets the board doesn't show, and a ticket with
no branch reaches every open branch room, and the ePOD save that writes the
ePOD and nothing else), and staff sign-in
(`src/services/staffSession.test.ts`: the setup token failing every ordinary
check, temporary-password expiry, session versions;
`src/routes/userOnboarding.test.ts`, in-memory MongoDB: a temporary password
→ setup session → own password → signed in, invite links once and racing,
change-password and admin resets ending older sessions — its `signIn` and
`authenticate` are stand-ins for server.ts's, keep them in step).
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
in `src/utils/permitView.ts` (the county tree, the place filter, registry
phones, and the PDF's rows, heading and link).
Dashboard → Follow-ups' rules are covered (`src/utils/followUpList.ts`: due day,
range, status, counts, order, headings, words, and what a tick / reopen /
snooze / note writes), with its PATCH route in `src/routes/visits.test.js` and
a render smoke test in `src/features/dashboard/dashboard.test.tsx`.
The calendar's date rules are covered too
(`src/components/shared/calendar/calendarDates.test.ts`: parsing real days,
shifting with the 31st clamped, the Monday-first grid, week bounds, limits,
keyboard moves, the scheduler's date-time helpers); its rendering was checked by
hand in a browser.
Nothing else in the app has test coverage — no
rendered components, no other routes, no other server.ts endpoints.

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

## Inventory stock imports

`src/services/inventoryStockImport.ts` publishes stock in one MongoDB
transaction. Keep its shared publication state, backup and replacement writes
in the same transaction; never restore insert-then-delete-by-timestamp cleanup.
The existing `InventoryItems` collection stays the read surface for inventory,
holds and purchasing. Previous records are archived for seven days; import
metadata remains. Transactions require a replica set.

The ordered inventory correction and TypeScript migration plan, including
identified UX changes, is in `INVENTORY_MODULE_PLAN.md`.
