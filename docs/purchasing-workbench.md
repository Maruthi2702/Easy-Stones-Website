# Purchasing workbench

Implemented on `feat/purchasing-workbench`, under Inventory Analysis → Purchasing. This is an internal buyer workflow; it does not place or send purchase orders.

The proposed architecture and incremental migration are documented in
[`purchasing-architecture.md`](purchasing-architecture.md). That design separates
current behavior from target changes and preserves this workbench's UX.

## Enable and configure

1. Users & Roles → Inventory Analysis: grant **View**, **Purchasing**, and, as appropriate, **Manage purchasing** and **Approve purchasing**. Admin/director receive the purchasing permissions once through the existing seeded-permission migration; revocations remain respected. Branch assignments restrict all purchasing scopes.
2. Import stock and Fast Moving sales through the existing Inventory Analysis import screens. Create a scope using the report's actual branch membership and full-product coverage. Completed reports use their own sales start/end dates automatically; upload timestamps do not constrain coverage. A future requested end uses the report's actual sales-through date, never future unobserved days. No automatic splitting of legacy combined location labels occurs.
3. Confirm the exact current stock snapshot, availability/commitment semantics, usable-receipt lead-time range, weekly review and buffer. A changed stock snapshot invalidates its coverage confirmation. Default proposals: 7-day review, 21-day buffer, stock/inbound at most 24 hours old, sales lag at most 14 days. The confirmed lead-time cases are 60 and 90 calendar days.
4. Add exact variant policies, individually or with the downloadable CSV template. Supply actual supplier, bundle minimum/multiple, usable SF per purchased slab, slab weight and active/discontinued status. Approve name aliases explicitly. Thickness, finish and format are never fuzzy-merged.
5. Import the complete SPS PO/transit scope through the CSV adapter, or explicitly confirm SPS has no remaining incoming supply. This is a validated manual integration boundary; no credentials, undocumented SPS API or automatic scrape is assumed. Adapt the actual SPS exports into the template's documented columns.
6. Confirm container payload, rack/crate tare, a supplier-approved physical slab-slot/layout cap, and any permitted mixed-color groups. Until known, zeros/unconfirmed limits can be saved for investigation, but container drafting fails with a readable validation message.

## Supply adapter contract

CSV headers:

```text
po,line,product,branch,supplier,ordered,received,cancelled,eta,confirmed,shipment,shipped,shipmentReceived,shipmentEta
```

- Quantities are full slabs. Dates are destination **usable receipt** dates in YYYY-MM-DD format.
- Each row references a stable SPS PO ID/number and line ID. Use the exact variant identity and destination.
- Parent ordered/received/cancelled totals, identity and unshipped-balance ETA repeat consistently on shipment rows. One shipment ID occurs once per PO line.
- `shipped` and `shipmentReceived` belong to that shipment. `received` is the entire PO line's received total. Transit is a fulfillment of the PO, not another order.
- Example: 120 ordered, 60 shipped and none received is 120 incoming total. If 30 of that shipment are received, incoming becomes 90; those same 30 enter ready stock only at acceptance.
- `eta` is the usable ETA for the unshipped balance; `shipmentEta` is that shipment's ETA. Unconfirmed, missing and overdue ETAs block the affected variant. Later-than-horizon supply is not counted toward the immediate buy target.
- Required totals must be present, including explicit zeros. Negative/fractional slab counts, inconsistent parent totals, duplicate shipments and irreconcilable receipts are rejected without replacing the last valid snapshot.
- Each import is an immutable complete scope snapshot, not a delta. Missing feed and a confirmed empty feed differ.

## Forecast and inventory semantics

The engine uses one selected, verified sales cohort and inclusive calendar days, avoiding DST/millisecond denominators and overlap double-counting. SF demand is converted using that variant's supplier SF/slab. Ready **SF** is converted to the same supplier slab equivalents; physical ready slab counts remain separately visible. EA and other units cannot silently enter full-slab planning.

