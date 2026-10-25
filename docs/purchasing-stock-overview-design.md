# Purchasing stock overview

Design and implementation based on the owner's requested columns and follow-up: show exact
days of cover (1, 2, 4, 5, 10 or any longer period), not only 30/60/90 buckets.
The main stock columns and custom-day control are now connected to the live
Purchasing component and API. The standalone `.tsx` preview remains illustrative;
it is not the production data source. Invalid sales cutoffs remain blocked.

Preview: run Vite and open `/docs/previews/purchasing.html`.
Source: `src/features/purchasing/design/PurchasingOverviewPreview.tsx`.

## Main table

| Column | Meaning and display |
|---|---|
| Color & variant | Exact color, thickness/finish/format; branch shown underneath. Expand buying calculation. |
| Total SPS slabs | Physical full slabs currently on hand in the selected branch scope, including allocated slabs. Excludes incoming supply and non-slab products. |
| Allocated | Distinct on-hand slabs committed to orders/holds. Expand by SPS commitment and app hold, deduplicated by serial. Other unavailable counts are separate. |
| Available to sell | Physical full slabs free for new sales after known commitments and eligibility exclusions. |
| In-transit containers | Remaining slabs of this variant and distinct containers carrying them; next expected receipt. Expand PO, container, supplier, branch, slabs, dates and confidence. |
| Stock lasts | Actual number of days the current free stock covers at the verified average daily sales pace, e.g. 2.5 days or 47 days. Show projected stockout date. |
| After N days | Remaining stock or shortage for the user's chosen horizon. Units explicitly say slab equivalents; incoming supply excluded from this baseline. |
| Next action | Stock sufficient, review replenishment, expedite/transfer review, or verify data; show one short reason. |

Global control: **Plan for [10] days**. Allow any whole number from 1–365 with
presets 1, 2, 4, 5, 10, 30, 60, 90. This changes the forecast inspection horizon,
not supplier lead time, buffer policy or an approved purchase quantity.
Days of cover always displays the actual result independently of this control.

Use current shared table, search, pagination, forms and black/white/gold theme.
The preview demonstrates column content and interactions, not a replacement
navigation system. Production lists retain the shared 25/50/100 pagination.
On phones keep color, available stock, cover and action prominent; show total,
allocation and incoming detail in an expandable card in the implementation pass.
The standalone preview currently uses horizontal table scrolling on phones.

## How the existing four fields work

Verified against `planning.ts`, `buildPlan.js` and `BuyerQueue.tsx`:

| Current label | Current behavior | Proposed label/location |
|---|---|---|
| 60-day need | New-buy proposal assuming 60 days to receive a new purchase, plus review interval and safety buffer, minus ready stock and eligible incoming supply; MOQ/bundle rounded | Suggested buy · 60-day delivery, inside buying details |
| 90-day need | Same calculation with a 90-day lead time; current default protective buying case | Suggested buy · 90-day delivery, inside buying details |
| Required receipt | `protective.bufferBreachOn`: first date the dated projection falls below the safety buffer; not the container's ETA and not necessarily stockout | Replenishment needed by / safety-buffer threshold, inside details |
| Buyer action | Rule-based decision from missing inputs, earlier shortages, active policy and proposed purchase quantity | Next action, in main table |

With current defaults, the 60-day scenario targets 88 days of demand
(60 + 7 review + 21 buffer); the 90-day scenario targets 118 days. Eligible
incoming receipts are netted through lead time + review, not the full buffer
horizon. A bundle-rounded recommendation is not a guarantee against a shortage
before a container arrives. Receipt timing must also be checked.

Keep supplier lead-time scenarios available to buyers but separate from the
simple question, “Will today's stock last another 5 days?” A custom horizon
must never silently change the draft's purchasing assumptions.

## Calculations and unknowns

Average daily demand in SF = verified SF sold / inclusive observed calendar days.
Current stock cover = available eligible SF / average daily SF demand.
Use matching verified branch coverage, variant and UOM throughout.

Stock balance after N days = available SF − daily demand SF × N.
For full-slab buying, show this in supplier slab equivalents using the approved
SF/slab conversion; also expose the SF calculation in details. Do not label a
fractional forecast as an exact physical slab count: actual slab sizes differ.
If a reliable matching physical-slab sales rate is supported later, identify
that method explicitly rather than silently switching denominators.

Example with uniform 75 SF slabs: 120 available slabs = 9,000 SF; average daily
sales = 150 SF = 2 slab equivalents. Stock lasts 60 days. At 5 days, 110 slab
equivalents remain; at 90 days, the shortage is 60. An incoming 52 slabs is shown
separately. Its arrival date determines whether it bridges the gap.

- Valid demand, zero available stock: 0 days of cover; action review required.
- Verified zero demand: “No sales in observed period,” not an invented infinity
  or a claim of permanent excess stock.
- Invalid dates/quantities, missing sales or unresolved branch identity: “Coverage
  unknown,” with a repair action. Stale inputs or unconfirmed coverage can yield
  a labelled estimate for a matching reported variant and single branch. Display reliable physical counts even when the forecast is blocked.
- Unknown allocation/eligibility: show the known counts and unresolved amount;
  do not infer allocation as total minus available if some stock is damaged,
  in transfer, a remnant or has unknown status.
- Fractional days: display at most one decimal, conservatively; do not round
  a positive fraction down to a misleading “0 days.” Stockout dates are estimates.
- Aggregate sales reports do not supply genuine recent trends. Show the observed
  sales period and method; do not invent daily time series or a 30-day sales pace.

## Backend implementation and remaining boundaries

