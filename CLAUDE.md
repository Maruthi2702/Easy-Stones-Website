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

## No automated test suite exists yet

There is no `test` script in `package.json` and no test runner installed.
Verification currently means running the app (`npm run dev` / `npm start`)
and exercising the actual screen by hand, or, when real login credentials
aren't available in the current environment, reproducing the specific DOM/CSS
mechanism in isolation (see how the CustomSelect fix above was verified).
Flag this gap to the user if a change is high-risk enough to want real
regression coverage — don't assume "it builds" or "lint passes" means the
feature works.
