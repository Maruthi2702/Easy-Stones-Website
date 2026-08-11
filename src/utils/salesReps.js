/**
 * Who can be picked as a customer's owning sales rep.
 *
 * /api/salesreps returns the whole staff directory, and each consumer narrows it
 * to the people that consumer cares about — the delivery board wants drivers,
 * this wants account owners. That rule lives here rather than in each screen so
 * the customer list and the add-customer form can never disagree about who is
 * selectable.
 */

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

    return list
        .filter(isSalesRep)
        .sort((a, b) =>
            (a.location || '').localeCompare(b.location || '') ||
            (a.name || '').localeCompare(b.name || '')
        );
};
