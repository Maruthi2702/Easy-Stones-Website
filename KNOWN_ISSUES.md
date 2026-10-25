# Known Issues

Open bugs and gaps that have been found but not fixed yet. Add an entry when
you find one you're not fixing right away; move it to **Fixed** (with the
commit) when it's done, rather than deleting it.

Last reviewed: 2026-10-05

## Transfers & Daily Report

Found in a read-only review on 2026-09-29. Nothing below has been changed yet.

### Live data still to update

Code for these is on `main`; the database hasn't been updated yet.

- [x] `node scripts/fix-transfer-origins.js --apply` (done 2026-10-05) — sets the sending branch
      on #18356 (Salt Lake City), #18357 (Spokane) and #18299 (Seattle). Until
      then #18299 counts as outgoing on every branch's report for 8/10, because
      the report treats an empty branch as its own.
- [x] Then `node scripts/backfill-transfer-arrivals.js --apply` (done 2026-10-05: 14 filled) — fills the 14
      blank arrival dates with the ship date so receiving branches can see them.
- [x] (2026-10-05: moved up to the ship date with `--fix-early`) Decide on the 5 completed transfers whose arrival is before their ship
      date (zd0nt, 0d5nx, ore1x, etqbu, fsvcu): set arrival = ship date, or
      leave them.
- [x] Delete test transfer #11111 (Seattle → Spokane, no driver). (Already gone on 2026-10-05 — no ticket mentions 11111 and no driverless Seattle → Spokane transfer exists; deleted by someone after 2026-09-29.)
- [x] `node scripts/backfill-ticket-branches.js --apply` (done 2026-10-05: 54 set to Seattle) — sets Seattle on the
      54 tickets from Jul 27 – Aug 10, 2026 that were saved with no branch
      (all on Seattle drivers). Since 2026-10-05 a ticket with no branch counts
      on no Daily Report (it used to count on all 13), so reopening one of
      those days would otherwise drop them from Seattle's figures. #18299 is
      left to `fix-transfer-origins.js`.

Both scripts only preview until run with `--apply`.

### Issues

| # | Issue | Where | Suggested fix | Status |
|---|---|---|---|---|
| 3 | The receiving branch can drag the sender's Pending transfers onto its own driver. The transfer then vanishes from the sender's board (no column for that driver) but still counts as shipped, and the drop day is saved as the *ship* date. | `?pending=true` in `GET /api/deliveries`, `scopeDeliveryQueryToLocations`, `PATCH /deliveries/:id/assignment` | Blocked on question A | Open |
| 4 | A transfer on a branch-only driver is invisible on the receiving branch's board (no column for that driver). 1 of 76 transfers today (Sergio); the rest use the all-branch "3rd party - delivery" driver, which shows on every board. | `BoardGrid.tsx` columns, `fetchDriverUsers` in `src/api/deliverySchedule.ts` | Blocked on question B | Open |
| 5 | No "mark received" button. `PATCH /deliveries/:id/receive` and the report's received fields exist, but nothing calls them. | `src/routes/deliveries.js`, inbound `ticketIds` in `deriveFromSystem` | New feature: a Received button on incoming lines or cards | Open |
| 6 | A transfer line added by hand always counts as Outgoing; there's no way to add an incoming line. | `addTransfer` in `src/features/dailyReport/sheetEditing.ts`, PUT `/api/daily-reports/:date` | New feature: an In/Out toggle on manual lines | Fixed `a75e9b3` |
| 7 | Minor: a driver assigned after the arrival day's 11:59 PM auto-submit never reaches that report. (The other half of this row — month view and CSV counting only outgoing transfers — is fixed; see Fixed.) | `src/jobs/autoSubmitDailyReports.js` | Probably leave as-is | Open |

### Open questions

- **A.** Should the receiving branch be able to put its own driver on a
  transfer it's waiting for, like a pickup — or only watch the incoming
  ticket? If watch only, its Pending list should stop showing the sender's
  unscheduled transfers (issue 3).
