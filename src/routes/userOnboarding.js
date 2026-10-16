/**
 * Getting a new staff account signed in for the first time — the parts of Add
 * User (Users & Roles) that aren't plain CRUD — and changing your password:
 *
 *   GET  /api/admin/users/username-available  live "✓ Available" check
 *   GET  /api/auth/setup                      is this browser mid first-password?
 *   POST /api/auth/first-password             temp password → their own, signed in
 *   GET  /api/auth/invite/:token              is this invite link still good?
 *   POST /api/auth/accept-invite              invite link → their own, signed in
 *   POST /api/auth/change-password            Profile → Change password
 *   POST /api/admin/users/:id/unlock          Edit user → Unlock now
 *
 * plus the helpers POST /api/admin/users (server.js) uses to issue an invite.
 *
 * Temporary password: signing in with it on /login (or the old /admin/login)
 * gets a setup session, not a real one (src/services/staffSession.js), and
 * the app opens on "Choose your password" (ChoosePasswordCard). Saving it here
 * signs them in for real. It's single-use and lasts 7 days.
 *
 * Invite link: /set-password?token=… — they choose a password and are signed
 * straight in. The token is single-use, 7 days, and only its hash is stored.
 *
 * Either way a session never exists while the account still has a password
 * someone else chose, and choosing one ends every older session.
 */
import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { sendEmail } from '../services/emailService.js';
import { usernameProblem, PASSWORD_MIN } from '../utils/userForm.js';
import { displayNameOf } from '../utils/salesReps.js';
import {
  applyOwnPassword, clearPasswordSetup, clearSignInLock, readSetupToken, sessionVersionOf,
  startStaffSession, tempPasswordExpired
} from '../services/staffSession.js';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/**
 * A fresh invite for a new account: the token goes in the emailed link, only
 * its hash is stored. `password` is an unguessable placeholder so the account
 * satisfies the model (password is required) but can't be signed into until
 * the invite is accepted.
 */
export const newInvite = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    fields: {
      inviteTokenHash: hashToken(token),
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
      mustChangePassword: false
    },
    placeholderPassword: crypto.randomBytes(24).toString('base64url')
  };
};

/**
 * Where the invite link should point. The admin's own browser origin when it
 * sent one (it already passed CORS, so it's one of our sites — and it's the
 * site they actually use, which FRONTEND_URL may not be in development),
 * otherwise the configured site.
 */
