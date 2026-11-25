import { useCallback, useMemo, useState } from 'react';
import { branchesOf, MY_TEAM, parseStoredPeople, peopleDefault, peopleSummary, sanitizePeople, tickBranch, togglePerson, untickBranch } from '../../../utils/peopleSelection';
import type { PersonOption } from '../../../api/myTeam';
import type { PeopleFilter } from './PeopleField';

/**
 * State for a People filter (PeopleField), so a screen doesn't wire its own.
 * Give it the people the viewer may see (usePeopleOptions, or a screen's own
 * list shaped as PersonOption — access is decided there, never here) and it
 * returns the picked ids (`value`: [] = everyone in view, "My team") plus
 * `field`, which spreads straight into <PeopleField {...field} />.
 *
 * - `start`: what the screen opens on — 'me' (the Dashboard's choice) or
 *   'team'. "Clear filter" goes back to it.
 * - `storageKey`: remember the pick for the browser session (per person —
 *   include the user's id in the key). Omit to forget on leaving.
 * - `storage`: 'local' keeps it on this device until changed (Credit Card
 *   Receipts); 'session' (the default, the Dashboard) forgets it with the tab.
 * - A remembered or earlier pick the viewer can no longer see is dropped
 *   (`sanitizePeople`).
 */
export type UsePeopleFilterArgs = {
    options: PersonOption[];
    me: string;
    start?: 'me' | 'team';
    storageKey?: string;
    storage?: 'session' | 'local';
    /** Other screens: the field's name, what [] is called, and no "Me" row. */
    label?: string;
    teamLabel?: string;
    hideMe?: boolean;
    /** Called after any change (e.g. a screen returning to page 1). */
    onPick?: (people: string[]) => void;
};

const store = (kind: 'session' | 'local') => (kind === 'local' ? localStorage : sessionStorage);
const readStored = (key: string | undefined, kind: 'session' | 'local'): string[] | null => {
    if (!key) return null;
    try { return parseStoredPeople(store(kind).getItem(key)); } catch { return null; }
};

export default function usePeopleFilter({ options, me, start = 'me', storageKey, storage = 'session', label, teamLabel, hideMe, onPick }: UsePeopleFilterArgs) {
    const home = useMemo(() => (start === 'me' ? peopleDefault(me) : MY_TEAM), [start, me]);
    const [picked, setPicked] = useState<string[] | null>(() => readStored(storageKey, storage));
    // A different person or key (sign-out / sign-in): read theirs, not the last one's.
    const [keyFor, setKeyFor] = useState(storageKey);
    if (keyFor !== storageKey) {
        setKeyFor(storageKey);
        setPicked(readStored(storageKey, storage));
    }

    const value = useMemo(() => sanitizePeople(picked ?? home, options, me), [picked, home, options, me]);
    const teamIds = useMemo(() => options.map((o) => o.value), [options]);

    const setValue = useCallback((people: string[]) => {
        setPicked(people);
        if (storageKey) {
            try { store(storage).setItem(storageKey, JSON.stringify(people)); } catch { /* private mode: not remembered */ }
        }
        onPick?.(people);
    }, [storageKey, storage, onPick]);

    const onToggle = (id: string) => setValue(togglePerson(value, id, me, teamIds));
    const onBranch = (ids: string[], on: boolean) => setValue(on ? tickBranch(value, ids) : untickBranch(value, ids, me, teamIds));
    const reset = () => setValue(home);

    const isHome = value.length === home.length && value.every((id, i) => id === home[i]);
    const summary = peopleSummary(value, me, (id) => options.find((o) => o.value === id)?.label, branchesOf(options));

    const field: PeopleFilter = {
        options, value, me, label, teamLabel, hideMe,
        onChange: setValue, onToggle, onBranch,
        active: !isHome, onReset: reset, summary
    };
    return { value, setValue, reset, active: !isHome, field };
}