- **B.** When one branch logs a transfer on behalf of the sending branch,
  should the form's driver list show the sending branch's drivers? Today it
  shows the logged-in user's own branch plus the all-branch driver (issue 4).

### Suggested order

1. Update the live data (above).
2. ~~Issues 1 and 2~~ — fixed (see Fixed).
3. Answer A and B, then issues 3 and 4.
4. Decide whether 5 and 6 are worth building.

## Daily Report — other

Nothing open.

## Delivery Schedule — other

Found while moving the module into `src/features/delivery` (2026-10-24); all
already on `main`, kept as they were.

- [ ] `searchDeliveries()` in `src/api/deliverySchedule.ts` is typed as a list,
      but the route answers `{ results, total, more }`; `DeliveryOrderSearch.tsx`
      casts around it. Fix the type.
- [ ] The page passes `onUpdateTruck` to `BoardGrid`, which never uses it.

## Route Planner — other

Found while moving the module into `src/features/routePlanner` (2026-10-24);
all already on `main`, kept as they were.

- [ ] With no rep ticked in the Filter (or every ticked rep owning no customers
      with a map point), the map says "No customer has coordinates yet — run
      `node scripts/geocode-customers.js --apply`" — a developer instruction shown
      to sales staff, and the wrong reason. `MapCanvas.tsx` (the `pinsCount === 0`
      badge).
- [ ] The Schedule panel's month grid starts on Sunday (`buildMonthGrid` in
      `helpers.ts`, `WEEKDAY_LABELS` in `panels/SchedulePanel.tsx`) while the
      app's calendar rule is Monday-first (`WEEK_STARTS_ON`, CLAUDE.md "Dates").
      It's a hand-built calendar view, not the shared one.
- [ ] Unused CSS: the customer panel's status line (`.rpv2-panel-status`,
      `.rpv2-panel-status-dot`, `.rpv2-panel-level`, `.rpv2-status-*` in
      `map/MapCanvas.css`) is used by no component since `statusTone` went (it
      was already unused). Left in place: removing it changes the built CSS, and it
      wasn't part of the approved delete.

## Users & Roles — other

Found while moving the module into `src/features/users` (2026-10-24); all
already on `main`, kept as they were.

- [ ] Roles & Permissions: **Create Custom Role** doesn't clear the "People …
      can manage" ticks, so the new role starts with the previously selected
      role's; turning Team on and saving gives it those roles. `createRole` in
      `roles/useRoleEditor.ts` should `setEditedManageable([])`.
- [ ] Deleting the selected custom role switches to `roles[0]` of the list as
      it was *before* the delete, and keeps the deleted role's "People … can
      manage" ticks (only the switches are reset), so a Save straight after can
      write them onto the role now shown. `deleteRole` in the same file.
- [ ] Minor: a user whose role no longer exists shows its key in capitals with
      only the first `_` turned into a space ("OFFICE LEAD_CSR") —
      `roleDisplayName` in `userList/usersList.ts`.

## Cart & Holds — other

Found while moving the module into `src/features/holds` (2026-10-24); all
already on `main`, kept as they were.

