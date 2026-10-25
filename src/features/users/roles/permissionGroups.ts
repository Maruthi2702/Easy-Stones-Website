import type { PermissionAction } from '../types';

export type PermissionGroup = { section: string | undefined; actions: PermissionAction[] };

/** A card's switches grouped by section, keeping their order (a section only groups when its switches sit together). */
export const groupBySection = (actions: PermissionAction[]): PermissionGroup[] => {
    const groups: PermissionGroup[] = [];
    for (const action of actions) {
        const last = groups[groups.length - 1];
        if (last && last.section === action.section) last.actions.push(action);
        else groups.push({ section: action.section, actions: [action] });
    }
    return groups;
};

/** Whether a switch that holds others (Full access) is on for this card. */
export const fullAccessOn = (actions: PermissionAction[], permissions: string[]): boolean =>
    actions.some(x => x.impliedBy && permissions.includes(x.impliedBy));

/** The switches a section lists: those held by a Full access that is on aren't listed. */
export const listedActions = (group: PermissionGroup, fullOn: boolean): PermissionAction[] =>
    group.actions.filter(x => !(x.impliedBy && fullOn));

/** Every listed switch on, or every one off. */
export const setAllIn = (permissions: string[], listed: PermissionAction[], on: boolean): string[] => {
    const keys = listed.map(x => x.key);
    return on ? [...new Set([...permissions, ...keys])] : permissions.filter(k => !keys.includes(k));
};
