import { describe, it, expect } from 'vitest';
import {
    suggestUsername, usernameProblem, isValidEmail, isValidDateInput,
    generateTempPassword, validateNewUser, countChangedFields, toggleLocation,
    summarizeRole, homeAfterChange, validateUserEdit, userEditFields, userToFormValues, lastChangedText, PASSWORD_MIN
} from './userForm';

describe('suggestUsername', () => {
    it.each([
        ['Alex Rivera', 'alex.rivera'],
        ['  Alex   Rivera  ', 'alex.rivera'],
        ['José Núñez', 'jose.nunez'],
        ["Mary O'Neil", 'mary.oneil'],
        ['3rd Party - Delivery', '3rd.party.delivery'],
        ['', ''],
        ['!!!', '']
    ])('%s → %s', (name, expected) => {
        expect(suggestUsername(name)).toBe(expected);
    });

    it('never ends in a dot after trimming to the maximum length', () => {
        const u = suggestUsername('Abcdefghijklmnopqrstuvwxyzabcde Fghij');
        expect(u.length).toBeLessThanOrEqual(32);
        expect(u.endsWith('.')).toBe(false);
    });

    it('always suggests something usernameProblem accepts, when it suggests anything', () => {
        for (const name of ['Alex Rivera', 'José Núñez', "Mary O'Neil", 'Li Wei', 'A B C']) {
            const u = suggestUsername(name);
            if (u.length >= 3) expect(usernameProblem(u)).toBe('');
        }
    });
});

describe('usernameProblem', () => {
    it.each([
        ['alex.rivera', ''],
        ['jdoe2', ''],
        ['3rd-party', ''],
        ['a_b', ''],
        ['', 'Enter a username'],
        ['ab', 'At least 3 characters'],
        ['alex rivera', 'Letters, numbers and . - _ only'],
        ['alex..rivera', 'Letters, numbers and . - _ only'],
        ['.alex', 'Letters, numbers and . - _ only'],
        ['alex@home', 'Letters, numbers and . - _ only'],
        ['a'.repeat(33), 'At most 32 characters']
    ])('%s', (u, expected) => {
        expect(usernameProblem(u)).toBe(expected);
    });

    it('is not fussy about case — the server lower-cases it', () => {
        expect(usernameProblem('Alex.Rivera')).toBe('');
    });
});

describe('isValidEmail / isValidDateInput', () => {
    it('emails', () => {
        expect(isValidEmail('alex@easystones.com')).toBe(true);
        expect(isValidEmail('alex@easystones')).toBe(false);
        expect(isValidEmail('alex easystones.com')).toBe(false);
    });
    it('dates', () => {
        expect(isValidDateInput('2026-10-05')).toBe(true);
        expect(isValidDateInput('2026-02-30')).toBe(false);
        expect(isValidDateInput('10/05/2026')).toBe(false);
        expect(isValidDateInput('')).toBe(false);
    });
});

describe('generateTempPassword', () => {
    it('looks like Word-1234-Word, long enough to save, two different words', () => {
        for (let i = 0; i < 50; i++) {
            const p = generateTempPassword();
            expect(p).toMatch(/^[A-Z][a-z]+-\d{4}-[A-Z][a-z]+$/);
            expect(p.length).toBeGreaterThanOrEqual(PASSWORD_MIN);
            const [a, , b] = p.split('-');
            expect(a).not.toBe(b);
        }
    });
    it('uses the random source it is given', () => {
        expect(generateTempPassword(() => 0)).toBe(generateTempPassword(() => 0));
    });
});

