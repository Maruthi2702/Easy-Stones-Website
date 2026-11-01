import { resourceQty } from './resourceForm.ts';

/*
 * The customer profile's Moda Resources tiles, Display and Binders, worked out
 * from the customer's resources (owner's call, 2026-11-01; design: claude.ai
 * artifact "Moda counts from resources",
 * https://claude.ai/artifact/RwLQGxLHFaVfpf8HiinAEk).
 *
 * - A resource whose type is in the **Display towers** family makes Display
 *   "Yes" (shown as Installed). Tabletop displays don't (owner's call).
 * - A **Sample binders** resource adds its Qty to Binders.
 * - Only an **Active** resource counts: Inactive and Archived mean it was taken
 *   back (owner's call).
 * - `modaEarlier` is what was counted before resources were logged (typed on
 *   Edit customer or imported) that no resource accounts for. A customer saved
 *   before this rule has none; it is worked out the first time its resources
 *   change, from the typed values and the resources as they were, so no count
 *   goes down (`earlierCount`). scripts/moda-switch.ts does it for everyone.
 *
 * The customer keeps storing `modaDisplay` ('Yes' / 'No') and `modaBinder` (a
 * number as text), so the list's badges and filter, the map and the export read
 * them as before. Every write that changes a customer's resources recounts them
 * (src/services/modaCount.ts).
 */

export const DISPLAY_FAMILY = 'tower';
export const BINDER_FAMILY = 'binder';

export type ModaEarlier = { display: boolean; binders: number };
// Records as the database holds them: the fields read here, plus whatever else they carry.
export type ModaResource = { _id?: unknown; resourceType?: unknown; title?: unknown; qty?: unknown; status?: unknown; date?: unknown; [key: string]: unknown };
export type ModaCustomer = { modaDisplay?: unknown; modaBinder?: unknown; modaEarlier?: { display?: unknown; binders?: unknown } | null; [key: string]: unknown };
export type FamilyOf = (typeName: string) => string | undefined;
export type ModaFields = { modaDisplay: 'Yes' | 'No'; modaBinder: string; modaEarlier: ModaEarlier };

/** Type name → family, from the Resource Types list. */
export const familyLookup = (types: readonly { name?: unknown; family?: unknown; [key: string]: unknown }[]): FamilyOf => {
    const map = new Map(types.map((t) => [String(t.name ?? ''), String(t.family || 'other')]));
    return (name) => map.get(name);
};

/** The type a resource carries (resources saved before types had a field kept it in the title). */
export const resourceTypeOf = (r: ModaResource): string => String(r?.resourceType || r?.title || '').trim();

/** Inactive and Archived resources have been taken back. */
export const isAtCustomer = (r: ModaResource): boolean => String(r?.status || 'Active') === 'Active';

/** What a resource adds to the profile: 'display', 'binders' or null. */
export const modaKindOf = (family: string | undefined): 'display' | 'binders' | null =>
    family === DISPLAY_FAMILY ? 'display' : family === BINDER_FAMILY ? 'binders' : null;

/** Towers and binders among the customer's Active resources. */
export const resourceCounts = (resources: readonly ModaResource[] | null | undefined, familyOf: FamilyOf) => {
    let towers = 0, binders = 0;
    for (const r of resources || []) {
        if (!isAtCustomer(r)) continue;
        const kind = modaKindOf(familyOf(resourceTypeOf(r)));
        if (kind === 'display') towers += resourceQty(r);
        else if (kind === 'binders') binders += resourceQty(r);
    }
    return { towers, binders };
};

