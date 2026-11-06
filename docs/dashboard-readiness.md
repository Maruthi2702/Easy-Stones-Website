# Dashboard readiness — November 5, 2026

The dashboard's multi-location and multi-rep workflows were tested against an
isolated copy of the real server and database, component tests, and desktop and
Pixel 7 browser scenarios. The issues below were reproduced and fixed locally.
Deployment of these changes is still required.

Validation completed:

- 297 relevant automated tests passed across 28 suites, including 14 real-server
  integration cases. The expanded server case was also rerun with a separate
  sales rep account making the changes: all 14 passed.
- 12 browser checks passed across desktop Chromium and Pixel 7 Chromium.
- Repository type checking and lint checks for every changed code file passed.
- Tests were run separately with two workers after an overloaded combined run
  timed out. No test timeout was increased. The existing aged-customer-cache
  browser assertion now permits development Strict Mode's duplicate effect
  reconnect while still checking quiet refresh and preserved state.

## Access model checked

Location means **where the rep works**, using their home and assigned locations.
It does not mean the customer's location. Test customers deliberately belonged
to different branches from the staff who logged their work.

| Viewer | Expected visibility |
| --- | --- |
| Own-only rep | Their own work; no People or Location selector |
| Seattle manager | Their Seattle team, including historical work by inactive reps |
| Seattle + Dallas manager | The combined teams at those two locations |
| Branch viewer assigned `*` | Every location's team |
| User with `view_all_visits` | Everyone, narrowed by People and Location selections |
| Anonymous, website customer, inactive account, or role without `view_dashboard` | Refused by all five dashboard read endpoints |

An all-locations account stays outside a branch manager's team, even when its
home location is that manager's branch. A rep assigned to two branches appears
under either branch's filter; totals count their entries once in a combined view.

## Coverage

- Real HTTP authentication and database-backed role permissions; all five read
  endpoints: stats, visits, resources, follow-ups, and the follow-up panel.
- Three locations and nine staff accounts, including single-branch and
  multi-branch managers, a rep working across branches, inactive staff history,
  and all-locations accounts.
- Visit/resource/follow-up totals agree with the allowed people; mixed string
  and ObjectId author fields and legacy resource creator attribution are covered.
- Forged rep/location filters cannot widen access. Empty intersections stay
  empty. A staff branch reassignment applies on the next request.
- All-time and custom date ranges retain the same access restrictions.
- Twelve simultaneous read requests from four different viewers remain isolated.
- Team calendar reads follow branch/rep access; selecting another rep's calendar
  without permission yields no extra access. Existing schedule tests cover
  refusing edits to another person's entries.
- Real Socket.IO broadcasts accompany visit creation, editing, follow-up
  completion, and deletion.
- Client filters reset pagination, share scope across dashboard requests, ignore
  stale responses, and refresh totals after a permission change.
- Admin, multi-location manager, and own-only rep workflows run on desktop and
  phone. Checks include By rep totals and drilldown, shared scope on Resources
  and Follow-ups, and a live update arriving while a rep filter remains selected.
- Existing request-failure/retry, My team checkbox, and Customers navigation
  regressions are included in validation.

## Issues corrected

1. Visit creation broadcast `visit_updated`, which the dashboard did not follow;
   edits, follow-up changes, and deletes did not broadcast its refresh event.
   All four writes now announce `customer_update` after saving.
2. The Sales shell refreshed its customer directory on that event while leaving
   the dashboard's independent lists and totals stale. It now refreshes both;
   customer lists retain their existing event-based refresh.
3. Team calendar counts ignored another rep's schedule updates and could call a
   function holding old filters. Live refresh now reads the current callback and
   includes team updates when permitted.
4. Reconnecting refreshed check-ins alone. Dashboard work and customer dropdowns
   now resync too, recovering changes missed while disconnected or backgrounded.
5. Resource responses dropped a legacy `createdBy` author when `uploadedBy` was
   absent. The returned author now follows the same fallback used by access rules.
6. Access changes with unchanged filter URLs could retain old totals. Dashboard
   reads now also depend on the viewer's identity, permissions, and assignments.
7. The team calendar ignored Location while People was Me. That selection now
   sends the same location/rep intersection to the server.
8. The Calendar tile counted cancelled stops. Its count now excludes them, as
   the By rep table already did.

## Scope of the readiness conclusion

These are functional and access-control checks using synthetic data. They do
not measure production database capacity, large historical datasets, many open
sessions, slow cross-region networks, or third-party calendar synchronization.
The browser cases use deterministic API/socket fixtures; the separate server
suite exercises real authentication, MongoDB aggregations, and Socket.IO.
Production data and external services were not used.

The new checks live in:

- `src/server/dashboard.integration.test.ts`
- `src/features/dashboard/dashboardScope.test.tsx`
- `src/features/salesShell/salesShell.test.tsx`
- `e2e/dashboard.multi-location.spec.ts`
