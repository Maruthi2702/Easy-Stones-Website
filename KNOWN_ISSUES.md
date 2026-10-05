# Known Issues

Open bugs and gaps that have been found but not fixed yet. Add an entry when
you find one you're not fixing right away; move it to **Fixed** (with the
commit) when it's done, rather than deleting it.

Last reviewed: 2026-09-29

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
| 7 | Minor: month view and CSV count only outgoing transfers (the PDF shows incoming too). A driver assigned after the arrival day's 11:59 PM auto-submit never reaches that report. | `summarise` in `dailyReports.js`, `src/jobs/autoSubmitDailyReports.js` | Probably leave as-is | Open |

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

## Cleanup due

- [ ] **On or after 2026-10-19:** delete
      `src/components/sales/delivery/DeliveryModal.jsx` if the new Add / Edit
      delivery form (`DeliveryForm.jsx`, live since 2026-10-05) has worked
      well. Nothing mounts it; it's kept only as a fallback. Before deleting,
      `grep -rn "DeliveryModal" src` should only find comments.

## Fixed

| Date | Issue | Commit |
|---|---|---|
| 2026-09-29 | Driverless transfers counted as incoming on the receiving branch's Daily Report | `20e7102` |
| 2026-09-29 | Transfers could be saved with no expected arrival, no From/To branch, or From = To | `354f986` |