describe('validateNewUser', () => {
    const good = {
        displayName: 'Alex Rivera', email: 'alex@easystones.com', username: 'alex.rivera',
        joiningDate: '2026-10-05', role: 'driver', assignedLocations: ['Seattle'],
        signInMethod: 'password', password: 'Granite-4821-Ridge'
    };

    it('accepts a complete form', () => {
        expect(validateNewUser(good)).toEqual({});
    });

    it('lists every problem, in the order the fields appear', () => {
        const errors = validateNewUser({ ...good, displayName: ' ', joiningDate: '', assignedLocations: [] });
        expect(Object.keys(errors)).toEqual(['displayName', 'joiningDate', 'assignedLocations']);
    });

    it('needs a password only for the temporary-password method', () => {
        expect(validateNewUser({ ...good, password: '' }).password).toBeTruthy();
        expect(validateNewUser({ ...good, signInMethod: 'invite', password: '' })).toEqual({});
    });

    it('reports a taken username only when the format is fine', () => {
        expect(validateNewUser(good, { usernameTaken: true }).username).toBe('Someone already has this username');
        expect(validateNewUser({ ...good, username: 'a b' }, { usernameTaken: true }).username).toBe('Letters, numbers and . - _ only');
    });

    it('requires a real email', () => {
        expect(validateNewUser({ ...good, email: '' }).email).toBe('Enter their work email');
        expect(validateNewUser({ ...good, email: 'alex' }).email).toMatch(/doesn’t look like/);
    });
});

describe('countChangedFields', () => {
    const initial = { displayName: '', email: '', assignedLocations: ['Seattle'], password: 'X' };
    it('counts each changed field once', () => {
        expect(countChangedFields(initial, initial)).toBe(0);
        expect(countChangedFields({ ...initial, displayName: 'A', email: 'b' }, initial)).toBe(2);
        expect(countChangedFields({ ...initial, assignedLocations: ['Seattle', 'Dallas'] }, initial)).toBe(1);
    });
});

describe('toggleLocation', () => {
    it('adds and removes a branch', () => {
        expect(toggleLocation(['Seattle'], 'Dallas')).toEqual(['Seattle', 'Dallas']);
        expect(toggleLocation(['Seattle', 'Dallas'], 'Seattle')).toEqual(['Dallas']);
    });
    it('Every location replaces the branches, and a branch replaces Every location', () => {
        expect(toggleLocation(['Seattle', 'Dallas'], '*')).toEqual(['*']);
        expect(toggleLocation(['*'], '*')).toEqual([]);
        expect(toggleLocation(['*'], 'Dallas')).toEqual(['Dallas']);
    });
});

describe('summarizeRole', () => {
    const pages = [
        { page: 'Dashboard', actions: [{ key: 'view_dashboard' }] },
        { page: 'Customers', actions: [{ key: 'view_customers' }, { key: 'manage_customers' }] },
        { page: 'Delivery Schedule', actions: [{ key: 'view_delivery_schedule' }, { key: 'delivery_driver_view' }] },
        { page: 'Visits', actions: [{ key: 'add_visits' }] },
        { page: 'Users & Roles', actions: [{ key: 'manage_users' }] }
    ];
    it('names the screens a role can open', () => {
        expect(summarizeRole(['view_customers', 'manage_customers'], pages)).toBe('Customers');
    });
    it('puts the driver screen first for drivers', () => {
        expect(summarizeRole(['view_delivery_schedule', 'delivery_driver_view'], pages)).toBe('Driver screen · Delivery Schedule');
    });
    it('shortens long lists', () => {
        expect(summarizeRole(['view_dashboard', 'view_customers', 'view_delivery_schedule', 'add_visits', 'manage_users'], pages))
            .toBe('Dashboard · Customers · Delivery Schedule · Visits +1 more');
    });
    it('says so when a role has nothing', () => {
        expect(summarizeRole([], pages)).toMatch(/No screens yet/);
    });
});

describe('homeAfterChange', () => {
    it('keeps the home while it is still one of theirs', () => {
        expect(homeAfterChange('Dallas', ['Seattle', 'Dallas'])).toBe('Dallas');
    });
    it('falls back to their first branch when home is removed', () => {
        expect(homeAfterChange('Dallas', ['Seattle'])).toBe('Seattle');
    });
    it('allows no home for an all-locations user, and keeps one they picked', () => {
        expect(homeAfterChange('', ['*'])).toBe('');
        expect(homeAfterChange('Dallas', ['*'])).toBe('Dallas');
    });
});

