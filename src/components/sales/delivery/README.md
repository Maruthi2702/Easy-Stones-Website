# Delivery Schedule — architecture map

This is the file most worth reading first if you're debugging or extending
the Delivery Schedule feature and don't already know where things live. It's
one feature spread across a backend router, a client-side cache/socket
layer, and this directory of UI components — the map below is what actually
talks to what, not just a file listing.

## The shape of the feature

```
Browser                                    Server
────────────────────────────────────────   ──────────────────────────────────
DeliveryScheduleTab.jsx  (page shell,       src/routes/deliveries.js
  role switch, week nav, location filter)     (every /api/deliveries and
        │                                      /api/trucks route)
        ├─ BoardGrid.jsx      (office/sales          │
        │   board: truck columns × days)             │ location-scoped
        ├─ DriverView.jsx     (driver's own           │ reads/writes,
        │   stops, mobile-first)                      │ Socket.IO room
        ├─ PendingDeliveries.jsx (no driver/date       │ broadcasts
        │   assigned yet)                             │
        ├─ DeliveryForm.jsx   (the one add/edit        │
        │   form — jobsite, transfer, will call,       ▼
        │   return, drop-off; rules in          src/models/Delivery.js
        │   utils/deliveryForm.js)
        ├─ PodModal.jsx / PodViewer.jsx          src/models/Truck.js
        │   (capture / view proof of delivery)
        └─ TicketChip.jsx → StatusPill.jsx,
            EpodChip.jsx  (the card itself)

        all of the above read/write through

src/api/deliverySchedule.js
  (the ONLY place that calls the delivery API — see "Data flow" below)
```

Pure logic with no DOM/network dependency lives in `src/utils/`:
`deliveryTypes.js` (what counts as pending/a return/a drop-off — has
`.test.js`), `deliveryWeek.js` (which dates a week shows — has `.test.js`),
`deliveryPickup.js` (pickup vs. delivery wording, third-party-truck
detection — no test file yet, low risk since it's pure string/config logic),
`deliverySearch.js` (order search — has `.test.js`, see below).

## Order search (SO# / company, every date)

`DeliveryOrderSearch.jsx` is the "Search SO# or company…" box in the header,
for every role except drivers. It does two jobs with one piece of text: the
board, Pending and Cancelled keep filtering what's already loaded (as the
old sales-only box did), and a dropdown searches **every date** via
`GET /api/deliveries/search?q=` so someone can see when an order was
delivered or when it's booked. Picking a result jumps the board to that
week (widening a one-branch filter if needed); the office also gets the
ticket opened, sales gets the Pending/Cancelled list scrolled into view.

The rules — who may search, what matches, the branch scope, the result
wording — live in `src/utils/deliverySearch.js`, shared by the route and the
box. Two deliberate differences from the board:
- **Drivers are refused** server-side — anyone whose role has Users &
  Roles → Delivery Schedule → **Driver view** (`isDeliveryDriver`,
  `src/utils/deliveryAccess.js`) — not just hidden in the UI.
- **Only the user's own `assignedLocations`** (plus transfers heading to
  them). The board's `scopeDeliveryQueryToLocations` also shows tickets with
  no location at all; search does not. Admins/directors (`'*'`) see every
  branch.

## Data flow — read this before changing either side

**`src/api/deliverySchedule.js` is the only file that calls the delivery API.**
Every component above gets its data by calling exported functions from it
(`saveDelivery`, `deleteDelivery`, `getScheduleDataCached`, etc.) — none of
them call `fetch`/`authFetch` against `/api/deliveries` directly. If you're
adding a new field or a new action, the new API call belongs in
`deliverySchedule.js`, not inline in a component.

`deliverySchedule.js` also owns a **module-level, singleton, shared cache**
(`scheduleCache` — deliveries by week, trucks, pending) and the one
Socket.IO connection this feature uses. Every component that renders
delivery data is really just a view over that one cache, kept in sync via
`subscribeScheduleCache`. This matters for two things:

1. **The default "All Locations" view is the cache. Anything else is not.**
   `DeliveryScheduleTab.jsx`'s location filter deliberately does NOT touch
   `scheduleCache` when a specific branch is selected — see
   `getLocationScopedScheduleData` in `deliverySchedule.js` for why (so switching
   the filter on and off can never leave the shared cache — which every
   other consumer of this data relies on — in a filtered state). The All
   Locations view is the live-updating cache. A narrowed view — which is
   what a multi-location user now opens on, their home location from Users &
   Roles — stays live a different way: it subscribes to
   `subscribeScheduleChanges` (told "something changed" on every socket
   update, reconnect and fallback poll, with no data) and refetches its one
   branch through `getLocationScopedScheduleData`, so the server's location
   rules decide what it shows every time. Its saves/moves refetch too
   (`applyUpdatedList` in `DeliveryScheduleTab.jsx`), because the mutation
   helpers return the shared cache's week, not the narrowed one.

