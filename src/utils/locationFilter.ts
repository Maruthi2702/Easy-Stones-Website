/**
 * The rules every location filter in the app shares: which branch a person
 * calls home, which branch a filter opens on, and what a remembered choice
 * still means once someone's access has changed.
 *
 * A person's home location is User.location — the branch new records default
 * to and, from here, the branch every location filter opens on. It is set by
 * an admin in Users & Roles and must be one of the person's assignedLocations
 * (any branch, for someone assigned '*'). Which branches a screen *offers* is
 * still that screen's own call — Visits by visit permissions, Inventory every
 * branch, most others assignedLocations — these rules only pick among them.
 *
 * Pure and DOM-free, so the server can validate with the same rules the
 * filters read by; tested in locationFilter.test.js.
 */

/** The value a single-choice filter holds for "All locations". */
export const ALL_LOCATIONS = '';

type LocationUser = { assignedLocations?: readonly string[]; location?: string; [key: string]: unknown } | null | undefined;

const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

/** Branch names from a list of names or Location documents, blanks and repeats dropped. */
export const locationNames = (list: unknown = []) => [
  ...new Set(
    (Array.isArray(list) ? list : [])
      .map(l => (l && typeof l === 'object' ? clean(l.name || l.locationName) : clean(l)))
      .filter(l => l && l !== '*')
  )
];

const assignedOf = (user: LocationUser) => (Array.isArray(user?.assignedLocations) ? user.assignedLocations : []);

/** Whether someone is assigned every branch ('*'). */
export const hasAllLocations = (user: LocationUser) => assignedOf(user).includes('*');

/**
 * The branches someone may filter by on a screen scoped to assignedLocations:
 * every branch in `allLocations` for '*', otherwise the ones they're assigned.
 * Keeps `allLocations`' order.
 */
export const accessibleLocations = (user: LocationUser, allLocations: unknown = []) => {
  const names = locationNames(allLocations);
  if (hasAllLocations(user)) return names;
  const assigned = new Set(assignedOf(user));
  return names.filter(n => assigned.has(n));
};

/**
 * Someone's home location, or '' when none is set — or the one stored is no
 * longer theirs to hold (removed from their assignedLocations, or the old
 * '*' the Users & Roles form used to write here for an all-locations user).
 */
export const homeLocationOf = (user: LocationUser) => {
  const loc = clean(user?.location);
  if (!loc || loc === '*') return '';
  return hasAllLocations(user) || assignedOf(user).includes(loc) ? loc : '';
};

/**
 * Where a single-choice filter opens: the home location when the filter
 * offers it, otherwise All. A filter with fewer than two options is hidden,
 * and its value stays All — which already means that one branch.
 */
export const defaultLocationFor = (user: LocationUser, options: unknown = []) => {
  const names = locationNames(options);
  if (names.length < 2) return ALL_LOCATIONS;
  const home = homeLocationOf(user);
  return names.includes(home) ? home : ALL_LOCATIONS;
};

/** Where a multi-choice filter opens: just the home location, or nothing ticked (all). */
export const defaultLocationsFor = (user: LocationUser, options: unknown = []) => {
  const home = defaultLocationFor(user, options);
  return home ? [home] : [];
};

/**
 * A choice remembered from earlier in the session, if it still makes sense
 * against today's options; null means "fall back to the default". All is
 * always still valid while there is a choice to make at all.
 */
export const resolveStoredLocation = (stored: unknown, options: unknown = []) => {
  if (typeof stored !== 'string') return null;
  const names = locationNames(options);
  if (names.length < 2) return null;
  if (stored === ALL_LOCATIONS) return ALL_LOCATIONS;
  return names.includes(stored) ? stored : null;
};

/** resolveStoredLocation for a multi-choice filter: [] is All; anything no longer offered is dropped. */
export const resolveStoredLocations = (stored: unknown, options: unknown = []) => {
  if (!Array.isArray(stored)) return null;
  const names = locationNames(options);
  if (names.length < 2) return null;
  if (stored.length === 0) return [];
  const kept = stored.filter(s => names.includes(s));
  return kept.length ? kept : null;
};

/**
 * Why `location` can't be someone's home location, or null if it can. Blank
 * is allowed — it means no home, and every filter opens on All as before.
 * `knownLocations` is every branch that exists, checked for '*' users.
 */
export const homeLocationProblem = (location: unknown, assignedLocations: unknown = [], knownLocations: unknown = []) => {
  const loc = clean(location);
  if (!loc) return null;
  if (loc === '*') return 'Home location must be one branch, not All Locations.';
  const assigned = Array.isArray(assignedLocations) ? assignedLocations : [];
  if (assigned.includes('*')) {
    return locationNames(knownLocations).includes(loc) ? null : `"${loc}" is not a location.`;
  }
  return assigned.includes(loc) ? null : `Home location "${loc}" must be one of this user's assigned locations.`;
};

/** The home location to fall back to when the current one stops being valid: the first assigned branch. */
export const fallbackHomeLocation = (assignedLocations: unknown = []) =>
  (Array.isArray(assignedLocations) ? assignedLocations : []).map(clean).find(l => l && l !== '*') || '';

/*
 * How every location dropdown lists its branches (owner's call, 2026-10-17):
 * the home location first, then every other one A–Z, with a search box once
 * there are LOCATION_SEARCH_FROM or more to choose from. The dropdown itself
 * is src/components/shared/form/LocationPicker.jsx; the checkbox lists
 * (Inventory, Users' Locations, the Customer List filter) use the same order.
 */

/** From this many choices a location dropdown gets a search box. */
export const LOCATION_SEARCH_FROM = 8;

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** Branch names A–Z (case ignored), with `home` moved to the front when it's one of them. */
export const orderLocations = (list: unknown = [], home = '') => {
  const names = locationNames(list).sort(byName);
  const h = clean(home);
  return h && names.includes(h) ? [h, ...names.filter(n => n !== h)] : names;
};

/** The names containing what was typed (case ignored), in the order given; all of them for a blank search. */
export const matchLocations = (names: string[] = [], query = '') => {
  const q = clean(query).toLowerCase();
  return q ? names.filter(n => n.toLowerCase().includes(q)) : names;
};