export const inviteLinkFor = (req, token) => {
  const base = (req.get('origin') || process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  return `${base}/set-password?token=${encodeURIComponent(token)}`;
};

/** Sends the invite email. Resolves to true when it went out. */
export const sendInviteEmail = async ({ to, name, username, link, invitedBy, reset = false }) => {
  const safeName = escapeHtml(name);
  const html = reset ? `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 12px">Choose a new password, ${safeName}</h2>
      <p style="margin:0 0 12px;line-height:1.5">${escapeHtml(invitedBy || 'An administrator')} sent you a link to choose a new password for <strong>${escapeHtml(username)}</strong>.
      Your current password keeps working until you do.</p>
      <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#c9a227;color:#1f1a08;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">Choose a new password</a></p>
      <p style="margin:0;font-size:13px;color:#5a6574;line-height:1.5">The link works once and expires in 7 days. If the button doesn’t work, paste this into your browser:<br>${escapeHtml(link)}</p>
    </div>` : `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 12px">Welcome to Easy Stones, ${safeName}</h2>
      <p style="margin:0 0 12px;line-height:1.5">${escapeHtml(invitedBy || 'An administrator')} has set up your account.
      Your username is <strong>${escapeHtml(username)}</strong>.</p>
      <p style="margin:0 0 20px;line-height:1.5">Choose your password and you’re in — the link works once and expires in 7 days.</p>
      <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#c9a227;color:#1f1a08;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">Choose my password</a></p>
      <p style="margin:0;font-size:13px;color:#5a6574;line-height:1.5">If the button doesn’t work, paste this into your browser:<br>${escapeHtml(link)}</p>
    </div>`;
  try {
    const result = await sendEmail({ to, subject: reset ? 'Choose a new Easy Stones password' : 'Your Easy Stones account', html, defaultSenderName: 'Easy Stones' });
    return result?.success !== false;
  } catch (err) {
    console.error('Invite email failed:', err?.message || err);
    return false;
  }
};

export default function createUserOnboardingRouter({ authenticate, requirePermission, loginLimiter, jwtSecret }) {
  const router = express.Router();

  router.get('/admin/users/username-available', authenticate, requirePermission('manage_users'), async (req, res) => {
    const username = String(req.query.username || '').trim().toLowerCase();
    const problem = usernameProblem(username);
    if (problem) return res.json({ available: false, reason: problem });
    try {
      const taken = await User.exists({ username });
      res.json(taken ? { available: false, reason: 'Someone already has this username' } : { available: true });
    } catch {
      res.status(500).json({ message: 'Could not check that username' });
    }
  });

  // Who the setup session is for, re-read live: an admin who reset the account
  // again, deactivated it, or let the 7 days run out ends it here.
  const setupUser = async (req) => {
    const setup = readSetupToken(req, jwtSecret);
    if (!setup || !mongoose.isValidObjectId(setup.userId)) return null;
    const user = await User.findById(setup.userId);
    if (!user || user.isActive === false || !user.mustChangePassword
      || tempPasswordExpired(user) || sessionVersionOf(user) !== setup.sv) return null;
    return user;
  };

  const passwordProblem = (password) => (String(password || '').length < PASSWORD_MIN
    ? `Choose at least ${PASSWORD_MIN} characters.` : null);

  const signedIn = (res, user) => ({
    success: true,
    username: user.username,
    token: startStaffSession(res, user, jwtSecret),
    user: { id: user._id, username: user.username, contactName: displayNameOf(user) || user.email, email: user.email, role: user.role, type: 'internal' }
  });

  router.get('/auth/setup', loginLimiter, async (req, res) => {
    try {
      const user = await setupUser(req);
      if (!user) {
        clearPasswordSetup(res);
        return res.json({ pending: false });
      }
      res.json({ pending: true, username: user.username, name: displayNameOf(user) || user.username });
    } catch {
      res.status(500).json({ pending: false, message: 'Server error' });
    }
  });

  // From the setup session (the current app), or — for a page cached from
  // before it — the username and temporary password again in the body.
  router.post('/auth/first-password', loginLimiter, async (req, res) => {
    try {
      const { username, currentPassword, newPassword } = req.body || {};
      let user = await setupUser(req);
      if (!user) {
        if (!username || !currentPassword) {
          clearPasswordSetup(res);
          return res.status(401).json({ success: false, code: 'setup-expired', message: 'This sign-in timed out. Sign in again with your temporary password.' });
        }
        user = await User.findOne({ username: String(username).toLowerCase() });
        if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        if (user.isLocked()) {
          return res.status(423).json({ success: false, message: 'Account locked due to too many failed attempts. Try again in 15 minutes.' });
        }
        if (!(await user.comparePassword(String(currentPassword)))) {
          await user.incLoginAttempts();
          return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        if (user.isActive === false) {
          return res.status(403).json({ success: false, message: 'This account has been deactivated. Contact an administrator.' });
        }
        if (!user.mustChangePassword) {
          return res.status(400).json({ success: false, message: 'This account already has its own password — just sign in.' });
        }
        if (tempPasswordExpired(user)) {
          return res.status(403).json({ success: false, code: 'temp-password-expired', message: 'This temporary password has expired. Ask an administrator for a new one.' });
        }
      }
      const problem = passwordProblem(newPassword);
      if (problem) return res.status(400).json({ success: false, message: problem });
      if (await user.comparePassword(String(newPassword))) {
        return res.status(400).json({ success: false, message: 'Choose a different password from the temporary one.' });
      }
      applyOwnPassword(user, String(newPassword));
      await user.save();
      res.json(signedIn(res, user));
    } catch (err) {
      console.error('first-password error:', err);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  const findInvite = async (token) => {
    if (!token) return null;
    const user = await User.findOne({ inviteTokenHash: hashToken(token) }).select('+inviteTokenHash');
    if (!user || !user.inviteExpiresAt || user.inviteExpiresAt.getTime() < Date.now() || user.isActive === false) return null;
    return user;
  };

  router.get('/auth/invite/:token', loginLimiter, async (req, res) => {
    try {
      const user = await findInvite(req.params.token);
      if (!user) return res.json({ valid: false });
      res.json({ valid: true, username: user.username, name: String(user.displayName || '').trim() || user.username });
    } catch {
      res.status(500).json({ valid: false, message: 'Server error' });
    }
  });

  // The link came to their email and works once, so using it is as good as a
  // sign-in: they land in the app.
  router.post('/auth/accept-invite', loginLimiter, async (req, res) => {
    try {
      const { token, newPassword } = req.body || {};
      const problem = passwordProblem(newPassword);
      if (problem) return res.status(400).json({ success: false, message: problem });
      const user = await findInvite(token);
      if (!user) {
        return res.status(410).json({ success: false, code: 'invite-invalid', message: 'This link has expired or was already used. Ask an administrator for a new one.' });
      }
      // Claim it before anything else: of two submits racing on one link,
      // only the one that clears the hash goes on.
      const claimed = await User.updateOne(
        { _id: user._id, inviteTokenHash: hashToken(token) },
        { $set: { inviteTokenHash: null, inviteExpiresAt: null } }
      );
      if (!claimed.modifiedCount) {
        return res.status(410).json({ success: false, code: 'invite-invalid', message: 'This link has expired or was already used. Ask an administrator for a new one.' });
      }
      user.inviteTokenHash = null;
      user.inviteExpiresAt = null;
      applyOwnPassword(user, String(newPassword));
      await user.save();
      res.json(signedIn(res, user));
    } catch (err) {
      console.error('accept-invite error:', err);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Profile → Change password (and the old /admin screen). Ends their other
  // sessions; this browser gets a fresh one so it stays signed in.
  router.post('/auth/change-password', authenticate, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Current password and new password are required' });
      }
      const user = await User.findById(req.userId || req.user?.id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (!(await user.comparePassword(String(currentPassword)))) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect' });
      }
      const problem = passwordProblem(newPassword);
      if (problem) return res.status(400).json({ success: false, message: problem });
      if (String(newPassword) === String(currentPassword)) {
        return res.status(400).json({ success: false, message: 'Choose a different password from your current one.' });
      }
      applyOwnPassword(user, String(newPassword));
      await user.save();
      const token = startStaffSession(res, user, jwtSecret);
      res.json({ success: true, message: 'Password updated successfully', token });
    } catch (err) {
      console.error('change-password error:', err);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Edit user → Unlock now: lifts a lock from too many wrong passwords
  // without waiting out its 15 minutes. Their password doesn't change and
  // they stay signed in wherever they already are.
  router.post('/admin/users/:id/unlock', authenticate, requirePermission('manage_users'), async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
      clearSignInLock(user);
      user.editedBy = req.user?.username || '';
      user.editedAt = new Date();
      await user.save();
      res.json({
        success: true,
        user: { _id: user._id, loginAttempts: 0, lockUntil: null, editedBy: user.editedBy, editedAt: user.editedAt }
      });
    } catch (err) {
      console.error('unlock error:', err);
      res.status(500).json({ message: 'Could not unlock this account' });
    }
  });

  return router;
}