describe('validateUserEdit', () => {
    const good = {
        displayName: 'Sergio M', email: 'sergio@example.com', username: 'Sergio Driver',
        joiningDate: '2024-03-01', role: 'driver', assignedLocations: ['Seattle'], signInMethod: 'keep', password: ''
    };
    it('ignores the username, which can’t be edited and may be an old format', () => {
        expect(validateUserEdit(good)).toEqual({});
    });
    it('asks for a password only when resetting to a temporary one', () => {
        expect(validateUserEdit({ ...good, signInMethod: 'invite' })).toEqual({});
        expect(validateUserEdit({ ...good, signInMethod: 'password' }).password).toBeTruthy();
    });
    it('lets an older account with no email or joining date be edited as it is', () => {
        const old = { ...good, displayName: '', email: '', joiningDate: '' };
        expect(validateUserEdit({ ...old, role: 'manager' }, old)).toEqual({});
    });
    it('still checks a field that was changed or cleared', () => {
        expect(validateUserEdit({ ...good, joiningDate: '' }, good).joiningDate).toBe('Pick the day they start');
        expect(validateUserEdit({ ...good, email: 'nope' }, { ...good, email: '' }).email).toBeTruthy();
        // Without the starting values (Add user's rule) everything is required.
        expect(validateUserEdit({ ...good, joiningDate: '' }).joiningDate).toBe('Pick the day they start');
    });
});

describe('userEditFields', () => {
    const start = { displayName: '', email: '', joiningDate: '', role: 'driver', assignedLocations: ['Seattle'], location: 'Seattle' };
    it('sends role and home always, other fields only when changed', () => {
        expect(userEditFields({ ...start, role: 'manager' }, start)).toEqual({ role: 'manager', location: 'Seattle' });
        expect(userEditFields({ ...start, email: ' a@b.co ', assignedLocations: ['Seattle', 'Kent'] }, start))
            .toEqual({ role: 'driver', location: 'Seattle', email: 'a@b.co', assignedLocations: ['Seattle', 'Kent'] });
    });
});

describe('userToFormValues', () => {
    it('loads an account into the form', () => {
        expect(userToFormValues({
            displayName: ' Ana ', email: 'ana@x.com', username: 'ana', joiningDate: '2025-02-03T00:00:00.000Z',
            role: 'csr', assignedLocations: ['Dallas', 'Seattle'], location: 'Seattle'
        })).toEqual({
            displayName: 'Ana', email: 'ana@x.com', username: 'ana', joiningDate: '2025-02-03',
            role: 'csr', assignedLocations: ['Dallas', 'Seattle'], location: 'Seattle', signInMethod: 'keep', password: ''
        });
    });
    it('copes with older accounts: no joining date, a home that is no longer theirs', () => {
        const v = userToFormValues({ username: 'old', role: 'driver', assignedLocations: ['Dallas'], location: 'Seattle' });
        expect(v.joiningDate).toBe('');
        expect(v.location).toBe('Dallas');
        expect(v.displayName).toBe('');
    });
});

describe('lastChangedText', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    it('names who changed it and when', () => {
        expect(lastChangedText({ editedBy: 'krish', editedAt: '2026-10-03T15:00:00Z' }, now)).toBe('Last changed by krish · Oct 3');
    });
    it('falls back to when the account was added', () => {
        expect(lastChangedText({ createdAt: '2026-09-12T15:00:00Z' }, now)).toBe('Added Sep 12');
    });
    it('shows the year when it isn’t this year, and nothing when there’s nothing to say', () => {
        expect(lastChangedText({ createdAt: '2024-09-12T15:00:00Z' }, now)).toBe('Added Sep 12, 2024');
        expect(lastChangedText({}, now)).toBe('');
    });
});
