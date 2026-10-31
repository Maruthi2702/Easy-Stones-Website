# Dashboard, Operations, customer profile and website review

Date: 2026-10-31. Reviewed commit: `84ebd3f`.

The initial review below reproduced eight new findings and an existing incoming-transfer assignment issue without changing live records. The fixes have since been implemented locally; see the implementation update at the end.

## Verification

| Check | Result |
|---|---|
| Full regression suite | 184 test files passed; one failed. 2,447 tests passed, four skipped, one failed. |
| Type checking and server import check | Passed. Three existing warnings concern maintenance scripts importing the missing legacy Admin model. |
| Production build | Passed. |
| Desktop page checks | 13 routes loaded with no uncaught page exceptions or failed API responses during the successful smoke run. |
| Mobile page checks | Seven views at 390px width loaded without uncaught page exceptions or horizontal document overflow. |
| Dashboard resource search | A search for a sample note returned the expected single resource. |
| Customer visits pagination | Page two rendered the remaining 19 of 69 sample visits, with the range “Showing 51–69 of 69”. |
| Permission, write and failure checks | Used the real backend against an isolated MongoDB replica set and synthetic users/customers. |

The single regression failure is outside the requested modules:
`src/features/purchasing/PurchasingWorkbench.test.tsx:339` cannot find the
“Observed sales cutoff” field by its accessible label after opening the scope
editor. Determine whether the control needs a label association or the test
needs updating; the overall suite is not fully green.

The public pages checked were Products, one product detail, Contact, Warranty
and Login. Staff pages checked were Dashboard, Customers, customer Visits and
Resources, Delivery Schedule, Daily Report, Check-In Log and Team Files.
Mobile checks covered Dashboard, customer Visits and Resources, all three
Operations pages and Products. Scrollable containers were inspected; these
checks do not establish that every long form and modal works on every device.

The isolated backend used the current server, real authentication and a
throwaway database. External requests and outbound integrations were disabled.
No production account was impersonated. Local Node was v26.5.0; the repository
pins Node 24.22.1, so this review is not verification on that exact runtime.

## Findings and suggested order

| ID | Priority | Finding |
|---|---|---|
| R1 | High | Customer profile and individual-detail reads bypass the dashboard's visit/resource visibility scope. |
| R2 | High | A resource's recorded uploader can be supplied by the client. |
| R3 | High | Editing or deleting duplicate resource types changes the wrong placement visit. |
| R4 | High | A failed resource move can permanently remove the resource; successful moves also leave placement history behind. |
| R5 | Medium | Dashboard date-only visits display one day early in Pacific time. |
| R6 | Medium | A failed dashboard request is displayed as an empty list. |
| R7 | Medium | Read-only users are offered contact changes that the backend rejects. |
| R8 | Medium | A temporary authentication-service error redirects a valid session to Login. |

Address R1–R4 first. R3 and R4 should share a durable resource-to-visit link
and transactional persistence. Existing ambiguous placement history may need
review before any automated repair; this review made no repairs.

### R1 — Customer history does not enforce the dashboard's visibility scope

Sources: `server.ts:3221`, `server.ts:4246`, `server.ts:4273`;
`src/utils/visitAccess.ts`, `src/utils/teamScope.ts`.

Reproduction: sign in as a user with `view_dashboard`, `view_customers`,
`view_customer_profile` and `view_branch_visits`, assigned only to Seattle.
A Seattle customer's history contains a visit and resource logged by a Spokane
rep. The dashboard correctly excludes that rep's work. The full customer read
still includes it, and the single-visit and single-resource routes return 200.

Impact: the same user can read work outside the dashboard's permitted scope by
opening the customer profile or requesting individual details. Hiding edit
buttons does not constrain these reads.

Suggested fix: apply the shared people scope to customer history and individual
detail reads. If full-profile access is intended to grant all historical work,
make that exception an explicit permission decision and align the dashboard and
permission descriptions with it.

### R2 — Resource uploader ownership is client-controlled

Source: `server.ts:4649`.

