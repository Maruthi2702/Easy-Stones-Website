/**
 * Locations nobody picks from (2026-11-26): the "Demo" location holds the invented customers the App Store review login
 * (`app.review`) works with, so Apple's reviewer never sees a real customer. It must not turn up in anyone else's location
 * dropdown, filter or per-location screen, and it must not count as a branch (a login assigned every real branch is still
 * "company-wide", `src/fuelman/access.ts`). `staffData.locationsList / locationNames` leave hidden locations out; only a login
 * assigned to one is sent it (`GET /api/admin/locations`). The seed script is `scripts/seed-app-review-demo.ts`.
 *
 * The rule lives here so the server and the tests read one list; the name is what records store, never renamed.
 */
export const HIDDEN_LOCATIONS: readonly string[] = ['Demo'];

const key = (name: unknown) => String(name ?? '').trim().toLowerCase();

/** Whether a location (by its stored short name) is one nobody picks from. */
export const isHiddenLocation = (name: unknown): boolean => HIDDEN_LOCATIONS.some((h) => key(h) === key(name));

/** A location record or a name, left in the list only when it isn't hidden. */
export const withoutHiddenLocations = <T extends string | { name?: unknown }>(list: readonly T[]): T[] =>
  list.filter((l) => !isHiddenLocation(typeof l === 'string' ? l : l?.name));

/** A login sees a hidden location only when it is assigned to it by name (never through "All locations"). */
export const canSeeHiddenLocations = (user: { assignedLocations?: unknown } | null | undefined): boolean => {
  const assigned = Array.isArray(user?.assignedLocations) ? user!.assignedLocations.map(key) : [];
  return HIDDEN_LOCATIONS.some((h) => assigned.includes(key(h)));
};
