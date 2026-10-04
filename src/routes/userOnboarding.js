/**
 * Getting a new staff account signed in for the first time — the parts of Add
 * User (Users & Roles) that aren't plain CRUD:
 *
 *   GET  /api/admin/users/username-available  live "✓ Available" check
 *   POST /api/auth/first-password             temp password → their own
 *   GET  /api/auth/invite/:token              is this invite link still good?
 *   POST /api/auth/accept-invite              invite link → their own password
 *
 * plus the helpers POST /api/admin/users (server.js) uses to issue an invite.
 *
 * A temporary password is single-use by design: the account is created with
 * mustChangePassword, and /api/auth/login (and the customer login, which staff
 * can also use) answer it with code 'must-change-password' and no session.
 * The login page then asks for a new password and calls first-password, which
 * re-checks the temporary one before replacing it — so a session never exists
 * while the account still has a password someone else chose.
 */
import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js';
import { sendEmail } from '../services/emailService.js';
import { usernameProblem, PASSWORD_MIN } from '../utils/userForm.js';

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
  return `${base}/admin/set-password?token=${encodeURIComponent(token)}`;
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
      <p style="margin:0 0 20px;line-height:1.5">Choose your password to finish — the link works once and expires in 7 days.</p>
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

export default function createUserOnboardingRouter({ authenticate, requirePermission, loginLimiter }) {
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

  router.post('/auth/first-password', loginLimiter, async (req, res) => {
    try {
      const { username, currentPassword, newPassword } = req.body || {};
      if (!username || !currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Username, current and new password are required' });
      }
      const user = await User.findOne({ username: String(username).toLowerCase() });
      if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
      if (user.isLocked()) {
        return res.status(423).json({ success: false, message: 'Account locked due to too many failed attempts. Try again in 15 minutes.' });
      }
      if (!(await user.comparePassword(currentPassword))) {
        await user.incLoginAttempts();
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
      if (user.isActive === false) {
        return res.status(403).json({ success: false, message: 'This account has been deactivated. Contact an administrator.' });
      }
      if (!user.mustChangePassword) {
        return res.status(400).json({ success: false, message: 'This account already has its own password — just sign in.' });
      }
      if (String(newPassword).length < PASSWORD_MIN) {
        return res.status(400).json({ success: false, message: `Choose at least ${PASSWORD_MIN} characters.` });
      }
      if (newPassword === currentPassword) {
        return res.status(400).json({ success: false, message: 'Choose a different password from the temporary one.' });
      }
      user.password = newPassword; // hashed by the model's pre-save hook
      user.mustChangePassword = false;
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
      res.json({ success: true });
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

  router.post('/auth/accept-invite', loginLimiter, async (req, res) => {
    try {
      const { token, newPassword } = req.body || {};
      if (String(newPassword || '').length < PASSWORD_MIN) {
        return res.status(400).json({ success: false, message: `Choose at least ${PASSWORD_MIN} characters.` });
      }
      const user = await findInvite(token);
      if (!user) {
        return res.status(410).json({ success: false, code: 'invite-invalid', message: 'This link has expired or was already used. Ask an administrator for a new one.' });
      }
      user.password = newPassword;
      user.inviteTokenHash = null;
      user.inviteExpiresAt = null;
      user.mustChangePassword = false;
      await user.save();
      res.json({ success: true, username: user.username });
    } catch (err) {
      console.error('accept-invite error:', err);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  return router;
}
