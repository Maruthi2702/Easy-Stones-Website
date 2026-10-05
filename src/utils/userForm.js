import { homeLocationOf, fallbackHomeLocation } from './locationFilter.js';

// The Add User form's rules, kept free of React so they can be unit-tested
// (userForm.test.js). The server repeats the ones that matter for safety —
// username format, required email/joining date — in POST /api/admin/users;
// these exist so the form can say what's wrong before anyone presses Create.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
// Lower-case letters and digits, with single dots, dashes or underscores
// between them: alex.rivera, jdoe2, 3rd-party. The User model lower-cases
// usernames anyway; this keeps out spaces and symbols that make a login hard
// to type on a phone.
const USERNAME_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 6; // matches the User model's minlength

/**
 * The sign-in name the form suggests from a full name: "Alex Rivera" →
 * "alex.rivera", "José O'Neil" → "jose.oneil". The admin can change it.
 */
export const suggestUsername = (fullName = '') =>
    String(fullName)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // é → e
        .toLowerCase()
        .replace(/['’]/g, '')            // O'Neil → oneil, not o.neil
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, USERNAME_MAX)
        .replace(/\.+$/g, '');

/** Why a username can't be used, or '' when it's fine. */
export const usernameProblem = (username = '') => {
    const u = String(username).trim().toLowerCase();
    if (!u) return 'Enter a username';
    if (u.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters`;
    if (u.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters`;
    if (!USERNAME_RE.test(u)) return 'Letters, numbers and . - _ only';
    return '';
};

export const isValidEmail = (email = '') => EMAIL_RE.test(String(email).trim());

/** True for a real calendar date written YYYY-MM-DD (what <input type="date"> gives). */
export const isValidDateInput = (value = '') => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const WORDS = ['Granite', 'Quartz', 'Marble', 'Ridge', 'Slate', 'Onyx', 'Basalt', 'Summit', 'Canyon', 'Harbor', 'Cedar', 'Falcon', 'River', 'Meadow', 'Coral', 'Juniper'];

/**
 * An easy-to-read-aloud temporary password like "Granite-4821-Ridge" — it's
 * handed over in person or by phone, and replaced at first sign-in.
 * `random` is injectable for tests; defaults to crypto when available.
 */
export const generateTempPassword = (random) => {
    const rnd = random || (() => {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
        }
        return Math.random();
    });
    const pick = () => WORDS[Math.floor(rnd() * WORDS.length) % WORDS.length];
    const first = pick();
    let second = pick();
    for (let i = 0; second === first && i < 5; i++) second = pick();
    const digits = String(1000 + Math.floor(rnd() * 9000)).slice(0, 4);
    return `${first}-${digits}-${second}`;
};

/**
 * Field errors for the Add User form, in the order the fields appear (the
 * banner's "Go to first" goes to the first key). An empty object means it can
 * be submitted.
 *   usernameTaken — the availability check said someone already has it.
 */
export const validateNewUser = (values, { usernameTaken = false, checkUsername = true } = {}) => {
    const errors = {};
    if (!String(values.displayName || '').trim()) errors.displayName = 'Enter their full name';
    if (!String(values.email || '').trim()) errors.email = 'Enter their work email';
    else if (!isValidEmail(values.email)) errors.email = 'That doesn’t look like an email address';
    if (checkUsername) {
        const uProblem = usernameProblem(values.username);
        if (uProblem) errors.username = uProblem;
        else if (usernameTaken) errors.username = 'Someone already has this username';
    }
    if (!values.joiningDate) errors.joiningDate = 'Pick the day they start';
    else if (!isValidDateInput(values.joiningDate)) errors.joiningDate = 'Pick a real date';
    if (!values.role) errors.role = 'Pick a role';
    if (!values.assignedLocations || values.assignedLocations.length === 0) errors.assignedLocations = 'Choose at least one location';
    // 'password' needs one; 'invite' and (editing) 'keep' don't.
    if (values.signInMethod === 'password' && String(values.password || '').length < PASSWORD_MIN) {
        errors.password = `At least ${PASSWORD_MIN} characters`;
    }
    return errors;
};

const norm = (v) => (typeof v === 'string' ? v.trim() : v ?? '');
const sameValue = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
// Fields an older account may be missing (or have in an old format).
const KEPT_AS_IS = ['displayName', 'email', 'joiningDate', 'assignedLocations'];

/**
 * Edit user's checks: the same as Add user's, minus the username — it can't
 * be changed there, and older accounts have names (spaces, capitals) the new
 * format rule would reject.
 *
 * Given the account as it was opened (`initial`), a field left exactly as it
 * was isn't held against the edit: an older account with no email or joining
 * date can still have its role or password changed without someone making
 * those up (owner's call, 2026-10-05). Changing or clearing one is checked.
 */
export const validateUserEdit = (values, initial = null) => {
    const errors = validateNewUser(values, { checkUsername: false });
    if (initial) {
        for (const k of KEPT_AS_IS) if (errors[k] && sameValue(values[k], initial[k])) delete errors[k];
    }
    return errors;
};

/**
 * The account fields Edit user sends: role and home branch always, the rest
 * only when changed — the server rejects a blank name, email, joining date or
 * location list whenever one is sent, so an older account's missing ones are
 * left out rather than sent back blank.
 */
export const userEditFields = (values, initial = {}) => {
    const out = { role: values.role, location: values.location };
    const fields = {
        displayName: String(values.displayName || '').trim(),
        email: String(values.email || '').trim(),
        joiningDate: values.joiningDate,
        assignedLocations: values.assignedLocations
    };
    for (const [k, v] of Object.entries(fields)) if (!sameValue(v, initial[k])) out[k] = v;
    return out;
};

/** An account as the Edit user form holds it. */
export const userToFormValues = (user = {}) => {
    const assigned = Array.isArray(user.assignedLocations) && user.assignedLocations.length ? user.assignedLocations : [];
    return {
        displayName: String(user.displayName || '').trim(),
        email: user.email || '',
        username: user.username || '',
        // Stored as midnight UTC of the calendar day; the date input wants YYYY-MM-DD.
        joiningDate: user.joiningDate ? String(user.joiningDate).slice(0, 10) : '',
        role: user.role || '',
        assignedLocations: assigned,
        location: homeAfterChange(user.location || '', assigned),
        signInMethod: 'keep',
        password: ''
    };
};

const SHORT_DATE = { month: 'short', day: 'numeric' };

/**
 * The edit form's footer line: "Last changed by krish · Oct 3", or "Added
 * Sep 12" for an account nobody has edited since Users & Roles started
 * recording it. A different year is shown in full.
 */
export const lastChangedText = (user = {}, now = new Date()) => {
    const fmt = (d) => {
        const date = new Date(d);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('en-US', date.getFullYear() === now.getFullYear() ? SHORT_DATE : { ...SHORT_DATE, year: 'numeric' });
    };
    if (user.editedAt) {
        const when = fmt(user.editedAt);
        if (when) return user.editedBy ? `Last changed by ${user.editedBy} · ${when}` : `Last changed ${when}`;
    }
    if (user.createdAt) {
        const when = fmt(user.createdAt);
        if (when) return `Added ${when}`;
    }
    return '';
};

/** Field labels for the error banner ("2 fields need attention — Full name, Joining date"). */
export const FIELD_LABELS = {
    displayName: 'Full name',
    email: 'Work email',
    username: 'Username',
    joiningDate: 'Joining date',
    role: 'Role',
    assignedLocations: 'Locations',
    password: 'Temporary password'
};

/**
 * How many fields the person has changed from the form's starting values —
 * drives "You've filled in N fields" in the discard check. A field counts
 * once, however much was typed into it.
 */
export const countChangedFields = (values, initial) =>
    Object.keys(initial).filter((key) => {
        const a = values[key];
        const b = initial[key];
        if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) !== JSON.stringify(b || []);
        return String(a ?? '') !== String(b ?? '');
    }).length;

