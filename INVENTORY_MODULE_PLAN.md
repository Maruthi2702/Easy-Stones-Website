# Inventory module correction and TypeScript plan

Approved direction: October 25, 2026. Fix the reviewed issues in order, migrate
inventory-related code to TypeScript as each area is corrected, and preserve
existing UX. React components use `.tsx`; server, models, rules and tests use
`.ts` because Node cannot execute `.tsx`.

## Delivery rules

- One correction at a time, with regression evidence before proceeding.
- Keep existing tabs, routes, field order, DOM/CSS and permission boundaries.
- Reuse the shared forms, calendars, locations, pagination and theme tokens.
- Split code by responsibility under `features/inventory` as screens are moved;
  keep one public module surface and typed API contracts.
- Each step: strict typecheck, server import check, relevant rule/API/render
  tests, production build, and an explicit statement of any UI verification gap.
- Tests use disposable databases. No production record repair is implicit.

## Ordered corrective work

| Step | Correction | TypeScript work | UX impact | Status |
|---|---|---|---|---|
| 1 | Atomic stock replacement, concurrent import protection, retained recovery snapshot and import metadata | Stock model, import service, history/backup models and tests | None: existing upload/preview/apply flow | Complete |
| 2 | One consistent availability rule for SPS commitments, cart, holds and purchasing | Availability rules and slab list `.tsx`; update shared callers | Existing checkboxes disabled when unavailable; reuse reasons | Queued |
| 3 | Reject invalid quantities/dates and missing planning fields; distinguish unknown from zero | Typed stock/sales parse results and validation | Existing preview/error banner; clearer row-level messages | Queued |
| 4 | Reconcile complete transit snapshots versus partial updates; preserve receipt/closure history | Typed transit snapshot/reconciliation services and models | A complete/partial choice and reconciliation summary are needed | Queued |
| 5 | One demand/coverage calculation for velocity and purchasing; include sold-out variants and keep UOM separate | Shared demand types/rules; migrate legacy planning glue | Same tables; corrected quantities, dates and empty states | Queued |
| 6 | Explicit reported ETA versus confirmed usable receipt confidence | Typed supply policy/reconciliation | Small confidence indicator in existing shipment details | Queued |
| 7 | Reach all slab records beyond the first 200 | Typed slab data hook and `.tsx` list | Reuse shared pagination/load flow inside slab detail | Queued |
| 8 | Reliable retry, freshness, reconnect and obsolete-request handling; lock imports during apply | Typed inventory data hooks/API; remaining inventory helpers | Reuse existing banners/spinners; no new navigation | Partial: tab-return caching complete |
| 9 | Finish module boundaries, typed contracts, unit labels and approved visual tokens | Remaining inventory/purchasing `.js/.jsx` to `.ts/.tsx` | Palette/control consistency; preserve layout | Queued |

## Step 1 design

Retain `InventoryItems` as the current stock collection so existing consumers
keep their API. A transaction serializes publication through one state record,
archives the old stock in bounded backup chunks, replaces the collection, and
records the completed import. A failure aborts the entire operation. There is
no delete-by-other-import-timestamp cleanup. The previous snapshot is retained
for seven days; lightweight import metadata remains for the audit trail.

This requires a MongoDB replica set, already required by Accounting and Holds.
Check that limitation in the import service and fail without touching stock if
transactions are unavailable. Import preview and the visible upload workflow
stay the same. History/rollback controls are not added to the UI in this step.

## Enhancements after correctness

1. Consolidate source status, product-level information and exception links
   within the current inventory screens.
2. Add source-aware upload history, changes and recovery controls.
3. Add receipt reconciliation, arriving/overdue views and transfer review.
4. Add explanations, buyer exports and history-supported analytics.

A consolidated upload center, redesigned product drawer or tab consolidation
would change UX. Present a concrete design and identify those changes before
implementing them; they are not bundled into the corrective passes above.

## Step 1 validation

Implemented atomic publication and retained recovery snapshots. Regression
coverage verifies old-stock visibility during a multi-batch upload, rollback
after a later batch fails, concurrent imports, transaction retries, exact
backup contents, cached preview/apply compatibility, and safe failure without
transaction support. All 153 relevant tests passed across 14 files. Strict TypeScript and server
import checks passed, and the production build passed. Existing repository
warnings about admin script imports, browser data and large build chunks remain.
The existing upload controls and CSS are unchanged; no browser UI validation
was needed for this backend-only correction.

The new stock model, publication service and supporting models/tests are
TypeScript. Remaining `.js/.jsx` files are explicitly queued above; this is
not a completed migration of the entire module.

## Purchasing tab-return correction

Prioritized at the user's request: Purchasing was unmounted on tab changes
and restarted metadata, plan, drafts and inbound requests each time. Its hook
now restores recent typed results and the selected scope from session memory.
Answers expire after 30 seconds; returning does not extend their freshness.
Explicit Refresh and purchasing saves invalidate them. Inventory import and
auth changes use the existing inventory-cache invalidation boundary. No new
storage, layout or controls are introduced. The rest of step 8 remains queued.

Validation: 16 purchasing UI/CSV tests, including remount request counts,
selected scope, expiry, refresh, import invalidation and auth isolation.

## Purchasing architecture

See [the proposed Purchasing architecture](docs/purchasing-architecture.md)
for ownership boundaries, supply reconciliation, planning stages, cache and
command consistency, TypeScript layout and the migration sequence. This design
does not mark queued corrective steps implemented or authorize a UI redesign.
