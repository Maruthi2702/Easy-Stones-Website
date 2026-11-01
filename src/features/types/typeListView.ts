import type { TypeListKind, TypeRecord } from '../../api/typeLists';
import type { Loose } from '../../types/records';
import { VISIT_TYPES, RESOURCE_TYPES, can } from '../../utils/usersAccess';
import { STARTING_RESOURCE_FAMILIES } from '../../utils/typeLists';

/*
 * Admin → Visit Types / Resource Types (with its Families): the wording and
 * rules the screen shares between its lists. The lists themselves come from
 * the database (src/api/typeLists.ts); nothing here names a type.
 */

export const FOLLOW_UP_CHOICES = [
    { value: 'none', label: 'None' },
    { value: 'optional', label: 'Optional' },
    { value: 'always', label: 'Always' }
] as const;

export const COPY: Record<TypeListKind, { title: string; noun: string; nouns: string; where: string; record: [string, string] }> = {
    visit: { title: 'Visit Types', noun: 'visit type', nouns: 'visit types', where: 'the Add visit form', record: ['visit', 'visits'] },
    resource: { title: 'Resource Types', noun: 'resource type', nouns: 'resource types', where: 'the Add resource form', record: ['resource', 'resources'] },
    family: { title: 'Families', noun: 'family', nouns: 'families', where: 'the Family dropdown and Dashboard → Resources\' filters', record: ['resource type', 'resource types'] }
};

/** "1 visit", "4 resource types". */
export const recordCount = (kind: TypeListKind, n: number): string => `${n} ${COPY[kind].record[n === 1 ? 0 : 1]}`;

/** A family's label from the families list (the starting name until it loads). */
export const familyLabel = (name: string | undefined, families: TypeRecord[]): string => {
    const key = name || 'other';
    return families.find((f) => f.name === key)?.label
        || STARTING_RESOURCE_FAMILIES.find((f) => f.name === key)?.label
        || key;
};

/** What this login may do on a list. */
export const typeListAccess = (user: Loose | null | undefined, kind: TypeListKind) => {
    const keys = kind === 'visit' ? VISIT_TYPES : RESOURCE_TYPES;
    return {
        add: can(user, keys.ADD),
        edit: can(user, keys.EDIT),
        reorder: can(user, keys.REORDER),
        delete: can(user, keys.DELETE)
    };
};

/**
 * The row's one-line summary: a resource type's family, how many types a
 * family holds, or what a visit type asks for. `related` is the other list:
 * the families for a resource type, the resource types for a family.
 */
export const typeSummary = (kind: TypeListKind, t: TypeRecord, related: TypeRecord[] = []): string => {
    if (kind === 'resource') return familyLabel(t.family, related);
    if (kind === 'family') {
        const n = related.filter((r) => (r.family || 'other') === t.name).length;
        return n ? recordCount('family', n) : 'No resource types';
    }
    const f = t.fields;
    if (!f) return '';
    const parts = [f.notes && 'Notes', f.outcome && 'Outcome'].filter(Boolean) as string[];
    if (f.followUp === 'optional') parts.push('Follow-up (optional)');
    if (f.followUp === 'always') parts.push('Follow-up');
    return parts.join(' · ') || 'No fields';
};