2. **The socket only pushes updates to rooms a client has actually joined.**
   `deliverySchedule.js`'s `initScheduleSocket()` connects, then emits
   `join_delivery_rooms` with the current auth token on every `connect`
   event (including reconnects). The **server** (`server.js`'s
   `io.on('connection', ...)` handler) verifies that token and joins the
   socket to a room per the user's `assignedLocations` — see
   `deliveryRoomFor`/`DELIVERY_ROOM_ALL`, exported from
   `src/routes/deliveries.js` specifically so the join side and the emit
   side (`emitDeliveryUpdate`, same file) can't drift apart on the room
   naming scheme. A socket that never sends `join_delivery_rooms` (or whose
   token fails) simply receives no `delivery_update` events — it isn't
   disconnected, since other unrelated channels on the same socket
   (`crossover_sheet_update`, etc.) aren't scoped this way and still need it
   to work.

## Backend: `src/routes/deliveries.js`

Every `/api/deliveries*` and `/api/trucks` route, plus every delivery/POD
helper (Cloudinary storage, signature stamping, certificate wording) — all
previously inline in `server.js`, extracted here for the same reason
`src/routes/dailyReports.js` was: a self-contained feature, and `server.js`
is thousands of lines covering a dozen unrelated ones. Generic, cross-feature
helpers (`getPerformerInfo`, `processBase64Images`, `getNowLocalISO`) are
handed in as dependencies rather than imported, since other features that
also live in `server.js` share them — see that file's own top-of-file
comment for the exact contract.

**Permission model**, since it's easy to get backwards:
- `view_delivery_schedule` — read-only, held by all six staff roles.
- `edit_delivery_schedule` — the real "can dispatch" permission.
- `delivery_driver_view` — "Driver view": the user gets the driver screen
  (only their own stops) and no order search. Which screen anyone gets —
  driver, office board or read-only board — comes from these permissions
  alone (`deliveryViewMode`, `src/utils/deliveryAccess.js`, Driver view →
  Edit → View), never from the role's name.
- `delete_delivery_schedule` — separate again; admin/director/manager only
  by default.
- A driver's app calls exactly two write routes — `POST /api/deliveries`
  (for POD capture, sharing the general upsert endpoint) and
  `PATCH /:id/status` — and both accept `view_delivery_schedule` alone,
  since a driver never holds `edit_delivery_schedule`. Every other write
  (reassign, reorder, packing-list upload) requires `edit_delivery_schedule`
  outright. If you add a new write route, decide deliberately which side of
  that line it's on — don't default to the permissive check just because a
  neighboring route uses it.

**Location scoping**, the other thing worth understanding before touching
this file: `scopeDeliveryQueryToLocations` is the one function every read
(and, via `userCanAccessDeliveryLocation`, every write) filters through. A
transfer is visible/writable from *both* the shipping branch (`location`)
and the receiving branch (`transferDestination`) — if you add a new
delivery type or a new branch-like field, check whether it needs the same
two-sided treatment.

## If something's broken, start here

- **A delivery isn't showing up on the board**: check `isPendingDelivery`
  and the week-range query's `$or` in `deliveryTypes.js`/`deliveries.js` —
  every ticket is supposed to land in exactly one of (a given week) or
  (Pending), never neither, never both. The test file for
  `isPendingDelivery` asserts this; if a new delivery type or flag combo
  breaks that invariant, that's the first place to look.
- **Real-time updates aren't arriving**: check whether the socket actually
  called `join_delivery_rooms` (client) and whether the server accepted the
  token and joined a room (server, `io.on('connection')` in `server.js`) —
  a silently-expired token means the socket connects fine but never joins a
  room, so it looks "connected" while receiving nothing.
- **Someone can/can't see another branch's data**: the fix is almost always
  in `scopeDeliveryQueryToLocations` or `userCanAccessDeliveryLocation` in
  `src/routes/deliveries.js` — both are deliberately kept in sync with each
  other (query-shaped vs. boolean-shaped versions of the same rule) and
  documented as such where they're defined.
- **A field you added isn't saving**: `Delivery.js`'s schema has
  `strict: false` — an undeclared field still saves silently instead of
  erroring, so check the schema's field list itself before assuming the
  save path is broken.
