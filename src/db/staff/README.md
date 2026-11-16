# Staff data layer: Users, Roles, Locations

`index.ts` is the only thing routes call. It picks MongoDB or Postgres by `DB_STAFF` (unset = MongoDB), so a
deploy with no setting changes nothing. Postgres answers in **MongoDB's shape** (`_id`, `password`, `location`,
`assignedLocations` with `'*'`, nested location contacts), so screens never learn which database answered.

| Call | What it is |
|---|---|
| `authIdentity(id)` | what `authenticate` reads on every request: named fields + the role's permissions, one query |
| `findUsers / findUser / userById / userExists / countUsers` | plain reads; `{ select, sort, session }` as in Mongoose |
| `userDoc / userDocById / newUserDoc` | an account you will change: set fields, `await save()`; `isLocked()`, `comparePassword()`, `incLoginAttempts()`, `resetLoginAttempts()` as the model had |
| `updateUser / updateUserById / findUserAndUpdate` | MongoDB's `updateOne` / `findOneAndUpdate` (`$set`, `$unset`, `$inc`, dotted paths) |
| `deleteUser`, `touchLastSeen` | |
| `findRoles / findRole / roleExists / roleDocFor / roleDocsFor / roleDocById / newRoleDoc / deleteRole` | the same for roles |
| `locationsList / locationById / locationByName(AnyCase) / locationNames / locationBriefs / createLocation / updateLocation / deleteLocation / setDeliveryColumns` | locations |
| `userReads` | the read-only slice the freight sync takes by injection |

## How the Postgres side behaves like Mongoose

- **Filters, select, sort and updates run in memory** on the whole list (a few dozen rows): `mongoQuery.ts` (`sift`,
  tested). `username` / `email` in a filter are trimmed and lower-cased, a role's `name` too, as the model's setters did.
- **`save()` writes only what changed** since the read (a deep snapshot), so a login attempt counted while an edit
  form was open isn't overwritten; it hashes a changed `password` (bcrypt, cost 10) and applies the same trimming.
  A taken username comes back as MongoDB's duplicate-key error (`code: 11000`) so the routes' existing catch works.
- **Every write takes one transaction lock** (`staff_users` / `staff_roles`), so a read-then-write can't interleave.
- **The wrong-password counter is one statement** (`incLoginAttempts`): five wrong passwords lock 15 minutes, an
  expired lock restarts the count at 1 — the model's rule.
- Rows are built by the copy's own builder (`referenceRows`), so a Postgres save writes what a re-copy would.
- A new account / role / location gets its id from the layer (`newId()`), the same on both databases.

## Known differences from MongoDB

- **Assigned locations come back A–Z** (`user_locations` keeps no order); MongoDB kept the ticked order.
- **A location name that isn't a location is dropped** from a person's assigned list and from a branch's
  report recipients (as the copy does). MongoDB kept it.
- **Deleting** a user, role or location something still points at (a delivery's driver, a person's role) is refused by
  Postgres (a foreign key) and surfaces as the route's "Failed to delete…". MongoDB let it through and left a dangling name.
- `_id` is a 24-character string, not an ObjectId (the routes already wrapped it in `String()`).
- Not on the layer, on purpose: the start-up location seed and the Seattle recipients seed (MongoDB only; no-ops once
  locations exist) and `src/db/customers/*.mongo.ts` (their MongoDB path). **`DB_STAFF=postgres` needs `DB_CUSTOMERS=postgres`** — customers
  already are.

## Cutover (owner's go-ahead only — after next week's new users are added)

The scoped copy used by other areas TRUNCATEs, which is impossible here (every table points at users / locations / roles).
The staff scope is an **in-place sync** (`syncStaffFromMongo` → `syncReference`), the same code that has kept Postgres
current all along.

1. `STAFF_WRITES_PAUSED=true` on Render (`/api/health` → `staffWritesPaused`). Users, roles, locations, passwords and
   own pins / filters / calendar links answer 503; sign-in still works (its counters are ignored by the check).
2. `node scripts/pg-copy-aws.ts --scope staff --write` then `--verify --scope staff` → must say equal.
3. `DB_STAFF=postgres` on Render, pause off. `/api/health` → `staffOn: postgres`. From then the running reference sync
   only follows the visit / resource type lists (`syncReference(..., { staff: false })`).
4. Click-through (owner): sign in, five wrong passwords lock, Users & Roles add / edit / deactivate / unlock, a temporary
   password and an invite link, Roles, Locations add / edit, a hold at a branch added after the copy.
5. `node scripts/pg-copy-aws.ts --lock "name" --scope staff` — the staff sync refuses from now on.
6. MongoDB `users`, `roles`, `locations` kept read-only two weeks, then removed. **Rollback after step 3 loses what was
   written on Postgres** (no reverse sync for staff yet) — decide before step 3 whether that is acceptable.

Tests: `staff.parity.test.ts` (locations, identity, roles), `people.parity.test.ts` (users, sign-in counting, roles),
`mongoQuery.test.ts`, `src/db/reference/referenceSync.test.ts` (the staff cutover), `src/utils/staffWritesPause.test.ts`.
Each parity test must flip its **own** switch — `openWriteParity(seed, 'DB_STAFF')`; the default flips `DB_CUSTOMERS`
and a staff test would silently compare MongoDB with itself.
