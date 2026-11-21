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

/** A branch heading in the People list and who sits under it. */
export type PeopleBranch = { name: string; ids: string[] };

/** The People list's branch headings, from the options the viewer may see ('Other' for no branch). */
export const branchesOf = (options: ReadonlyArray<{ value: string; location?: string }>): PeopleBranch[] => {
    const by = new Map<string, string[]>();
    for (const o of options) {
        const name = String(o.location || '').trim() || 'Other';
        by.set(name, [...(by.get(name) || []), o.value]);
    }
    return [...by].map(([name, ids]) => ({ name, ids }));
};

/**
 * Who is in view, in words: "Me", "My team", a name, "3 people". Given the
 * branch headings it also says a whole branch ("Atlanta (all 7)", "Atlanta +
 * Seattle · 11 people") and two names ("Cristina + Jeremy").
 */
export const peopleSummary = (
    people: string[], me: string, nameOf: (id: string) => string | undefined, branches?: PeopleBranch[]
): string => {
    if (people.length === 0) return 'My team';
    if (isJustMe(people, me)) return 'Me';
    if (people.length === 1) return nameOf(people[0]) || '1 person';
    if (branches) {
        const on = new Set(people);
        const whole = branches.filter((b) => b.name !== 'Other' && b.ids.length >= 2 && b.ids.every((id) => on.has(id)));
        const covered = new Set(whole.flatMap((b) => b.ids));
        if (whole.length && people.every((id) => covered.has(id))) {
            return whole.length === 1
                ? `${whole[0].name} (all ${whole[0].ids.length})`
                : `${whole.map((b) => b.name).join(' + ')} · ${covered.size} people`;
        }
        const names = people.map((id) => (id === me ? 'Me' : nameOf(id)));
        if (people.length === 2 && names.every(Boolean)) return names.join(' + ');
    }
    return `${people.length} people`;
};

/**
 * A branch heading's All: tick everyone under it. My team already holds them,
 * so it stays My team.
 */
export const tickBranch = (people: string[], ids: readonly string[]): string[] =>
    (people.length ? [...new Set([...people, ...ids])] : people);

/**
 * A branch heading's None: untick everyone under it. Expands My team first;
 * unticking the last person goes back to the viewer, like togglePerson.
 */
export const untickBranch = (people: string[], ids: readonly string[], me: string, teamIds: readonly string[]): string[] => {
    const selected = people.length ? people : [...new Set([me, ...teamIds].filter(Boolean))];
    const next = selected.filter((p) => !ids.includes(p));
    return next.length ? next : peopleDefault(me);
};

/**
 * A remembered pick checked against who the viewer may see now (their access
 * can change between visits): ids they can no longer see are dropped, and a
 * pick left with nobody goes back to the viewer. Nothing to check against yet
 * (the staff list still loading) leaves it as it is. The server narrows by
 * the same rule and never widens, so this is only so the field says the truth.
 */
export const sanitizePeople = (people: string[], visible: ReadonlyArray<{ value: string }>, me: string): string[] => {
    if (!people.length || !visible.length) return people;
    const ok = new Set(visible.map((o) => o.value));
    const kept = people.filter((id) => id === me || ok.has(id));
    return kept.length ? kept : peopleDefault(me);
};

/**
 * Tick or untick one person. Unticking the last one goes back to the viewer
 * (never to an empty list, which would read as My team).
 * My team starts with everyone selected; expand its shorthand before removing
 * a person, using the full options list even when the picker is searched.
 */
export const togglePerson = (people: string[], id: string, me: string, teamIds: readonly string[]): string[] => {
    const selected = people.length ? people : [...new Set([me, ...teamIds].filter(Boolean))];
    const next = selected.includes(id) ? selected.filter((p) => p !== id) : [...selected, id];
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