The plan API now exposes a typed stock breakdown and independent coverage facts.
It loads type/on-hand quantity as well as the prior availability projection.
The typed stock-overview helper classifies SPS and app commitments once.
The broader shared availability migration remains in the inventory plan. Count
verified full-slab physical identities, not the SF `instockQty` field and not
only `availableSlabs` (which omits allocated stock). Reconcile duplicate/missing
serials before treating the count as exact. Consignment/non-slab/remnant handling
must be explicit in the selected warehouse scope.

The breakdown must reconcile: total = allocated + other unavailable + available.
Show unknown classification explicitly when reconciliation is incomplete. Count
a slab once if SPS commitment and an app hold overlap; purchasing draft locks
prevent duplicate buying and are not physical stock allocations.

Typed demand/coverage facts are computed independently of the purchase recommendation.
Missing supplier packing/weight policy may prevent a draft without hiding a
valid SF-based stock cover. Separate forecast blockers from buying blockers.
Preserve `null` and specific reason codes when a coverage input is invalid.

Reconcile remaining shipment quantities and complete/partial source snapshots
before describing incoming as current. Missing/overdue ETA is a warning. A
reported ETA alone is not confirmed usable receipt. A PO and its containers do
not add together. A shared container can appear under several colors; table-wide
container totals count distinct containers rather than summing row counts.

Report upload timestamps are audit metadata and do not limit the sales period.
A completed report supplies its own start/end dates automatically. Validate the
file's actual dates and numeric inputs; show scope-level issues in one banner.

## Useful enhancements, in priority order

1. Expand allocated stock to see SO/hold/transfer breakdown and unmatched rows.
2. Expand incoming supply to see PO/container details and whether it arrives
   before stockout; highlight overdue/unknown receipt dates.
3. Separate current-stock cover from a dated “with confirmed arrivals” projection.
   Never divide total stock plus all future inbound by daily sales and call the
   result safe cover; shortages can occur before later receipts arrive.
4. Filter/sort by actual days of cover, shortage in the chosen period, overdue
   shipments and data exceptions. Do not hardcode a universal “urgent below
   30 days”: urgency depends on the receiving lead time and safety policy.
5. Add “Order by” and required-receipt dates to buying details, with overdue
   actions and the calculation explained. Container count is physical evidence;
   new-container estimates also require valid weights, slots and mix rules.
6. Add last stock/sales/transit sync dates and a buyer review export. Trends,
   forecast confidence and seasonal planning wait for sufficient dated history.

This proposal changes the main table columns and adds a custom-day control.
It keeps the existing module entry, planning scope and draft/approval flow.
The standalone preview remains illustrative; the live workbench is connected to the imported data.

## Preview verification

Chromium checks passed for the 2/4-day presets, an arbitrary 12-day horizon,
projected balances, invalid zero-day entry, expanded PO/container details,
search, light/dark themes and phone page containment. The phone table scrolls
inside its container. No page errors occurred. Strict TypeScript checks and
the standalone preview build passed. The preview does not call a live API or
change production purchasing behavior.

## Current calculation and data flow

The live BuyerQueue renders total SPS slabs, allocated, available, incoming,
actual days of cover and a 1–365-day balance control. Buying scenarios stay in
expandable details. The PlanDetails modal exposes the same stock breakdown.
Purchasing surfaces inherit the canonical theme tokens.

`reportSalesPeriod()` is shared by the server and scope form. For a completed
report it uses the file's inclusive start/end dates automatically. January 1
through September 30, 2026 is 273 days. A leftover manual cutoff, upload date
or historical confirmation record does not change that denominator. The API
accepts a completed report without a supplied observed-through date. The form
shows the report period and removes the manual date/confirmation controls.

If a requested report range ends in the future, only its actual reported-through
date may establish the denominator. An absent actual date remains an input error;
the app does not assume future days have occurred. Missing/invalid file dates,
mixed imports, ambiguous physical counts, invalid quantities, duplicate sales
and unverified cross-branch matches remain coverage errors.

Average daily demand = reported SF sold / inclusive report days. Current stock
cover = eligible available SF / daily SF demand. The custom-day balance uses
the same rate and excludes future inbound. Supplier conversion policy is used
only to express a balance in slab equivalents; valid SF-based cover needs no
supplier/bundle/weight setup.

Stale reports and unchecked stock/coverage attestations produce a labelled
historical estimate for otherwise valid, branch-matched reported rows. Show the
period, approximate marker and assumption warnings. A missing variant does not
become zero without verified full coverage. Reported zero sales is displayed
explicitly rather than as infinite cover.

## Buying workflow and diagnostics

Stock estimates do not enable purchase drafts or approvals. Keep stock/supply
freshness, completeness, supplier, bundle, weight, container capacity, branch
access, record versions and reservation checks for buying decisions. Scope-wide
issues stay in the existing banner; row-specific issues are separate. Unknown
coverage includes its actual reasons and an editor-only repair link.

The former upload-date confirmation workflow has been removed. Existing dated
confirmations remain audit history; this change does not rewrite source import
timestamps or automatically check any buying/warehouse attestations.

## Verification

81 rule/API/render tests passed, including completed periods without manual
dates, earlier upload timestamps, future/open-ended ranges and existing draft
validation. Strict TypeScript and production build passed. Chromium verified
actual estimates, custom-day balances, a completed-report form with no cutoff
or confirmation control, saving, themes and phone containment.

Read-only evaluation of Seattle's imported data produced numeric estimates
using the file's January–September period with the manual cutoff blanked and
historical confirmation excluded in memory. No production data was changed by
this evaluation.
