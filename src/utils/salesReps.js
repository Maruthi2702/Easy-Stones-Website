/**
 * Who can be picked as a customer's owning sales rep.
 *
 * /api/salesreps returns the whole staff directory, and each consumer narrows it
 * to the people that consumer cares about — the delivery board wants drivers,
 * this wants account owners. That rule lives here rather than in each screen so
 * the customer list and the add-customer form can never disagree about who is
 * selectable.
 */

import { prettifyUsername } from './textUtils.js';

/** A staff account's name everywhere: their Display Name, else a tidied username. */
export const displayNameOf = (user) =>
    String(user?.displayName || '').trim() || prettifyUsername(user?.username);

/**
 * Managers, directors and admins are included alongside sales reps because the
 * people holding those roles sell too: `role` records the permissions someone
 * has, not whether they carry accounts. Drivers, kiosks and CSRs do not.
 */
export const SALES_REP_ROLES = ['sales_rep', 'manager', 'director', 'admin'];

/**
 * Shared logins that are a role rather than a person. Putting "Admin" in a list
 * next to real names invites someone to assign an account to nobody in
 * particular, and no one afterwards can tell who that meant. Administrators who
 * do own accounts appear under their own usernames.
 */
const SERVICE_ACCOUNT_USERNAMES = ['admin'];

/** Can this staff member be named as the owner of a customer account? */
export const isSalesRep = (user) =>
    Boolean(user?._id) &&
    SALES_REP_ROLES.includes(String(user.role || '').toLowerCase()) &&
    !SERVICE_ACCOUNT_USERNAMES.includes(String(user.username || '').toLowerCase());

/**
 * The pickable reps, ordered by branch and then by name — with a dozen-odd staff
 * accounts a flat alphabetical list buries the one or two people you actually
 * pick. Accepts the endpoint's `{ success, data }` envelope or a bare array.
 */
export const toSalesRepList = (payload) => {
    const list = payload?.data || payload || [];
    if (!Array.isArray(list)) return [];

    // /api/salesreps only started returning _id when customers gained an owning
    // rep. A server running older code answers with names and no ids, which
    // filters every candidate out and leaves an empty picker with nothing on
    // screen to explain why — so say so rather than let it read as "no reps".
    if (list.length > 0 && !list.some(u => u._id)) {
        console.warn(
            '[salesReps] The staff directory came back without ids, so no one can be ' +
            'offered as a sales rep. The API server is running a build from before ' +
            '_id was added to /api/salesreps — restart it.'
        );
        return [];
    }

    // Someone deactivated in Users & Roles stays in the list — customers they
    // still own have to show who that is, and filtering by them is how those
    // customers get found and handed over — but marked and sorted last, so
    // nobody picks them for anything new.
    return list
        .filter(isSalesRep)
        .map(u => (u.isActive === false ? { ...u, inactive: true, name: `${u.name || u.username} (inactive)` } : u))
        .sort((a, b) =>
            Number(Boolean(a.inactive)) - Number(Boolean(b.inactive)) ||
            (a.location || '').localeCompare(b.location || '') ||
            (a.name || '').localeCompare(b.name || '')
        );
};

/**
 * Does this staff member work at any of `branches`? Their home location, a
 * branch they're assigned to, or every branch ('*'). No branches (or '*')
 * means anywhere.
 */
export const worksAtAny = (user, branches = []) => {
    const want = (Array.isArray(branches) ? branches : [branches]).filter(Boolean);
    if (!want.length || want.includes('*')) return true;
    const theirs = [...(user?.assignedLocations || []), user?.location].filter(Boolean);
    return theirs.includes('*') || theirs.some((b) => want.includes(b));
};

/** The branches a signed-in person works at, for "reps on my branches". [] = every branch. */
export const branchesOf = (user) => {
    const assigned = user?.assignedLocations || [];
    if (assigned.includes('*')) return [];
    return assigned.length ? assigned : (user?.location ? [user.location] : []);
};

/**
 * The one sales rep dropdown for screens that save the rep's name (Selection
 * Sheet, Delivery, Location): the same people as the customer rep picker
 * (isSalesRep), never anyone deactivated, optionally only those working at
 * `branches`, A–Z. Whoever is already saved (`current`) stays at the top even
 * when they'd no longer be offered — marked "(inactive)" if deactivated — so
 * opening an old record never blanks or swaps its rep.
 *
 * Accepts the /api/salesreps envelope or a bare array.
 * @param {any} payload
 * @param {{ branches?: string[], current?: { name?: string, email?: string } }} [opts]
 * @returns {{ value: string, label: string, email: string, id: string, location: string }[]} value = the rep's name
 */
