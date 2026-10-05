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

Every paginated list uses `src/components/shared/Pagination.jsx` with its page
state from `usePagination()` in `src/components/shared/paginationConfig.js`.
Rows per page is always **25 / 50 / 100, default 50** (`ROWS_PER_PAGE_OPTIONS`,
`DEFAULT_ROWS_PER_PAGE`) — the component no longer accepts custom options.
Changing rows per page goes back to page 1; changing a search/filter/sort
calls `resetPage()`. Pass `totalCount` so the bar shows "Showing 1–50 of 312".
The look (numbered pages with "…", Rows select on the right) came from the
Customer List design, which the user preferred over the old "Page n of T" bar.

When adding a list, don't hand-roll a pager or a different size set (the
Customer List had its own until 2026-10-03). Check the server endpoint's
`limit` cap allows 100 before wiring it up. If the page lives elsewhere (e.g.
the URL, like the Customer List's `?p=`), keep your own state but start at
`DEFAULT_ROWS_PER_PAGE` and reset to page 1 on a size change.

## Forms: one template, everywhere

Every form (add/edit modals, Delivery, Visit, Lost Sale, imports, POD,
profile) follows [`FORM_TEMPLATE.md`](FORM_TEMPLATE.md), approved
2026-10-04. It covers sizes S/M/L and phone, field states, the required `*`,
no helper text, validation banner, saving lock, unsaved-changes check, edit
mode, and light/dark colors. It's built in `src/components/shared/form/`
(Add and Edit User, Add / Edit location, Add / Edit visit, and the Selection Sheet are on it); move the others onto it one at a time and
re-check each by hand, since every form with a dropdown is subject to the
CustomSelect incident below.

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
after the incident above, and the customer list's rules
(`src/utils/customerList.js`: status labels, the ⚠ data-quality checks and
the "Incomplete" query that must match them, saved views, A–Z, role-scoped
filter options), the shared pagination sizes/range math
(`src/components/shared/paginationConfig.js`), and the location-filter rules
every screen's location filter shares (`src/utils/locationFilter.js`: home
location, which branch a filter opens on, remembered picks, and the server's
home-location validation), and Add User's rules (`src/utils/userForm.js`:
username suggestion and format, required fields, temporary passwords, the
Locations/home rule, role summaries), and the Selection Sheet's slab-tag
scanner (`src/utils/stoneLabel.js`: reading lot/slab/size/material out of OCR
text, rejecting wrong-rotation garbage, and when a lot may be matched to
stock), and Add / Edit location's rules (`src/utils/locationForm.js`:
required fields and formats, unique short name/code, which locations can be
an RDC, the record ↔ form conversion the API also runs, what non-managers
may read, and the selection-sheet letterhead with its Kent fallback), and
Add / Edit visit's rules (`src/utils/visitForm.js`: the visit types and
their stored values, which fields each type uses, required fields, the
change count, and the "Last changed by" note), and the Selection Sheet's
rules (`src/utils/selectionSheet.js`: rows, the change count behind the
unsaved-changes check, the save body with its stale-save
`expectedUpdatedAt`, which active reps are offered, and the escaped print page).
Nothing else in the app has test coverage — no
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