Reproduction: an ordinary Seattle sales rep posts a new resource with
`uploadedBy` set to a Spokane rep's ID. Creation returns 201 and stores the
Spokane identity as uploader, while the generated placement visit records the
actual Seattle actor.

Impact: attribution, own/branch permissions and dashboard visibility can be
manipulated, and the resource and its visit disagree about who logged it.

Suggested fix: derive ownership from the authenticated actor. If recording work
on another person's behalf is required, give it a separate permission, validate
the target person and retain both actor and attributed owner. Protect these
fields on updates as well.

### R3 — Duplicate resource types corrupt placement history

Sources: `server.ts:4816`, `server.ts:4885`.

Reproduction: create two placements of the same resource type with distinct
notes. Edit the second resource. Its resource changes, but the first matching
visit's notes are updated while the second visit keeps its old notes. In a
separate pair, deleting the second resource removes the first placement visit
and leaves the second placement visit behind.

Cause: synchronization uses the first visit whose purpose contains the resource
title/type. It does not identify the visit belonging to the resource being
edited or deleted.

Impact: incorrect visit history, lost history for another placement and possible
changes to the wrong linked calendar entry.

Suggested fix: store an explicit immutable link between the resource and its
generated placement visit. Validate the linked record and update/delete both
within one transaction. Cover repeated types and placements by different people.

### R4 — Resource moves lack rollback and leave history on the old customer

Source: `server.ts:4781` through the resource-move response.

Reproduction of data loss: create a resource at customer A. In the isolated
database only, temporarily add a validation rule rejecting that resource at
customer B. Move it to B. The request returns 500, and neither customer retains
the resource: the source removal was saved before the destination failed.
The injected validation rule was removed after the test.

Reproduction of history inconsistency: perform a successful move. The resource
is now at B, but its placement visit remains at A and B receives no placement
visit. The successful move exits before the ordinary history-sync code.

Suggested fix: move the resource, update its customer metadata and migrate the
explicitly linked placement visit/calendar references in one transaction. A
failed destination save must leave A unchanged. Emit refresh events only after
commit.

### R5 — Dashboard visit date shifts to the preceding day

Source: `src/features/dashboard/components/VisitsFocusList.tsx:88`.

Reproduction: a resource placement creates a visit dated `2026-10-31`. In a
browser using `America/Los_Angeles`, the dashboard chip displays `OCT 30`.
The constructor treats the date-only value as UTC midnight before local display.

Suggested fix: parse calendar dates with the shared local-date helper. Add a
rendering regression in a non-UTC timezone, covering both date-only values and
the existing local timestamp format.

### R6 — Dashboard request errors masquerade as “no visits”

Source: `src/features/dashboard/useDashboardData.ts:147`.

Reproduction: return a JSON error with HTTP 500 for the dashboard visits list,
while stats and the other requests succeed. The dashboard shows four visits in
the tile but “No visits for this period” in the list, without an error or retry
action. Non-array error JSON is converted to an empty array.

Suggested fix: check HTTP status before consuming each response and distinguish
loading, empty, successful and failed states. Keep any previously loaded rows
visibly marked as stale, or show a recoverable error. Apply equivalent handling
to resources, follow-ups, stats and schedules.

### R7 — Contact actions are exposed to read-only users

Sources: `src/features/customers/profile/CustomerProfile.tsx:92`,
`src/features/customers/list/CustomerContactsTab.tsx:84`.

Reproduction: a synthetic user with customer-profile viewing permissions and
no `manage_customers` permission sees Add contact and a contact menu offering
Edit/Delete. An attempted contact creation is correctly rejected with 403 by
the backend.

Impact: a user can spend time entering changes they cannot save. The backend
permission gate held in this test; this finding concerns UI permission parity.

Suggested fix: gate contact creation/edit/delete with the same shared permission
rules as the routes. Keep allowed view and communication actions available.

### R8 — Transient authentication errors are treated as invalid sessions

Source: `src/context/AuthContext.tsx:104`.

Reproduction: start with a valid synthetic staff session, then return HTTP 429
for `/api/auth/verify`. Opening the dashboard redirects to Login although the
valid session cookie remains. The current code clears the user for every
non-success response, including temporary server failures and throttling.

