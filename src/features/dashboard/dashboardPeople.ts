/**
 * The Sales dashboard's People filter (2026-10-31): whose visits, resources
 * and follow-ups the page shows, for anyone allowed to see more than their own
 * (src/utils/teamScope.ts — by the rep's branch). The value is a list of user
 * ids: [] is "My team" (everyone the viewer can see), [their own id] is "Me"
 * — what the page opens on (owner's call) — and anything else is the reps
 * picked. The server narrows by the same list (?reps=) and never widens it.
 */

/** "My team": everyone the viewer can see. */
export const MY_TEAM: string[] = [];

/** What the page opens on: just the viewer. */
export const peopleDefault = (me: string): string[] => (me ? [me] : MY_TEAM);

/** The query string piece for the dashboard routes; '' for My team. */
export const repsParam = (people: string[]): string =>
    (people.length ? `&reps=${encodeURIComponent(people.join(','))}` : '');

/** Whether the value is just the viewer. */
export const isJustMe = (people: string[], me: string): boolean =>
    people.length === 1 && Boolean(me) && people[0] === me;

/** Whether rows should say who logged them: more than the viewer is in view. */
export const showsWhoLogged = (people: string[], me: string): boolean => !isJustMe(people, me);

/** Whether a visit logged by `authorId` belongs in the list for `people`. */
export const includesPerson = (people: string[], authorId: string): boolean =>
    people.length === 0 || people.includes(String(authorId));

/** Who is in view, in words: "Me", "My team", a name, or "3 people". */
export const peopleSummary = (people: string[], me: string, nameOf: (id: string) => string | undefined): string => {
    if (people.length === 0) return 'My team';
    if (isJustMe(people, me)) return 'Me';
    if (people.length === 1) return nameOf(people[0]) || '1 person';
    return `${people.length} people`;
};

/**
 * Tick or untick one person. Unticking the last one goes back to the viewer
 * (never to an empty list, which would read as My team).
 */
export const togglePerson = (people: string[], id: string, me: string): string[] => {
    const next = people.includes(id) ? people.filter((p) => p !== id) : [...people, id];
    return next.length ? next : peopleDefault(me);
};

/** A remembered value read back: a list of id strings, else null. */
export const parseStoredPeople = (raw: string | null): string[] | null => {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;
    } catch {
        return null;
    }
};
