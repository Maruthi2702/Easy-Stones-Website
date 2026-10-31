import type { Loose } from '../types/records.ts';
/**
 * Whose visits, resources and follow-ups a person sees and may change, by the
 * REP's branch (owner's call, 2026-10-31): a manager's team is the staff who
 * work at one of the manager's locations, wherever their customers are.
 * Shared by the server (the dashboard routes and the visit/resource edit and
 * delete routes) and the screens (the People filter, Edit/Delete buttons), so
 * what a person is shown and what the server allows can't differ.
 *
 *   viewer's locations   their Users & Roles → assigned locations ('*' = all)
 *   a person's locations their location plus assigned locations; someone
 *                        assigned '*' (an admin, the shared login) is on no
 *                        branch's team — only an all-locations viewer sees them
 *   teammates            everyone working at one of the viewer's locations,
 *                        deactivated people included (their history stays),
 *                        and the viewer themselves
 *
 * A team is `ALL_PEOPLE` ('*', everyone) or a Set of user id strings.
 */
import { visitViewScope } from './visitAccess.ts';

export const ALL_PEOPLE = '*';

const list = (v: unknown) => (Array.isArray(v) ? v : []);
const idOf = (person: Loose | null | undefined) => String(person?.id ?? person?._id ?? '');

/** The viewer's locations: `ALL_PEOPLE` for '*', else their assigned ones. */
export const viewerLocations = (viewer: Loose | null | undefined) => {
  const assigned = list(viewer?.assignedLocations).filter(Boolean);
  return assigned.includes('*') ? ALL_PEOPLE : assigned;
};

/** Where a staff member works: their location and assigned locations, '*' dropped. */
export const workLocationsOf = (person: Loose | null | undefined) =>
  [...new Set([person?.location, ...list(person?.assignedLocations)].filter((l) => l && l !== '*'))];

/** The viewer's teammates (see above): `ALL_PEOPLE` or a Set of ids, always holding the viewer. */
export const teammatesOf = (viewer: Loose | null | undefined, staff: Loose[] = []) => {
  const locations = viewerLocations(viewer);
  if (locations === ALL_PEOPLE) return ALL_PEOPLE;
  const ids = new Set(
    list(staff)
      .filter((p) => workLocationsOf(p).some((l) => locations.includes(l)))
      .map(idOf)
  );
  const me = idOf(viewer);
  if (me) ids.add(me);
  return ids;
};

/** Whether `personId` is in `team`. */
export const inTeam = (team: '*' | ReadonlySet<string> | null | undefined, personId: unknown) =>
  team === ALL_PEOPLE || (Boolean(personId) && team instanceof Set && team.has(String(personId)));

/**
 * Whose work a viewer sees on the dashboard, from their Visits permissions
 * (Users & Roles → Visits): View all → everyone; View branch → their
 * teammates; neither → only themselves.
 */
export const visiblePeople = (viewer: Loose | null | undefined, staff: Loose[] = []) => {
  const scope = visitViewScope(viewer);
  if (scope.kind === 'all') return ALL_PEOPLE;
  if (scope.kind === 'branches') return teammatesOf(viewer, staff);
  const me = idOf(viewer);
  return new Set(me ? [me] : []);
};

/**
 * Narrow `visible` to the dashboard's People and Location filters. Never
 * widens: a rep id outside `visible` is dropped, and an empty result stays
 * empty (it never falls back to everyone).
 *   reps     ids picked in the People filter; empty = everyone visible ("My team")
 *   location only people who work there
 */
export const narrowPeople = (visible: '*' | ReadonlySet<string>, { reps = [], location = '' }: Loose = {}, staff: Loose[] = []) => {
  const picked = list(reps).map(String).filter(Boolean);
  const loc = typeof location === 'string' ? location.trim() : '';
  if (!picked.length && (!loc || loc === '*')) return visible;

  let ids = picked.length
    ? new Set(picked.filter((id) => inTeam(visible, id)))
    : new Set(visible === ALL_PEOPLE ? list(staff).map(idOf) : visible);

  if (loc && loc !== '*') {
    const there = new Set(list(staff).filter((p) => workLocationsOf(p).includes(loc)).map(idOf));
    ids = new Set([...ids].filter((id) => there.has(id)));
  }
  return ids;
};

/** The `reps` query value read from a request (`?reps=a,b`); `me` stands for the viewer. */
export const parseRepsParam = (value: unknown, viewerId: unknown) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === 'me' ? String(viewerId || '') : s))
    .filter(Boolean);

/**
 * The people a viewer is offered in the People filter, from the staff list:
 * everyone visible to them who could have logged something (staff, not
 * website customers). Unsorted; the screen groups them by branch.
 */
export const peopleOptions = (viewer: Loose | null | undefined, staff: Loose[] = []) => {
  const visible = visiblePeople(viewer, staff);
  return list(staff).filter((p) => inTeam(visible, idOf(p)));
};

/**
 * Calendars (2026-10-31): Users & Roles → Visits → "Team calendar"
 * (`view_team_calendar`) shows the calendars of the person's teammates, read
 * only — by the same rep's-branch rule. Without it, only their own.
 */
export const TEAM_CALENDAR = 'view_team_calendar';

export const canSeeTeamCalendar = (viewer: Loose | null | undefined) => list(viewer?.permissions).includes(TEAM_CALENDAR);

/** Whose calendars a viewer may see: ALL_PEOPLE or a Set of ids, always holding the viewer. */
export const calendarPeople = (viewer: Loose | null | undefined, staff: Loose[] = []) => {
  if (canSeeTeamCalendar(viewer)) return teammatesOf(viewer, staff);
  const me = idOf(viewer);
  return new Set(me ? [me] : []);
};
