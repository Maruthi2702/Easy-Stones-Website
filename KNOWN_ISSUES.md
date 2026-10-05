# Known Issues

Open bugs and gaps that have been found but not fixed yet. Add an entry when
you find one you're not fixing right away; move it to **Fixed** (with the
commit) when it's done, rather than deleting it.

Last reviewed: 2026-10-05

## Transfers & Daily Report

Found in a read-only review on 2026-09-29. Nothing below has been changed yet.

### Live data still to update

Code for these is on `main`; the database hasn't been updated yet.

- [ ] `node scripts/fix-transfer-origins.js --apply` — sets the sending branch
      on #18356 (Salt Lake City), #18357 (Spokane) and #18299 (Seattle). Until
      then #18299 counts as outgoing on every branch's report for 8/10, because
      the report treats an empty branch as its own.
- [ ] Then `node scripts/backfill-transfer-arrivals.js --apply` — fills the 14
      blank arrival dates with the ship date so receiving branches can see them.
- [ ] Decide on the 5 completed transfers whose arrival is before their ship
      date (zd0nt, 0d5nx, ore1x, etqbu, fsvcu): set arrival = ship date, or
      leave them.
- [ ] Delete test transfer #11111 (Seattle → Spokane, no driver).

Both scripts only preview until run with `--apply`.

### Issues

| # | Issue | Where | Suggested fix | Status |
|---|---|---|---|---|
| 1 | Editing **Count** on an auto-filled transfer line doesn't stick. A draft save drops the line unless Slabs was also touched, and every reload resets Count from the tickets. | `DailyReportTab.jsx` transfer rows, `buildDraftPayload` in `savePayload.js`, `applyDerived` in `src/routes/dailyReports.js` | Make Count read-only on auto-filled lines, like From/To already are (or decide it should be overridable and persist it) | Open |
| 2 | Deleting an auto-filled transfer line (X) doesn't stick — it's rebuilt from the tickets on the next reload. | `DailyReportTab.jsx`, `applyDerived` | Hide the X on auto-filled lines; the fix belongs on the ticket | Open |
| 3 | The receiving branch can drag the sender's Pending transfers onto its own driver. The transfer then vanishes from the sender's board (no column for that driver) but still counts as shipped, and the drop day is saved as the *ship* date. | `?pending=true` in `GET /api/deliveries`, `scopeDeliveryQueryToLocations`, `PATCH /deliveries/:id/assignment` | Blocked on question A | Open |
| 4 | A transfer on a branch-only driver is invisible on the receiving branch's board (no column for that driver). 1 of 76 transfers today (Sergio); the rest use the all-branch "3rd party - delivery" driver, which shows on every board. | `BoardGrid.jsx` columns, `fetchDriverUsers` in `src/api/deliverySchedule.js` | Blocked on question B | Open |
| 5 | No "mark received" button. `PATCH /deliveries/:id/receive` and the report's received fields exist, but nothing calls them. | `src/routes/deliveries.js`, inbound `ticketIds` in `deriveFromSystem` | New feature: a Received button on incoming lines or cards | Open |
| 6 | A transfer line added by hand always counts as Outgoing; there's no way to add an incoming line. | `addTransfer` in `DailyReportTab.jsx`, PUT `/api/daily-reports/:date` | New feature: an In/Out toggle on manual lines | Open |
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
2. Issues 1 and 2 together — small, and stop report edits being silently lost.
3. Answer A and B, then issues 3 and 4.
4. Decide whether 5 and 6 are worth building.

## Daily Report — other

- **Hand-corrected Homeowners count reverts on reload**, then the next autosave
  overwrites it (reported 2026-09-20, not re-checked since). `applyDerived`
  sets `visitors.homeowners` from check-ins on every load. Same class of bug
  as issue 1 above.

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
| O1 | **(confirmed)** Editing a transfer from its arrival week overwrites its ship date: the board's copy has `date` = arrival (`showOnArrivalDay`), the form shows that as "Ship date", and any save writes it back — moving the shipment and the sender's Daily Report count. The old DeliveryModal did this too. | `applyTransferPerspective` / `showOnArrivalDay` in `deliveryTypes.js`, `handleOpenEditModal` in `DeliveryScheduleTab.jsx`, `deliveryToFormValues` | Open the form on `shipDate` when the card is the arrival view (or refetch the raw ticket) | Fixed `a974e37` |
| O2 | Saving an ePOD sends the whole cached ticket through POST /deliveries, undoing office edits made while the driver was signing; if the full-record fetch failed it also saves the arrival date as the ship date. | `handleSavePod` in `DeliveryScheduleTab.jsx` | Save only `pod` + `status` (a narrow route, like PATCH /status) | Open |
| O3 | ePOD signatures get wiped on slow signal: the modal's reset effect reruns when the full record replaces the list copy, clearing the pads and fields mid-signature. | `PodModal.jsx` reset effect, `handleOpenPod` | Reset only when the delivery *id* changes | Open |
| O4 | **(confirmed)** Read-only users and drivers can create or rewrite any ticket in their branch through the API: POST /deliveries accepts `view_delivery_schedule` (kept for driver POD capture). | `canWriteDeliveries` in `src/routes/deliveries.js` | Require `edit_delivery_schedule` for POST; give POD capture its own route | Open |
| O5 | Live updates for tickets with no branch (`''`/`'*'`, many older ones) only go to the all-branch room, so drivers' phones and single-branch boards stay stale until refreshed. | `deliveryRoomsFor` in `src/routes/deliveries.js` | Broadcast branchless tickets to every branch room | Open |
| O6 | Some cells can never be reordered ("This run changed since you loaded it" every time): the conflict check counts tickets the board doesn't show (cancelled, dated Pending in the Will Call key, other branches on the shared 3rd-party column, search-filtered cells). | reorder route in `src/routes/deliveries.js` (~line 1034) | Count only the tickets the client sent / that the board shows | Open |
| O7 | **(confirmed)** Server error reasons never reach the form: `saveDelivery` reads `body.message`, the routes answer `{ error }`. | `saveDelivery` in `src/api/deliverySchedule.js` | Read `body.error \|\| body.message` | Fixed `a974e37` |
| O8 | Packing-list upload keys the stored PDF on a client-sent `deliveryId` with overwrite and no access check — another branch's PDF can be replaced. | `upload-packing-list` in `src/routes/deliveries.js` | Check access to that delivery's branch before overwriting | Open |
| O9 | Re-signing an ePOD whose earlier signatures were saved online can get stuck on "Saving…" (hosted image drawn without `crossOrigin` taints the canvas; `toDataURL` throws outside the try). | `initCanvas` / save in `PodModal.jsx` | Set `crossOrigin`, and catch around `toDataURL` | Open |
| O10 | Cached board and check-in data survives log-out, so on a shared PC the next person briefly sees the previous user's branches. | `scheduleCache` in `src/api/deliverySchedule.js`, `dataCache.js` | Clear both caches on logout | Open |