Impact: users appear signed out during temporary API problems. The broader
browser review also encountered the backend's 500-requests-per-five-minutes
limit; affected runs were discarded and checks repeated with fresh test client
budgets. No limit or authentication setting was changed in application code.

Suggested fix: separate an explicitly invalid/expired session from temporary
verification failure. Show a recoverable state and retry with backoff; retain
the current identity during a failed silent recheck where appropriate.

## Existing Operations issue reproduced

Known Issues → Transfers & Daily Report → issue 3 remains reproducible.
A Seattle manager can see an unscheduled Spokane-to-Seattle transfer in
Pending, assign it to a Seattle driver and set its ship date. The request returns
200 while the sending location remains Spokane.

The open policy question still applies: should the receiving branch dispatch
incoming transfers or only monitor them? If a receiving pickup is allowed,
represent its assignment/date separately from the sender's shipment rather
than reusing the ship-date and driver fields. This is an existing tracked
decision, not an additional new finding.

## Limits of this review

- Public website routes and sample product rendering passed the checks run;
  that does not establish that all public-site behavior is issue-free.
- The external SPS Live Inventory website, live mapping, email delivery,
  calendar-provider synchronization, external downloads and real photo/PDF
  uploads were not exercised end to end.
- No live customer records, roles or financial data were edited. The failure
  injection and ownership tests used only the throwaway database.
- No functional fixes, commits, pushes or deployments were made. Follow-up
  work should add regression cases for the findings before changing behavior.


## Implementation update — 2026-10-31

R1–R8 are implemented locally. Code is not committed, pushed or deployed.

- Customer history, individual reads and customer create/edit responses use
  the same people scope as the dashboard. Responses omit password hashes.
  Basic customer cards retain their existing restricted fields.
- The backend owns resource attribution and preserves ownership/link metadata
  on updates. Resource and placement visit IDs are explicitly linked.
- Create/edit/delete/move operations publish resource, placement history and
  linked calendar changes in a MongoDB transaction. Source removal rolls back
  if destination persistence fails; notifications are sent after commit.
- The reverse deletion path (deleting a resource-placement visit) uses the same
  exact relationship resolver, not a first matching title.
- Uniquely identifiable legacy entries gain links during edits. Ambiguous
  legacy matches return 409 before any write and require manual review.
- Date chips use the shared local-calendar parser. Failed dashboard requests
  show a branded error/retry state instead of successful-looking empty lists.
- Contact mutations are hidden for read-only users. Temporary session checks
  preserve the route and existing identity, with recovery and bounded retries;
  genuinely invalid sessions still return to sign-in.
- Receiving branches can update **expected delivery date and slab count only**,
  as requested by the owner. The receiver form uses the shared form shell.
  Sender shipment fields, dispatch/status changes and deletion are protected.
- The Purchasing regression failure was a wall-clock-dependent test of an
  unfinished report. Its test clock is now explicit; application behavior was
  not changed for that test.

Bug-fix verification: **193 test files passed; 2,485 tests passed, four skipped,
no failures**. Type checking and production build passed. The real server
booted against an isolated replica set. Browser checks passed for read-only
contacts on desktop/phone, Pacific date chips, dashboard retry, authentication
recovery, a receiving-branch slab-count save, and the existing desktop pages.
Backend tests also verify ETA changes, rejection of forbidden receiving edits,
source rollback on a real injected destination failure, and linked calendar
consistency. The API dates and rendering tests ran in Pacific time.

Handoff check: a separate TypeScript migration appeared in the shared working
tree after the bug-fix run. The production build and server import check still
pass. A subsequent type check reports errors in migration files (Freight
HistoryList, WarrantyPage, checkInAccess tests and holdView; the captured run
also included HomePage while it was being moved). Those concurrent edits were
preserved. The earlier complete test/type-check results do not certify that
unfinished migration.

New regression coverage lives beside the routes, auth context, dashboard,
contact tab and incoming transfer form, plus `resourcePlacement.test.ts`.
No live-data repair or schema backfill was run. Transactions require a MongoDB
replica set, as do the existing transactional features in this application.
