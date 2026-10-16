// Staff sessions and the setup session a temporary password gets: the setup
// token can't pass for a real one anywhere, it's cookie-scoped to /api/auth,
// temporary passwords expire, and a password change ends older sessions.
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  sessionIsCurrent, sessionVersionOf, tempPasswordExpired, temporaryPasswordFields,
  applyOwnPassword, signSetupToken, readSetupToken, signStaffSession, setupKey,
  temporaryPasswordAnswer, startStaffSession, TEMP_PASSWORD_TTL_MS, SETUP_COOKIE,
  SETUP_COOKIE_PATH, SESSION_COOKIE, LEGACY_SESSION_COOKIE
} from './staffSession.js';

const SECRET = 'test-secret';
const user = (over = {}) => ({ _id: '64b7f0c2a1b2c3d4e5f60718', username: 'rita', ...over });

// Records what a route did to the response's cookies.
const fakeRes = () => {
  const set = {};
  const cleared = {};
  return {
    set, cleared,
    cookie: (name, value, opts) => { set[name] = { value, opts }; },
    clearCookie: (name, opts) => { cleared[name] = opts; }
  };
};

describe('session version', () => {
  it('a token and an account from before it existed both count as 0', () => {
    expect(sessionVersionOf({})).toBe(0);
    expect(sessionIsCurrent({ id: 'x' }, {})).toBe(true);
    expect(sessionIsCurrent({ id: 'x' }, { sessionVersion: 0 })).toBe(true);
  });

  it('a token signed before the password changed is no longer current', () => {
    expect(sessionIsCurrent({ sv: 0 }, { sessionVersion: 1 })).toBe(false);
    expect(sessionIsCurrent({ sv: 2 }, { sessionVersion: 2 })).toBe(true);
  });

  it('a full session carries the account\'s version', () => {
    const decoded = jwt.verify(signStaffSession(user({ sessionVersion: 3 }), SECRET), SECRET);
    expect(decoded).toMatchObject({ id: user()._id, type: 'internal', sv: 3 });
  });
});

describe('temporary passwords', () => {
  it('last 7 days from when they were set', () => {
    const now = Date.UTC(2026, 9, 15);
    const fields = temporaryPasswordFields(now);
    expect(fields.mustChangePassword).toBe(true);
    expect(fields.tempPasswordExpiresAt.getTime()).toBe(now + TEMP_PASSWORD_TTL_MS);
    const u = user(fields);
    expect(tempPasswordExpired(u, now + TEMP_PASSWORD_TTL_MS - 1)).toBe(false);
    expect(tempPasswordExpired(u, now + TEMP_PASSWORD_TTL_MS)).toBe(true);
  });

  it('one given before expiry existed (no date) doesn\'t expire', () => {
    expect(tempPasswordExpired(user({ mustChangePassword: true, tempPasswordExpiresAt: null }))).toBe(false);
  });

  it('an account with its own password is never "expired"', () => {
    expect(tempPasswordExpired(user({ mustChangePassword: false, tempPasswordExpiresAt: new Date(0) }))).toBe(false);
  });

  it('choosing your own clears it, unlocks, and bumps the session version', () => {
    const u = user({ mustChangePassword: true, tempPasswordExpiresAt: new Date(), loginAttempts: 3, lockUntil: new Date(), sessionVersion: 1 });
    applyOwnPassword(u, 'mine-now');
    expect(u).toMatchObject({ password: 'mine-now', mustChangePassword: false, tempPasswordExpiresAt: null, loginAttempts: 0, sessionVersion: 2 });
    expect(u.lockUntil).toBeUndefined();
  });
});

describe('the setup token', () => {
  it('fails every ordinary token check — it isn\'t signed with JWT_SECRET', () => {
    const token = signSetupToken(user(), SECRET);
    expect(() => jwt.verify(token, SECRET)).toThrow();
    expect(setupKey(SECRET)).not.toBe(SECRET);
  });

  it('carries no id an ordinary check would read', () => {
    const payload = jwt.decode(signSetupToken(user(), SECRET));
    expect(payload.id).toBeUndefined();
    expect(payload.userId).toBeUndefined();
    expect(payload.sub).toBeUndefined();
    expect(payload.setup).toBe(user()._id);
  });

  it('is read back from its own cookie only', () => {
    const token = signSetupToken(user({ sessionVersion: 4 }), SECRET);
    expect(readSetupToken({ cookies: { [SETUP_COOKIE]: token } }, SECRET)).toEqual({ userId: user()._id, sv: 4 });
    expect(readSetupToken({ cookies: { [SESSION_COOKIE]: token } }, SECRET)).toBe(null);
    expect(readSetupToken({ cookies: {} }, SECRET)).toBe(null);
    expect(readSetupToken({}, SECRET)).toBe(null);
  });

  it('a full session token, a forged one, or an expired one is not a setup token', () => {
    expect(readSetupToken({ cookies: { [SETUP_COOKIE]: signStaffSession(user(), SECRET) } }, SECRET)).toBe(null);
    const forged = jwt.sign({ setup: user()._id }, SECRET);
    expect(readSetupToken({ cookies: { [SETUP_COOKIE]: forged } }, SECRET)).toBe(null);
    const expired = jwt.sign({ setup: user()._id, sv: 0 }, setupKey(SECRET), { expiresIn: -10 });
    expect(readSetupToken({ cookies: { [SETUP_COOKIE]: expired } }, SECRET)).toBe(null);
  });
});

describe('what a sign-in with the right password gets', () => {
  it('an account with its own password: a full session (null here)', () => {
    expect(temporaryPasswordAnswer(fakeRes(), user({ mustChangePassword: false }), SECRET)).toBe(null);
  });

  it('a temporary password: the setup cookie, scoped to /api/auth, and any session on the browser ended', () => {
    const res = fakeRes();
    const answer = temporaryPasswordAnswer(res, user(temporaryPasswordFields()), SECRET);
    expect(answer.expired).toBe(false);
    expect(answer.body).toMatchObject({ success: false, code: 'must-change-password', setup: true });
    expect(res.set[SETUP_COOKIE].opts).toMatchObject({ httpOnly: true, path: SETUP_COOKIE_PATH });
    expect(res.set[SETUP_COOKIE].opts.maxAge).toBe(30 * 60 * 1000);
    expect(res.set[SESSION_COOKIE]).toBeUndefined();
    expect(res.cleared).toHaveProperty(SESSION_COOKIE);
    expect(res.cleared).toHaveProperty(LEGACY_SESSION_COOKIE);
  });

  it('an expired temporary password: refused, and no cookie at all', () => {
    const res = fakeRes();
    const answer = temporaryPasswordAnswer(res, user(temporaryPasswordFields(Date.now() - TEMP_PASSWORD_TTL_MS - 1000)), SECRET);
    expect(answer.expired).toBe(true);
    expect(answer.body.code).toBe('temp-password-expired');
    expect(res.set).toEqual({});
  });

  it('a full session clears a leftover legacy token and setup cookie', () => {
    const res = fakeRes();
    const token = startStaffSession(res, user(), SECRET);
    expect(res.set[SESSION_COOKIE].value).toBe(token);
    expect(res.set[SESSION_COOKIE].opts.httpOnly).toBe(true);
    expect(res.cleared).toHaveProperty(LEGACY_SESSION_COOKIE);
    expect(res.cleared[SETUP_COOKIE]).toMatchObject({ path: SETUP_COOKIE_PATH });
  });
});
