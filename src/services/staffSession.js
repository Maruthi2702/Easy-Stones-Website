/**
 * Staff sign-in sessions, and the limited one a temporary password gets.
 *
 * A full session is the `customerToken` cookie (the name the unified /login
 * has always used for staff too) holding { id, type: 'internal', sv }. `sv` is
 * the account's sessionVersion: bumping it on any password change ends every
 * session signed in before it (sessionIsCurrent, checked by authenticate).
 *
 * A temporary password (Add User / Edit user → Temporary password) never gets
 * a full session. It gets a **setup session**: a 30-minute token whose only
 * use is choosing their own password (src/routes/userOnboarding.js). It is
 * locked out of everything else twice over:
 *   - it's signed with a key derived from JWT_SECRET, not JWT_SECRET itself,
 *     so every other place that checks a token (authenticate, the socket room
 *     join, the calendar link, /api/auth/verify…) sees an invalid signature;
 *   - its cookie is scoped to /api/auth, so the browser never even sends it
 *     to any other route.
 * Nothing has to remember to refuse it — a new route can't let it in by
 * forgetting a check.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export const SESSION_HOURS = 10;
export const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;
export const SETUP_MINUTES = 30;
export const TEMP_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'customerToken';
export const LEGACY_SESSION_COOKIE = 'adminToken';
export const SETUP_COOKIE = 'staffSetupToken';
export const SETUP_COOKIE_PATH = '/api/auth';

const isProd = () => process.env.NODE_ENV === 'production';

// Same flags the unified login has always set, so clearing matches setting.
const cookieBase = () => ({
  httpOnly: true,
  secure: isProd(),
  sameSite: isProd() ? 'none' : 'lax'
});

export const sessionVersionOf = (user) => Number(user?.sessionVersion) || 0;

/** A token from before `sv` existed counts as 0 — so does an account without one. */
export const sessionIsCurrent = (decoded, user) => (Number(decoded?.sv) || 0) === sessionVersionOf(user);

/** True when the account is on a temporary password whose 7 days are up. */
export const tempPasswordExpired = (user, now = Date.now()) => {
  if (!user?.mustChangePassword || !user.tempPasswordExpiresAt) return false;
  return new Date(user.tempPasswordExpiresAt).getTime() <= now;
};

/** Fields for an account an admin just gave a temporary password. */
export const temporaryPasswordFields = (now = Date.now()) => ({
  mustChangePassword: true,
  tempPasswordExpiresAt: new Date(now + TEMP_PASSWORD_TTL_MS)
});

/**
 * Applies a password the person chose themselves (first password, invite link,
 * their own change): clears the temporary-password state and bumps the session
 * version, so every other session ends. Doesn't save.
 */
export const applyOwnPassword = (user, password) => {
  user.password = password; // hashed by the model's pre-save hook
  user.mustChangePassword = false;
  user.tempPasswordExpiresAt = null;
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  user.sessionVersion = sessionVersionOf(user) + 1;
};

// ── Full sessions ────────────────────────────────────────────────────────────

export const signStaffSession = (user, secret) => jwt.sign(
  { id: String(user._id), type: 'internal', sv: sessionVersionOf(user) },
  secret,
  { expiresIn: `${SESSION_HOURS}h` }
);

/**
 * Signs `user` in on this browser: their session cookie, and nothing else —
 * a leftover legacy adminToken (read first by authenticate) or setup cookie
 * would otherwise win over the session just issued. Returns the token, for the
 * page's in-memory copy (src/api/authToken.js).
 */
export const startStaffSession = (res, user, secret) => {
  const token = signStaffSession(user, secret);
  res.clearCookie(LEGACY_SESSION_COOKIE, cookieBase());
  res.clearCookie(SETUP_COOKIE, { ...cookieBase(), path: SETUP_COOKIE_PATH });
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(), maxAge: SESSION_MS });
  return token;
};

// ── Setup sessions ───────────────────────────────────────────────────────────

// HMAC, not the raw secret: a setup token must fail every ordinary jwt.verify.
export const setupKey = (secret) => crypto.createHmac('sha256', String(secret)).update('staff-password-setup').digest('hex');

export const signSetupToken = (user, secret) => jwt.sign(
  { setup: String(user._id), sv: sessionVersionOf(user) },
  setupKey(secret),
  { expiresIn: `${SETUP_MINUTES}m` }
);

/** { userId, sv } from this request's setup cookie, or null. */
export const readSetupToken = (req, secret) => {
  const token = req.cookies?.[SETUP_COOKIE];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, setupKey(secret));
    return decoded.setup ? { userId: decoded.setup, sv: Number(decoded.sv) || 0 } : null;
  } catch {
    return null;
  }
};

/**
 * Signed in with a temporary password: ends whatever session this browser had
 * (it would otherwise be the one the app keeps using) and starts a setup one.
 */
export const startPasswordSetup = (res, user, secret) => {
  res.clearCookie(SESSION_COOKIE, cookieBase());
  res.clearCookie(LEGACY_SESSION_COOKIE, cookieBase());
  res.cookie(SETUP_COOKIE, signSetupToken(user, secret), {
    ...cookieBase(),
    path: SETUP_COOKIE_PATH,
    maxAge: SETUP_MINUTES * 60 * 1000
  });
};

export const clearPasswordSetup = (res) => {
  res.clearCookie(SETUP_COOKIE, { ...cookieBase(), path: SETUP_COOKIE_PATH });
};

/**
 * What a staff sign-in with the right password gets, for both login routes:
 * null — a full session; otherwise the answer to send instead (and, for a
 * temporary password still in date, the setup cookie is already set).
 * Called only after the password matched, so it can't probe accounts.
 */
export const temporaryPasswordAnswer = (res, user, secret) => {
  if (!user.mustChangePassword) return null;
  if (tempPasswordExpired(user)) {
    return {
      expired: true,
      body: {
        success: false,
        code: 'temp-password-expired',
        message: 'This temporary password has expired. Ask an administrator for a new one.'
      }
    };
  }
  startPasswordSetup(res, user, secret);
  return {
    expired: false,
    body: {
      success: false,
      code: 'must-change-password',
      setup: true,
      // What a page cached from before this change shows (it doesn't know
      // `setup`); a reload gets the page that does.
      message: 'Refresh this page and sign in again to choose your own password.'
    }
  };
};
