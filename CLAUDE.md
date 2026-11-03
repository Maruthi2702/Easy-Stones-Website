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
only narrow (`narrowPeople`). The location filter now means people working
there. Rows say who logged them once more than you is in view. Sales Visits
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
- **Follow-up rows** (`followUps/FollowUpRows.tsx`): tick · date block coloured
  by how due · customer + 📍 location · note · rep chip with initials + logged
  day · due pill · ⋯ (Call, Snooze, the visit, the customer). On a phone, cards:
  customer + due pill / location + due day / note / rep, day and ⋯ (Done is in ⋯).
- Tiles are 4 across on a tablet; Visits' Today / Follow-ups go under the list
  below 1024px. Layout CSS is the end of `DashboardFocus.css`.

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
Edit / Delete under the card. The extra parts (`.pl-time`, `.pl-kebab`,
`.pl-drawer`, `.pl-sub`) are in the markup on every screen and hidden above
640px. `.pl-more` is the Month view's "+N more", not the ⋯.

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
template (`.fm-close`, the Selection Sheet's "…"). Under 640px the tabs are
icons with count badges and Add is the round + (above `--app-bottom-h`). Each
tab has **one** Add button in the header (Add visit / resource / contact, Link
partner); a tab with nothing on it shows `TabEmpty` (which holds the button) and
the header's hides. Visits and Resources use the shared `Pagination`.

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

Incoming transfers (owner's decision, 2026-10-31): a receiving branch may change
only **expected delivery date and slab count**, through
`PATCH /api/deliveries/:id/receiving` and `IncomingTransferForm.tsx`. The sender
controls driver/ship date, dispatch/status and deletion. Read access to both
branches must never be reused as shipping-write access (`transferAccess.ts`).

**Team Files** is its own Sales page (`team_files` in `navPins.js`, still
opened by `view_dashboard`; `src/features/teamFiles/`). The page is the old
list and pop-ups unchanged; the redesign on the **Team Files Page Canvas**
(https://claude.ai/artifact/NRBYg5zf4Ycw8NCuMrpd97 — tree, preview, pinning,
size, own permissions) is not built.

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
one fetches just theirs). The Filter reads Sales reps → Customer type → Days since
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
