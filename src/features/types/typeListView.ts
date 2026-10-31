import type { TypeListKind, TypeRecord } from '../../api/typeLists';
import type { Loose } from '../../types/records';
import { VISIT_TYPES, RESOURCE_TYPES, can } from '../../utils/usersAccess';
import type { ResourceFamily } from '../../api/typeLists';

/*
 * Admin → Visit Types / Resource Types: the wording and rules the screen
 * shares between its two lists. The lists themselves come from the database
 * (src/api/typeLists.ts); nothing here names a type.
 */

export const FAMILY_CHOICES: { value: ResourceFamily; label: string }[] = [
    { value: 'tower', label: 'Display towers' },
    { value: 'tabletop', label: 'Tabletop displays' },
    { value: 'binder', label: 'Sample binders' },
    { value: 'samples', label: 'Samples' },
    { value: 'other', label: 'Other' }
];

export const FOLLOW_UP_CHOICES = [
    { value: 'none', label: 'None' },
    { value: 'optional', label: 'Optional' },
    { value: 'always', label: 'Always' }
] as const;

export const COPY: Record<TypeListKind, { title: string; noun: string; nouns: string; where: string }> = {
    visit: { title: 'Visit Types', noun: 'visit type', nouns: 'visit types', where: 'the Add visit form' },
    resource: { title: 'Resource Types', noun: 'resource type', nouns: 'resource types', where: 'the Add resource form' }
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

/** The row's one-line summary: a resource type's family, or what a visit type asks for. */
export const typeSummary = (kind: TypeListKind, t: TypeRecord): string => {
    if (kind === 'resource') return FAMILY_CHOICES.find((f) => f.value === t.family)?.label || 'Other';
    const f = t.fields;
    if (!f) return '';
    const parts = [f.notes && 'Notes', f.outcome && 'Outcome'].filter(Boolean) as string[];
    if (f.followUp === 'optional') parts.push('Follow-up (optional)');
    if (f.followUp === 'always') parts.push('Follow-up');
    return parts.join(' · ') || 'No fields';
};
