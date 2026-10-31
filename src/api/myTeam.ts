import { useMemo } from 'react';
import { useStaffList } from './salesRepOptions';
import { teammatesOf, peopleOptions, visiblePeople, workLocationsOf, ALL_PEOPLE } from '../utils/teamScope';
import { isSalesRep, displayNameOf } from '../utils/salesReps';
import type { Loose } from '../types/records';

/*
 * The screens' side of src/utils/teamScope.js (by the REP's branch): who is on
 * the signed-in person's team, for the Edit / Delete buttons on visits and
 * resources (canModifyVisit / canDeleteVisit), and who the dashboard's People
 * filter offers. Built from the shared staff list, so it matches what the
 * server decides from the same rule.
 */

/** The viewer as teamScope.js reads them. */
const viewerOf = (user: Loose | null | undefined, userId: string | null | undefined) => ({
    id: String(userId || user?.id || user?._id || ''),
    permissions: user?.permissions,
    assignedLocations: user?.assignedLocations
});

/** The viewer's team — ALL_PEOPLE or a Set of ids — for canModifyVisit / canDeleteVisit. */
export function useMyTeam(user: Loose | null | undefined, userId: string | null | undefined): typeof ALL_PEOPLE | Set<string> {
    const staff = useStaffList();
    const id = String(userId || '');
    const locKey = JSON.stringify(user?.assignedLocations || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => teammatesOf(viewerOf(user, id), staff), [staff, id, locKey]);
}

/** A person in the People filter: { value: id, label, location (branch heading), locations (all they work at), inactive }. */
export type PersonOption = { value: string; id: string; label: string; location: string; locations?: string[]; inactive: boolean };

/**
 * Who the dashboard's People filter offers: the sales reps (and the viewer)
 * among the people the viewer can see. Empty when they only see themselves.
 * "My team" still covers everyone visible, a non-rep who logged a visit too.
 */
export function usePeopleOptions(user: Loose | null | undefined, userId: string | null | undefined): PersonOption[] {
    const staff = useStaffList();
    const id = String(userId || '');
    const permKey = JSON.stringify([user?.permissions || [], user?.assignedLocations || []]);
    return useMemo(() => {
        const viewer = viewerOf(user, id);
        const visible = visiblePeople(viewer, staff);
        if (visible !== ALL_PEOPLE && visible.size <= 1) return [];
        return (peopleOptions(viewer, staff) as Loose[])
            .filter((p) => String(p._id) === id || isSalesRep(p))
            .map((p) => ({
                value: String(p._id),
                id: String(p._id),
                label: displayNameOf(p),
                location: workLocationsOf(p)[0] || '',
                locations: workLocationsOf(p),
                inactive: p.isActive === false
            }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [staff, id, permKey]);
}