- [ ] The cart's checkout (`cart/useCheckout.ts`) accepts a price of $0.00/SF
      — it only refuses a price it can't read — while the hold page's price
      editor and Add from cart refuse 0. The server refuses it too ("A price
      has to be more than $0."), so it shows as a banner after Create Hold
      instead of on the field.
- [ ] Extend hold (`forms/ExtendForm.tsx`) opens with +7 days already picked
      and counts that as a change, so closing it untouched asks "Discard?".

## Operations tabs review — fix this week (by Fri 2026-10-09)

Found in a code review of Delivery Schedule, Daily Report and Check-In Log on
2026-10-05. **(confirmed)** = checked by reading the code; the rest came from
the review and should be confirmed before fixing. Most are races that show up
on slow connections or with two people on the same record. Suggested order:
the data-loss ones first (O1, O2, O3, O11–O14), O7 (quick), then the
permission holes (O4, O19).

### Delivery Schedule

| # | Issue | Where | Suggested fix | Status |
|---|---|---|---|---|
| O1 | **(confirmed)** Editing a transfer from its arrival week overwrites its ship date: the board's copy has `date` = arrival (`showOnArrivalDay`), the form shows that as "Ship date", and any save writes it back — moving the shipment and the sender's Daily Report count. The old DeliveryModal did this too. | `applyTransferPerspective` / `showOnArrivalDay` in `deliveryTypes.js`, `handleOpenEditModal` in `DeliveryScheduleTab.tsx`, `deliveryToFormValues` | Open the form on `shipDate` when the card is the arrival view (or refetch the raw ticket) | Fixed `a974e37` |
| O2 | Saving an ePOD sends the whole cached ticket through POST /deliveries, undoing office edits made while the driver was signing; if the full-record fetch failed it also saves the arrival date as the ship date. | `handleSavePod` in `src/features/delivery/usePodDialogs.ts` | Save only `pod` + `status` (a narrow route, like PATCH /status) | Fixed `d81862f` |
| O3 | ePOD signatures get wiped on slow signal: the modal's reset effect reruns when the full record replaces the list copy, clearing the pads and fields mid-signature. | `PodModal.tsx` reset effect, `handleOpenPod` | Reset only when the delivery *id* changes | Fixed `d81862f` |
| O4 | **(confirmed)** Read-only users and drivers can create or rewrite any ticket in their branch through the API: POST /deliveries accepts `view_delivery_schedule` (kept for driver POD capture). | `canWriteDeliveries` in `src/routes/deliveries.js` | Require `edit_delivery_schedule` for POST; give POD capture its own route | Fixed `3009b52` |
| O5 | Live updates for tickets with no branch (`''`/`'*'`, many older ones) only go to the all-branch room, so drivers' phones and single-branch boards stay stale until refreshed. | `deliveryRoomsFor` in `src/routes/deliveries.js` | Broadcast branchless tickets to every branch room | Fixed `3009b52` |
| O6 | Some cells can never be reordered ("This run changed since you loaded it" every time): the conflict check counts tickets the board doesn't show (cancelled, dated Pending in the Will Call key, other branches on the shared 3rd-party column, search-filtered cells). | reorder route in `src/routes/deliveries.js` (~line 1034) | Count only the tickets the client sent / that the board shows | Fixed `3009b52` |
| O7 | **(confirmed)** Server error reasons never reach the form: `saveDelivery` reads `body.message`, the routes answer `{ error }`. | `saveDelivery` in `src/api/deliverySchedule.ts` | Read `body.error \|\| body.message` | Fixed `a974e37` |
| O8 | Packing-list upload keys the stored PDF on a client-sent `deliveryId` with overwrite and no access check — another branch's PDF can be replaced. | `upload-packing-list` in `src/routes/deliveries.js` | Check access to that delivery's branch before overwriting | Fixed `3009b52` |
| O9 | Re-signing an ePOD whose earlier signatures were saved online can get stuck on "Saving…" (hosted image drawn without `crossOrigin` taints the canvas; `toDataURL` throws outside the try). | `initCanvas` / save in `PodModal.tsx` | Set `crossOrigin`, and catch around `toDataURL` | Fixed `d81862f` |
| O10 | Cached board and check-in data survives log-out, so on a shared PC the next person briefly sees the previous user's branches. | `scheduleCache` in `src/api/deliverySchedule.ts`, `dataCache.ts` | Clear both caches on logout | Fixed `3009b52` |

Decided to leave as they are (owner, 2026-10-15): the status pill size on board cards (a bigger pill would squeeze the SO# on the narrow columns) and the sales rep's own footer line (moving it adds a row to cards). Revisit only if the owner asks.

### Daily Report

| # | Issue | Where | Suggested fix | Status |
|---|---|---|---|---|
| O11 | **(confirmed)** Reopening a recent day doesn't work: auto-submit picks up every draft in its 3-day lookback and locks a reopened day again within about a minute. | `LOOKBACK_DAYS` / draft query in `src/jobs/autoSubmitDailyReports.js` | Skip reports reopened since their date (e.g. a `reopenedAt` flag) | Fixed `c115d4c` |
| O12 | Edits typed in the ~1.2s before switching day, branch, view or tab aren't saved: the debounced autosave is cancelled, never flushed. | autosave effect in `src/features/dailyReport/useDaySheet.ts` | Flush the pending save on day/branch change and unmount | Fixed `8fab81e` |
| O13 | Submit goes ahead even if its own save failed (`save()` swallows errors), so the last edits are lost from a locked report. | `submitDay` / `save` in `src/features/dailyReport/useDaySheet.ts` | Stop and show the error when the pre-submit save fails | Fixed `8fab81e` |
| O14 | Tapping Next day twice on slow data can mix days up: an older response overwrites the newer one, edits save to the wrong day and Submit locks the day in the header. | `loadDay` in `src/features/dailyReport/useDaySheet.ts` | Ignore responses for a day that's no longer selected | Fixed `8fab81e` |
| O15 | An autosave racing a submit can un-submit the day: PUT checks for 'submitted', then upserts with an unconditional `status: 'draft'`. | PUT in `src/routes/dailyReports.js` (~line 610) | Make the update conditional on `status != 'submitted'` | Fixed `6d132f2` |
| O16 | Draft PDFs and emails, the month view and the CSV under-report (missing auto slabs and transfers, stale Homeowners): they read stored drafts without re-deriving. | PDF / month / export routes in `src/routes/dailyReports.js` | `applyDerived` drafts before summarising | Fixed `6d132f2` |
| O17 | Homeowners can count different check-ins on screen than at submit: the day window uses the viewer's browser offset on GET/overview, the branch's current offset at submit (wrong after a DST change). | `src/routes/dailyReports.js` (~line 650) | One rule: the branch's offset on the report's date | Fixed `6d132f2` |
| O18 | The All-locations overview runs the same all-branch delivery query 13 times per load. | `deriveFromSystem` / overview in `src/routes/dailyReports.js` | Query once, split by branch | Fixed `6d132f2` |
| O22 | Manual Submit isn't atomic against the 11:59 auto-submit: both can sign the same day off and the Seattle email can go twice. (The other two O22 items — slab corrections typed on an earlier visit lost at Submit, and Enter jumping into read-only cells — are fixed; see Fixed.) | `/:date/submit` in `src/routes/dailyReports.js`, `src/jobs/autoSubmitDailyReports.js` | Claim the day with a conditional update on `status: 'draft'`, as the job does | Fixed `c115d4c` |

### Check-In Log

| # | Issue | Where | Suggested fix | Status |
|---|---|---|---|---|
| O19 | Changing the rep's email on a check-in emails the Selection Sheet to that address, even for users without the send-email permission. | PUT `/checkin/:id` in `src/routes/checkIn.js` | Require `send_checkin_email` (and a staff address) for the email | Fixed `c0a0205` |
| O20 | Fast filter or page changes can show another filter's rows (no request sequencing). | `fetchCheckIns` in `src/features/checkin/CheckInLogPage.tsx` | Ignore stale responses | Fixed `c0a0205` |
| O21 | The export is silently cut short if a page fails or past 50 pages, and has no Location column for all-branch exports. | export loop in `src/features/checkin/CheckInLogPage.tsx` (~line 247) | Fail loudly / warn on truncation; add Location | Fixed `c0a0205` |

## Customer import (SPS redesign)

The plan is the claude.ai artifact **SPS Import Redesign**
(https://claude.ai/artifact/BcFNBYMJE9fQz6bxjmMCte). Build order: 1 deletions
recorded (done), 2 file check + SPS key (done), 3 connect existing customers
(on `feat/sps-connect`, not on `main`), 4 account groups, 5 the new import,
6 switch over.

- [ ] **Account groups (build step 4) postponed by the owner, 2026-10-17.**
      Groups, the suggestion screen, the Customer List's "Group locations" and
      Group filter, and the group panel on a customer are not built. The
      import (step 5) is built without them: it shows no "possible groups"
      note and no new store joins a group. When groups ship, add both.
- [ ] **The new import (build step 5) is on `feat/sps-connect`, not on
      `main`, and hasn't run on real data.** Rehearse it read-only on live data
      first (plan only, nothing started) and check the tally and the "Deleted
      before" list; the old "Import from Excel" stays until step 6.
- [ ] **New import, not built yet:** the Customer List's "Import: …" filter and
      "New from SPS" badge, and the "See the new customers" button on the
      results (the server answers `GET …/sps-import/runs/:id/customers`; the
      list doesn't read it yet). A customer **merged** into another is not
      recognised as "already handled" (the artifact's Deleted-before example):
      merge records aren't read, so a merged-away SPS name shows as New or
      Need a decision. Branch is still "SPS wins" and a blank SPS rep keeps
      ours (the artifact's defaults 1 and 2, never answered by the owner).
- [ ] **The old "Import from Excel" menu item is hidden** (owner, 2026-10-17;
      `SHOW_EXCEL_IMPORT` in `src/features/customers/list/listOptions.ts`). Its window also held the
      **"Possible duplicates already in the database"** list (merge / delete /
      keep separate), which now has no way in. Move that list somewhere of its
      own before the old import is deleted (step 6).
- [ ] **Step 3 hasn't been run on real data.** Do a dry run with the real SPS
      file and check the report before it goes to `main`; the new import
      (step 5) needs customers connected first.

## Cleanup due

- [ ] **On or after 2026-11-06:** drop the old customer API addresses kept
      as aliases when everything moved under `/api/customers` (2026-10-06):
      `/api/sales/customers`, `/api/partners…`, `/api/admin/customers…` in
      server.js's route arrays and the cache-bust middleware. By then every
      cached app has updated. `grep -rn "api/partners\|api/sales/customers\|api/admin/customers" src`
      should find nothing first.

## Fixed

| Date | Issue | Commit |
|---|---|---|
| 2026-10-24 | Route Planner dead code, on the owner's go-ahead: `panels/AreaScheduleTrigger.tsx` and `rail/ScheduleSummaryButton.tsx` with their CSS (imported by nothing) and the unused `statusTone` / `STATUS_TONE` in `helpers.ts` deleted. | on `feat/typescript` |
| 2026-10-24 | Delivery board: a dead effect meant to scroll the phone's selected day pill into view (its selector matched no element). Not a visible bug — the five pills are a grid that always fits — so it was removed rather than revived (`scrollIntoView` also scrolls the page, see Locations in CLAUDE.md). | on `feat/typescript` |
| 2026-10-24 | Daily Report: a save refused because someone else had submitted the day (409) reloaded the sheet locked but wiped "This day has been submitted" at once, and Submit in that case said "check your connection". The reload now keeps the note (`loadDay(notice)` in `useDaySheet.ts`). | on `feat/typescript` |
| 2026-10-24 | Cleanup: the old Add / Edit delivery form `DeliveryModal.jsx` (unused since `DeliveryForm` went live on 2026-10-05) deleted, on the owner's go-ahead. | on `feat/typescript` |
| 2026-10-15 | Daily Report transfers: one line per transfer, each with its Transfer # (a ticket line per ticket, no longer one per route), so the same transfer added twice is flagged; the typed Count is gone (the month view, its PDF and the CSV count the lines); headings line up with their boxes; one row per line at any width — on phones Slabs used to run off the edge. | `a1fd574` |
| 2026-10-15 | Transfers #6: a transfer line added by hand on the Daily Report always counted as Outgoing. Its route now decides (ending at the report's branch is Incoming), with a note when the route skips the branch or repeats a ticket line. | `a75e9b3` |
| 2026-10-15 | Delivery board: stop numbers skipped (Stop #1, #3) after a delete, cancel or move, and the board, the Edit delivery form and the driver's phone could disagree. Each driver's day is now kept 1, 2, 3, and old gaps closed at startup. | `3691007` |
| 2026-10-15 | Delivery board: the Day column took a quarter of a wide screen and pushed Will Call off the edge with no sign more was there (now a fixed width, with arrows and fades); today's whole row is tinted; finished stops are faded; "No ePOD" on a completed delivery is amber; counts read "3/12 stops". | `43294d2` |
| 2026-10-15 | Delivery Schedule O2: Saving an ePOD sends the whole cached ticket through POST /deliveries, undoing office edits made while the driver was signing; if the full-record fetch failed it also saves the arrival date as the ship date. | `d81862f` |
| 2026-10-15 | Delivery Schedule O3: ePOD signatures get wiped on slow signal: the modal's reset effect reruns when the full record replaces the list copy, clearing the pads and fields mid-signature. | `d81862f` |
| 2026-10-15 | Delivery Schedule O9: Re-signing an ePOD whose earlier signatures were saved online can get stuck on "Saving…" (hosted image drawn without `crossOrigin` taints the canvas; `toDataURL` throws outside the try). | `d81862f` |
| 2026-10-15 | Delivery Schedule O4: Read-only users and drivers can create or rewrite any ticket in their branch through the API: POST /deliveries accepts `view_delivery_schedule` (kept for driver POD capture). | `3009b52` |
| 2026-10-15 | Delivery Schedule O5: Live updates for tickets with no branch (`''`/`'*'`, many older ones) only go to the all-branch room, so drivers' phones and single-branch boards stay stale until refreshed. | `3009b52` |
| 2026-10-15 | Delivery Schedule O6: Some cells can never be reordered ("This run changed since you loaded it" every time): the conflict check counts tickets the board doesn't show (cancelled, dated Pending in the Will Call key, other branches on the shared 3rd-party column, search-filtered cells). | `3009b52` |
| 2026-10-15 | Delivery Schedule O8: Packing-list upload keys the stored PDF on a client-sent `deliveryId` with overwrite and no access check — another branch's PDF can be replaced. | `3009b52` |
| 2026-10-15 | Delivery Schedule O10: Cached board and check-in data survives log-out, so on a shared PC the next person briefly sees the previous user's branches. | `3009b52` |
| 2026-10-15 | Delivery cards: the left edge meant the driver's colour, or red for a return; it's now the ticket's kind only (gold delivery, red return, blue transfer, teal will call). The form also filled just the customer's city as the address, so some cards read only "Lacey". | `3009b52` |
| 2026-10-06 | Daily Report: a day nobody opened got no report and no email even with deliveries or check-ins (Seattle missed 4 days in September). The 11:59 PM job now files any day with activity. | `234aad2` |
| 2026-10-06 | Delivery form: changing a ticket on a day whose report was already submitted left the board and the signed-off report quietly disagreeing. The form now warns and names the day. | `234aad2` |
| 2026-10-07 | Board: dragging a ticket onto or off a day whose report was already submitted (to a driver, Pending or Cancelled) gave no warning. The board now shows the same note as the form after the move. | `c54324e` |
| 2026-10-05 | Daily Report: after a reload, slab corrections typed on an earlier visit looked untouched, so the next save (the one before Submit included) blanked them and Submit locked the schedule's figure. GET now returns `handSet` and the sheet keeps them. Enter also skips the new read-only cells. | `aa869db` |
| 2026-10-05 | Daily Report: a sheet left open all day submitted the figures it loaded that morning (check-ins, Count figures, transfer lines, untouched slabs). `/submit` now re-derives before locking, like the 11:59 auto-submit. | `aa869db` |
| 2026-10-05 | Daily Report: hand edits to Homeowners, Deliveries / Pick-ups Count and auto transfer Count snapped back on reload, and removing an auto transfer line didn't stick (old issues 1, 2 and the Homeowners entry). All four are now read-only, from the check-in log / schedule / tickets; auto lines have no X. | `aa869db` |
| 2026-10-05 | Month view, month PDF and CSV counted only outgoing transfers — incoming now shown beside them | `32caf27` |
| 2026-09-29 | Driverless transfers counted as incoming on the receiving branch's Daily Report | `20e7102` |
| 2026-09-29 | Transfers could be saved with no expected arrival, no From/To branch, or From = To | `354f986` |