/** The stored binder text as a number ('' / junk / negative → 0). */
export const storedBinderCount = (value: unknown): number => {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

const hasEarlier = (c: ModaCustomer | null | undefined) =>
    typeof c?.modaEarlier?.display === 'boolean' && typeof c?.modaEarlier?.binders === 'number';

/**
 * The earlier count: the stored one, or for a customer saved before this rule,
 * what the typed values hold beyond the resources as they are now. Typed 6
 * with 2 binders logged → 4 earlier (still 6 in all); typed 0 with 3 logged →
 * 0 earlier (3 in all). Display typed Yes with no tower logged stays Yes.
 */
export const earlierCount = (c: ModaCustomer | null | undefined, resourcesNow: readonly ModaResource[] | null | undefined, familyOf: FamilyOf): ModaEarlier => {
    if (hasEarlier(c)) return { display: c!.modaEarlier!.display as boolean, binders: Math.max(0, Math.floor(c!.modaEarlier!.binders as number)) };
    const now = resourceCounts(resourcesNow, familyOf);
    return {
        display: c?.modaDisplay === 'Yes' && now.towers === 0,
        binders: Math.max(0, storedBinderCount(c?.modaBinder) - now.binders)
    };
};

/** What the customer stores, from its earlier count and its resources. */
export const modaFields = (earlier: ModaEarlier, resources: readonly ModaResource[] | null | undefined, familyOf: FamilyOf): ModaFields => {
    const now = resourceCounts(resources, familyOf);
    return {
        modaDisplay: earlier.display || now.towers > 0 ? 'Yes' : 'No',
        modaBinder: String(earlier.binders + now.binders),
        modaEarlier: { display: earlier.display, binders: earlier.binders }
    };
};

/**
 * Edit customer: a typed Display / Binders is the new total, and the earlier
 * count is set to make it add up. Never below what the Active resources hold.
 * Only a value that differs from what's stored counts as typed, so saving the
 * form for another field leaves the counts alone. `fields` is null when
 * neither changed.
 */
export const typedModaFields = (
    c: ModaCustomer,
    typed: { modaDisplay?: unknown; modaBinder?: unknown },
    resources: readonly ModaResource[] | null | undefined,
    familyOf: FamilyOf
): { fields: ModaFields | null } | { error: string } => {
    const now = resourceCounts(resources, familyOf);
    const earlier = earlierCount(c, resources, familyOf);
    let changed = false;

    if (typed.modaBinder !== undefined) {
        const text = String(typed.modaBinder ?? '').trim() || '0';
        if (!/^\d+$/.test(text)) return { error: 'Moda binders must be a whole number.' };
        const total = Number(text);
        if (total !== storedBinderCount(c.modaBinder)) {
            if (total < now.binders) {
                return { error: `${now.binders} ${now.binders === 1 ? 'binder is' : 'binders are'} logged as Active resources on this customer. Edit or archive those resources to go lower.` };
            }
            earlier.binders = total - now.binders;
            changed = true;
        }
    }
    if (typed.modaDisplay !== undefined) {
        const yes = typed.modaDisplay === 'Yes';
        if (yes !== (c.modaDisplay === 'Yes')) {
            if (!yes && now.towers > 0) {
                return { error: 'A Display tower is logged as an Active resource on this customer. Archive or delete it to set Moda display to No.' };
            }
            earlier.display = yes;
            changed = true;
        }
    }
    return { fields: changed ? modaFields(earlier, resources, familyOf) : null };
};

export type ModaItem = { _id: string; type: string; qty: number; date: string; status: string; kind: 'display' | 'binders' };

/**
 * The Moda Resources tiles and the binder breakdown: the totals, the earlier
 * count, and every tower / binder resource (Active ones count), newest first.
 */
export const modaSummary = (c: ModaCustomer, resources: readonly ModaResource[] | null | undefined, familyOf: FamilyOf) => {
    const earlier = earlierCount(c, resources, familyOf);
    const fields = modaFields(earlier, resources, familyOf);
    const items: ModaItem[] = [];
    for (const r of resources || []) {
        const kind = modaKindOf(familyOf(resourceTypeOf(r)));
        if (!kind) continue;
        items.push({ _id: String(r._id ?? ''), type: resourceTypeOf(r), qty: resourceQty(r), date: String(r.date || '').slice(0, 10), status: String(r.status || 'Active'), kind });
    }
    items.sort((a, b) => b.date.localeCompare(a.date));
    return { display: fields.modaDisplay === 'Yes', binders: Number(fields.modaBinder), earlier, items };
};

export type ModaSummary = ReturnType<typeof modaSummary>;

/**
 * Add / Edit resource: what saving changes on the profile, from the customer's
 * summary and the resource as it will be saved (`editingId` is the resource
 * being edited, so its old self is left out). null when nothing changes.
 */
export const modaChange = (summary: ModaSummary, next: ModaResource, editingId: string | null, familyOf: FamilyOf) => {
    const kept = summary.items.filter((i) => i._id !== editingId)
        .map((i) => ({ resourceType: i.type, qty: i.qty, status: i.status }));
    const after = modaFields(summary.earlier, [...kept, next], familyOf);
    const display = { from: summary.display, to: after.modaDisplay === 'Yes' };
    const binders = { from: summary.binders, to: Number(after.modaBinder) };
    if (display.from === display.to && binders.from === binders.to) return null;
    return { display, binders };
};