export function salesRepNameOptions(payload, { branches = [], current = {} } = {}) {
    const raw = payload?.data || payload || [];
    const staff = Array.isArray(raw) ? raw : [];
    const nameOf = (u) => String(u?.name || u?.username || '').trim();
    const seen = new Set();
    const options = [];
    for (const u of staff) {
        const name = nameOf(u);
        if (!name || seen.has(name) || !isSalesRep(u) || u.isActive === false || !worksAtAny(u, branches)) continue;
        seen.add(name);
        options.push({ value: name, label: name, email: String(u.email || ''), id: String(u._id), location: u.location || '' });
    }
    options.sort((a, b) => a.label.localeCompare(b.label));

    const saved = String(current?.name || '').trim();
    if (saved && !seen.has(saved)) {
        const known = staff.find((u) => nameOf(u) === saved);
        options.unshift({
            value: saved,
            label: known?.isActive === false ? `${saved} (inactive)` : saved,
            email: String(current?.email || ''),
            id: known?._id ? String(known._id) : '',
            location: known?.location || ''
        });
    }
    return options;
}

/** A location record → its sales person (Users & Roles → Locations → Sales defaults). */
export const branchSalesRepOf = (loc) => String(loc?.defaultSalesRep ?? loc?.salesDefaults?.salesRep ?? '').trim();

/**
 * Who something new at `branch` — a customer, a delivery, a check-in —
 * starts with as its sales rep: the person creating it when they're a sales
 * rep themselves, otherwise the branch's sales person. Either only when
 * they're an active sales rep (isSalesRep). → their staff record, or null
 * when neither applies (the screen keeps its old default).
 *
 * `staff` is /api/salesreps (or the same shape: _id, name, role, isActive),
 * `branchReps` is { [branch]: sales person's name }, `creator` is the
 * signed-in user ({ id } or { _id }), or null for a self check-in.
 * @param {{ staff?: any, branch?: string, branchReps?: Record<string, string>, creator?: { id?: string, _id?: string } | null }} [args]
 * @returns {any}
 */
export function startingRepFor({ staff = [], branch = '', branchReps = {}, creator = null } = {}) {
    const raw = staff?.data || staff || [];
    const list = Array.isArray(raw) ? raw : [];
    const usable = (u) => Boolean(u) && isSalesRep(u) && u.isActive !== false;
    const creatorId = String(creator?._id || creator?.id || '');
    if (creatorId) {
        const me = list.find((u) => String(u._id) === creatorId);
        if (usable(me)) return me;
    }
    const name = String(branchReps?.[branch] || '').trim();
    if (!name) return null;
    const rep = list.find((u) => String(u.name || displayNameOf(u)).trim() === name);
    return usable(rep) ? rep : null;
}

/**
 * Every sales rep dropdown and filter shows reps the same way (the Customer
 * List filter's look, chosen 2026-10-10): grouped under their branch, branches
 * A–Z ("Other" last, for a name no longer on the staff list), names A–Z
 * inside each, and the signed-in person marked "(you)" — so two people with
 * similar names at different branches aren't mixed up.
 *
 * `options` are { value, label, location, id? }; `you` is the signed-in
 * person's id (or the value they'd have); `query` narrows by name or branch.
 * A blank value (None / Unassigned) is left to the caller to show first.
 * @param {any[]} [options]
 * @param {{ you?: string, query?: string }} [opts]
 * @returns {{ group: string, options: any[] }[]}
 */
export function groupRepOptions(options = [], { you = '', query = '' } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const youKey = String(you || '');
    const byBranch = new Map();
    for (const o of Array.isArray(options) ? options : []) {
        if (!o || o.value === '' || o.value === null || o.value === undefined) continue;
        const branch = String(o.location || '').trim() || 'Other';
        if (q && !`${o.label} ${branch}`.toLowerCase().includes(q)) continue;
        const isYou = Boolean(youKey) && (String(o.id || '') === youKey || String(o.value) === youKey);
        if (!byBranch.has(branch)) byBranch.set(branch, []);
        byBranch.get(branch).push({ ...o, label: isYou ? `${o.label} (you)` : o.label, you: isYou });
    }
    return [...byBranch]
        .map(([group, opts]) => ({ group, options: opts.sort((a, b) => a.label.localeCompare(b.label)) }))
        .sort((a, b) => Number(a.group === 'Other') - Number(b.group === 'Other') || a.group.localeCompare(b.group));
}
