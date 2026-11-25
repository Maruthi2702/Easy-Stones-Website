# Director requests

The directors' to-do list, kept as they wrote it (pasted 2026-11-25). Tick an item and add the date and
commit when it's fixed. Bugs found but not fixed live in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md), not here.

## Requests

- [ ] Host credentials to create the Mobile App.
- [ ] Define visit-days categories with Sree: different customer levels get different visit alerts (Key or Level 1 monthly, Level 2 every two months, etc.).
- [ ] Finalize the name: Surface Street, Easy Street or alike (Sree).
- [x] Sales Dash: add each sales rep's monthly and annual sales and goals. — built 2026-11-25 on `feat/sales-goals` (Dashboard → Visits → Goals); not deployed: needs `npm run pg:migrate -- --apply` for 0037 and the Team goals / Set goals switches (admin and director have them). Details in CLAUDE.md "Sales goals".
- [x] Sales Dash: leave a placeholder for a weekly visit goal. — a "Weekly visits · Goal not set" column in the Goals table (2026-11-25); the goal itself is not built.
- [ ] Change Construct Data to **Multifamily Leads**: potential visits by owner, designer, etc., with the project referenced in the lead's profile.
- [ ] Side list when a lasso or radius is drawn (the leads / prospects inside it).
- [ ] Collection notes: notify the credit manager, the same way a note alerts the branch manager.
- [ ] A sales rep can make a contact inactive for the first three months; after that it needs branch approval or a manager change.
- [x] Change "Route Planner" to **"Map"** — done 2026-11-25, `83d49f80` (the name on the nav, Users & Roles and the screen's messages; internal ids, permission and URLs unchanged). "With route planning function": the screen already plans routes (Schedule panel, Optimize route), nothing new built.
- [ ] Salesperson filter on the map: allow the full branch view as well as one specific salesperson's view.
- [ ] Consider outstanding balance and a collections map view for a future version.
- [ ] Sales file: internal and external resources library, cross-referenced to pricing etc., possibly branch-specific.
- [ ] Check the map's integrity: after highlighting a specific lead, it returns to the same map view.

## Feedback (nothing to build)

- The directors like the tracking function: miles and location from the logged customer (the visit location stamp).

## Decisions (2026-11-25)

- Sales goals by month: a rep sees only their own sales, goals and monthly goals, never a teammate's or the team total (those cells show a lock). A director sees their team's. Design: claude.ai artifact **Sales Dash — Rep Sales & Goals** (https://claude.ai/artifact/KZhMwDU6dzH8pgtGhCs66X), Viewer switch in its tweaks.