### Daily Report

| # | Issue | Where | Suggested fix | Status |
|---|---|---|---|---|
| O11 | **(confirmed)** Reopening a recent day doesn't work: auto-submit picks up every draft in its 3-day lookback and locks a reopened day again within about a minute. | `LOOKBACK_DAYS` / draft query in `src/jobs/autoSubmitDailyReports.js` | Skip reports reopened since their date (e.g. a `reopenedAt` flag) | Open |
| O12 | Edits typed in the ~1.2s before switching day, branch, view or tab aren't saved: the debounced autosave is cancelled, never flushed. | autosave effect in `DailyReportTab.jsx` (~line 283) | Flush the pending save on day/branch change and unmount | Open |
| O13 | Submit goes ahead even if its own save failed (`save()` swallows errors), so the last edits are lost from a locked report. | `submitDay` / `save` in `DailyReportTab.jsx` | Stop and show the error when the pre-submit save fails | Open |
| O14 | Tapping Next day twice on slow data can mix days up: an older response overwrites the newer one, edits save to the wrong day and Submit locks the day in the header. | `loadDay` in `DailyReportTab.jsx` | Ignore responses for a day that's no longer selected | Open |
| O15 | An autosave racing a submit can un-submit the day: PUT checks for 'submitted', then upserts with an unconditional `status: 'draft'`. | PUT in `src/routes/dailyReports.js` (~line 610) | Make the update conditional on `status != 'submitted'` | Open |
| O16 | Draft PDFs and emails, the month view and the CSV under-report (missing auto slabs and transfers, stale Homeowners): they read stored drafts without re-deriving. | PDF / month / export routes in `src/routes/dailyReports.js` | `applyDerived` drafts before summarising | Open |
| O17 | Homeowners can count different check-ins on screen than at submit: the day window uses the viewer's browser offset on GET/overview, the branch's current offset at submit (wrong after a DST change). | `src/routes/dailyReports.js` (~line 650) | One rule: the branch's offset on the report's date | Open |
| O18 | The All-locations overview runs the same all-branch delivery query 13 times per load. | `deriveFromSystem` / overview in `src/routes/dailyReports.js` | Query once, split by branch | Open |
| O22 | (In the uncommitted read-only / submit-refresh work, as of 2026-10-05) after a reload, slab corrections typed earlier are lost on Submit; Enter jumps into the new read-only cells; manual submit isn't atomic against the 11:59 job (possible double email). | `DailyReportTab.jsx`, `savePayload.js`, `/submit` in `src/routes/dailyReports.js` | Check before that work is committed | Open |

### Check-In Log

| # | Issue | Where | Suggested fix | Status |
|---|---|---|---|---|
| O19 | Changing the rep's email on a check-in emails the Selection Sheet to that address, even for users without the send-email permission. | PUT `/checkin/:id` in `src/routes/checkIn.js` | Require `send_checkin_email` (and a staff address) for the email | Fixed `c0a0205` |
| O20 | Fast filter or page changes can show another filter's rows (no request sequencing). | `fetchCheckIns` in `src/pages/CheckInLogPage.jsx` | Ignore stale responses | Fixed `c0a0205` |
| O21 | The export is silently cut short if a page fails or past 50 pages, and has no Location column for all-branch exports. | export loop in `src/pages/CheckInLogPage.jsx` (~line 247) | Fail loudly / warn on truncation; add Location | Fixed `c0a0205` |

## Cleanup due

- [ ] **On or after 2026-10-19:** delete
      `src/components/sales/delivery/DeliveryModal.jsx` if the new Add / Edit
      delivery form (`DeliveryForm.jsx`, live since 2026-10-05) has worked
      well. Nothing mounts it; it's kept only as a fallback. Before deleting,
      `grep -rn "DeliveryModal" src` should only find comments.

## Fixed

| Date | Issue | Commit |
|---|---|---|
| 2026-10-05 | Month view, month PDF and CSV counted only outgoing transfers — incoming now shown beside them | `32caf27` |
| 2026-09-29 | Driverless transfers counted as incoming on the receiving branch's Daily Report | `20e7102` |
| 2026-09-29 | Transfers could be saved with no expected arrival, no From/To branch, or From = To | `354f986` |
