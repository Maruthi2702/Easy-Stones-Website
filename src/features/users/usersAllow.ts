import { can, USERS, ROLES, LOCATIONS } from '../../utils/usersAccess';
import type { CurrentUser } from '../../types/records';

/**
 * What this person may do on the Users & Roles pages, one switch per action
 * (src/utils/usersAccess.ts). Team access (a manager) may deactivate,
 * reactivate and unlock their own people (src/utils/teamAccess.ts).
 */
export const usersAllow = (me: CurrentUser | null | undefined, teamMode: boolean) => ({
    addUser: can(me, USERS.ADD), editUser: can(me, USERS.EDIT), resetSignIn: can(me, USERS.RESET_SIGN_IN),
    deactivate: teamMode || can(me, USERS.DEACTIVATE), unlock: teamMode || can(me, USERS.UNLOCK), deleteUser: can(me, USERS.DELETE),
    addRole: can(me, ROLES.ADD), editRole: can(me, ROLES.EDIT), deleteRole: can(me, ROLES.DELETE),
    addLocation: can(me, LOCATIONS.ADD), editLocation: can(me, LOCATIONS.EDIT), deleteLocation: can(me, LOCATIONS.DELETE)
});

export type UsersAllow = ReturnType<typeof usersAllow>;