Ready stock excludes held, committed, transit, remnant and unknown-status rows. App slab reservations are matched by normalized serial and subtracted only from otherwise-ready stock. Obligations already excluded by SPS are not subtracted twice. Missing stock becomes a confirmed zero only with complete stock coverage and an explicit canonical-variant policy; otherwise it remains unknown.

Target position = daily demand × (lead + review + buffer). Deduct ready stock and dependable receipts due within lead + review, then round positive need to MOQ and whole bundles. Verified zero demand and discontinued variants do not generate automatic buys. The dated projection uses conservative end-of-day receipts and retains negative/unmet demand. Sufficient total future supply does not conceal an earlier shortage: **Expedite existing supply** remains a separate action even with zero new-buy quantity.

The urgent quantity is a subset of the proposed new buy. The separate early receiving gap may instead require expediting an existing PO. No transfer source or arrival promise is fabricated.

## Drafts, approvals and duplicate prevention

- Buyers choose explicit destinations for combined scopes. Quantity overrides need a note, remain whole bundles and respect supplier minimums.
- Draft creation stores calculation evidence and exact source fingerprints, then reserves each variant across every scope branch in a MongoDB transaction. These locks also prevent overlap with single-branch/network scopes and approved aliases.
- Container allocation is deterministic whole-bundle first-fit by supplier, destination and approved mix group. Blank/unapproved mixing is single-color. Both payload including tare and supplier-confirmed layout cap must pass. No filler demand is added; this is not an optimal packing claim.
- Approvers revalidate stock, sales, incoming supply, policies, reservations, freshness and record version. Source changes require cancellation/recreation before approval or export. The approved export endpoint rechecks as well.
- Approval is internal. After placing the order in SPS, import its supply snapshot and **Link SPS order** to the new PO lines created for that draft. Existing supply already present during calculation cannot be claimed as the new purchase. A PO line can be linked to only one draft. PO amendments should use a new line for this workflow.
- Linking verifies product, supplier, destination and ordered-minus-cancelled coverage; it and cancellation release variant locks atomically. Linked PO identities remain reserved permanently against duplicate attribution.
- Pending drafts are reservations against duplicate buying, not firm receipt promises. Their quantities are shown through draft status rather than added to confirmed incoming supply.

## Implementation layout

- `src/purchasing/`: schemas, dedicated collections, typed pure planning/reconciliation/container engine, source loading, buyer API and transaction-protected draft workflow.
- `src/features/purchasing/`: typed API/hook, queue, performance view, source/policy setup, CSV adapters, explanation and receipt timeline, container approval/history views. Imported only through `index.ts`.
- `server.ts`: `/api/purchasing` mount and one-time permission grants. New model indexes join `src/config/indexedModels.ts`.
- Current stock detail and the existing descriptive velocity view remain available. The validated Purchasing view is separate and works even before stock has been imported, so missing inputs are explainable.

## Known boundaries and next data-backed work

The stock import remains a current mirror. This feature retains immutable incoming snapshots and draft calculation evidence; a full stock ledger and historical backtests are not invented. All-zero warehouses without a dated stock manifest remain blocked. Statistical XYZ/service-level forecasts, comparable 30/90/180-day trends, automatic transfers, estimated landed spend, direct SPS synchronization, origin/ship-ready-window feeds, and weight/geometry loading optimization require additional verified data and adapters. The mix-group/layout approval is a buyer/supplier attestation, not a 3D loading simulation. No cost fields are added to purchasing responses.

The workbench refreshes every 30 seconds and on existing inventory refresh signals. Long-running import races and direct database edits outside the app are still controlled by source fingerprints and final revalidation rather than an inventory ledger; no external order is automated.

## Verification

Pure tests cover inclusive dates, variant identity, PO/transit deduplication and partial receipts, two lead-time cases, late receipts, zero demand, MOQ/bundles and container constraints. API tests use a throwaway MongoDB replica set for permissions, branch isolation, stale-source checks, atomic locks, approval/version checks, exports and SPS linking. Render tests cover setup, blockers, permission-dependent controls and unavailable trends. An isolated browser workflow exercises real API setup, CSV import, drafting, approval, export, linking, reservation release and mobile layout. Production data is not modified by verification.
