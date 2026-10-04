import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { prettifyUsername } from '../../../utils/textUtils';
import { clearDriversCache } from '../../../api/deliverySchedule';

/*
 * Taking a person off the road safely, shared by Users & Roles and the /admin
 * screen. The server refuses to deactivate, delete, or move a driver to a
 * non-driver role while they still have upcoming orders (409
 * 'has-upcoming-orders'), since those would be left on a column nobody
 * drives; these ask once whether to move them to Pending and resend.
 */

/**
 * Runs `send(moveUpcomingToPending)`; on a has-upcoming-orders refusal, asks
 * and resends with true. Resolves to the final Response, or null when the
 * person said no.
 */
export async function withDriverHandover(send, verb) {
    let res = await send(false);
    if (res.status !== 409) return res;
    const info = await res.clone().json().catch(() => ({}));
    if (info.code !== 'has-upcoming-orders') return res;
    const it = info.upcoming === 1 ? 'it' : 'them';
    if (!window.confirm(`${info.message}\n\nMove ${it} to Pending Delivery and ${verb} now? (You can assign ${it} to another driver from there.)`)) return null;
    res = await send(true);
    return res;
}

/**
 * Deactivate, reactivate or delete an account, with the confirm prompts.
 * Resolves to true when it happened.
 */
export async function changeUserAccess(user, action) {
    const name = user.displayName || prettifyUsername(user.username);
    const prompts = {
        deactivate: `Deactivate ${name}? They won't be able to sign in, and won't be offered for new work. Their history stays, and you can reactivate them later.`,
        reactivate: `Reactivate ${name}? They'll be able to sign in again.`,
        delete: `Delete ${name} permanently? Their name will no longer show on the work they did — Deactivate keeps it.`
    };
    if (!window.confirm(prompts[action])) return false;

    const send = (moveUpcomingToPending) => authFetch(
        action === 'delete' ? `${API_URL}/api/admin/users/${user._id}` : `${API_URL}/api/admin/users/${user._id}/active`,
        {
            method: action === 'delete' ? 'DELETE' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action === 'delete' ? { moveUpcomingToPending } : { active: action === 'reactivate', moveUpcomingToPending })
        }
    );
    try {
        const res = await withDriverHandover(send, action);
        if (!res) return false;
        if (!res.ok) {
            const info = await res.json().catch(() => ({}));
            throw new Error(info.message || 'Could not change this account');
        }
        clearDriversCache();
        alert(action === 'delete' ? 'User deleted.' : `${name} ${action === 'reactivate' ? 'reactivated' : 'deactivated'}.`);
        return true;
    } catch (err) {
        alert(err.message);
        return false;
    }
}
