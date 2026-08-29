# Easy Stones Website

Live app with real users (sales/delivery/admin staff). Regressions in shared
components silently break screens far from the one being worked on — this
file exists to stop that class of bug from recurring.

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
`applyDerived` in `src/routes/dailyReports.js`) until a person hand-corrects
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
values, not the draft's placeholder-stripped ones. See
`buildSaveBody`/`buildDraftPayload` in
`src/components/sales/dailyreport/savePayload.js` and their tests for the
fix, and `applyDerived`'s tests in `src/routes/dailyReports.test.js` for the
merge contract those payloads have to be correct against.

## Automated tests are narrow — most verification is still manual

`npm test` runs Vitest (`vite.config.js`'s `test` block, `src/**/*.test.js`).
As of 2026-08-28 that covers the pure, no-DOM business logic in
`src/utils/routePlan.js` and `src/components/sales/routePlannerV2/helpers.js`
(great-circle distance, point-in-polygon, stop ordering/scheduling math,
recency bucketing, small formatting/localStorage helpers), plus the Daily
Work Report's derive/save-payload rules (`src/routes/dailyReports.js`'s
`applyDerived`, `src/components/sales/dailyreport/savePayload.js`) added
after the incident above. Nothing else in the app has test coverage — no
rendered components, no other routes, no other server.js endpoints.

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