/**
 * Ticking or unticking one branch in the Locations picker. '*' is "Every
 * location" and replaces any individual branches; ticking a branch while '*'
 * is on swaps back to just that branch.
 */
export const toggleLocation = (list = [], key) => {
    if (key === '*') return list.includes('*') ? [] : ['*'];
    const withoutAll = list.filter((k) => k !== '*');
    return withoutAll.includes(key) ? withoutAll.filter((k) => k !== key) : [...withoutAll, key];
};

/**
 * One line describing what a role can open, built from its permissions so it
 * stays true when someone edits the role: "Driver screen · Delivery Schedule".
 * `pages` is Users & Roles' PAGE_PERMISSIONS ([{ page, actions: [{ key }] }]).
 */
export const summarizeRole = (permissions = [], pages = [], max = 4) => {
    const held = new Set(permissions);
    const names = pages
        .filter((p) => p.actions.some((a) => held.has(a.key)))
        .map((p) => p.page);
    if (held.has('delivery_driver_view')) names.unshift('Driver screen');
    const unique = [...new Set(names)];
    if (unique.length === 0) return 'No screens yet — set them under Roles';
    const shown = unique.slice(0, max).join(' · ');
    return unique.length > max ? `${shown} +${unique.length - max} more` : shown;
};

/**
 * The home location to keep once someone's branches change — the same rule as
 * the edit form and the server (locationFilter.js): the current home while
 * it's still theirs, otherwise their first branch, or none for an
 * all-locations user.
 */
export const homeAfterChange = (home, assignedLocations) =>
    homeLocationOf({ location: home, assignedLocations })
    || (assignedLocations.includes('*') ? '' : fallbackHomeLocation(assignedLocations));
