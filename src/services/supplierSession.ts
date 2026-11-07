/**
 * Supplier portal sign-in (2026-11-07). A supplier never gets a staff session:
 *
 *   - Their token is signed with a key *derived* from JWT_SECRET (HMAC
 *     "supplier-portal"), so every staff check — authenticate, the socket
 *     room join, /api/auth/* — sees an invalid signature. A staff token
 *     fails here the same way. Nothing has to remember to refuse the other.
 *   - Its cookie is scoped to /api/supplier-portal, so the browser never sends
 *     it anywhere else.
 *   - Every request reads the login and its supplier fresh: turning a login
 *     off, a supplier going inactive or a password change (sessionVersion)
 *     ends the session on the next request.
 *
 * Invite and reset links are single use, 7 days, only their hash stored.
 * Five wrong passwords lock the login for 15 minutes (the staff rule).
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import type mongoose from 'mongoose';
import { Supplier, SupplierLogin } from '../models/Suppliers.ts';

export const SUPPLIER_COOKIE = 'supplierToken';
export const SUPPLIER_COOKIE_PATH = '/api/supplier-portal';
export const SUPPLIER_SESSION_DAYS = 14;
export const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60 * 1000;
const SEEN_EVERY_MS = 5 * 60 * 1000;

export const supplierKey = (secret: string) => crypto.createHmac('sha256', String(secret)).update('supplier-portal').digest('hex');
export const hashLinkToken = (token: string) => crypto.createHash('sha256').update(String(token)).digest('hex');

const cookieBase = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // The portal and its API are one origin; lax keeps the cookie off cross-site posts.
  sameSite: 'lax',
  path: SUPPLIER_COOKIE_PATH
});

type LoginLike = { _id: unknown; supplierId: string; sessionVersion?: number | null };

export const signSupplierToken = (login: LoginLike, secret: string) => jwt.sign(
  { sl: String(login._id), sup: login.supplierId, sv: Number(login.sessionVersion) || 0 },
  supplierKey(secret),
  { expiresIn: `${SUPPLIER_SESSION_DAYS}d` }
);

export function startSupplierSession(res: Response, login: LoginLike, secret: string) {
  res.cookie(SUPPLIER_COOKIE, signSupplierToken(login, secret), { ...cookieBase(), maxAge: SUPPLIER_SESSION_DAYS * 24 * 60 * 60 * 1000 });
}
export const endSupplierSession = (res: Response) => res.clearCookie(SUPPLIER_COOKIE, cookieBase());

/** { loginId, supplierId, sv } from the request's cookie, or null. */
export function readSupplierToken(req: Pick<Request, 'cookies'>, secret: string) {
  const token = req.cookies?.[SUPPLIER_COOKIE];
  if (!token || typeof token !== 'string') return null;
  try {
    const d = jwt.verify(token, supplierKey(secret)) as jwt.JwtPayload;
    return d.sl && d.sup ? { loginId: String(d.sl), supplierId: String(d.sup), sv: Number(d.sv) || 0 } : null;
  } catch {
    return null;
  }
}

export type SupplierPrincipal = {
  loginId: string;
  supplierId: string;
  name: string;
  email: string;
  language: string;
  supplierName: string;
  supplierLanguage: string;
};
export const supplierOf = (req: Request) => (req as Request & { supplier: SupplierPrincipal }).supplier;

/** Lets a request through only with a current supplier session; sets req.supplier. */
export const authenticateSupplier = (secret: string) => async (req: Request, res: Response, next: NextFunction) => {
  const read = readSupplierToken(req, secret);
  if (!read) return res.status(401).json({ message: 'Sign in again.', code: 'signin' });
  try {
    const login = await SupplierLogin.findById(read.loginId).lean();
    if (!login || login.supplierId !== read.supplierId || (Number(login.sessionVersion) || 0) !== read.sv || login.active === false) {
      endSupplierSession(res);
      return res.status(401).json({ message: 'Sign in again.', code: login?.active === false ? 'loginOff' : 'signin' });
    }
    const supplier = await Supplier.findById(login.supplierId, 'name language active').lean();
    if (!supplier || supplier.active === false) {
      endSupplierSession(res);
      return res.status(401).json({ message: 'Sign in again.', code: 'loginOff' });
    }
    (req as Request & { supplier: SupplierPrincipal }).supplier = {
      loginId: String(login._id), supplierId: login.supplierId, name: login.name, email: login.email,
      language: login.language || supplier.language || 'en', supplierName: supplier.name, supplierLanguage: supplier.language || 'en'
    };
    // "Last seen" on the Suppliers tab, written at most every 5 minutes.
    if (!login.lastSeenAt || Date.now() - new Date(login.lastSeenAt).getTime() > SEEN_EVERY_MS) {
      SupplierLogin.updateOne({ _id: login._id }, { $set: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    next();
  } catch (error) {
    console.error('[supplier-portal] session check failed:', error);
    res.status(500).json({ message: 'Something went wrong. Try again.' });
  }
};

/** A fresh invite / reset link: the token goes in the email, the hash on the login. */
export function newLink(now = Date.now()) {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, fields: { linkTokenHash: hashLinkToken(token), linkExpiresAt: new Date(now + LINK_TTL_MS) } };
}

export const isLocked = (login: { lockUntil?: Date | null }, now = Date.now()) => Boolean(login.lockUntil && new Date(login.lockUntil).getTime() > now);

/**
 * Checks a password, counting wrong ones towards the lock. Answers 'ok',
 * 'wrong', 'locked' or 'off'. A login with no password yet (invite not
 * accepted) is 'wrong', never a way in.
 */
export async function checkPassword(login: mongoose.HydratedDocument<{ password?: string | null; active?: boolean | null; loginAttempts?: number | null; lockUntil?: Date | null }>, password: string, now = Date.now()) {
  if (isLocked(login, now)) return 'locked' as const;
  const ok = Boolean(login.password) && await bcrypt.compare(String(password || ''), String(login.password));
  if (!ok) {
    const expired = login.lockUntil && new Date(login.lockUntil).getTime() <= now;
    const attempts = (expired ? 0 : Number(login.loginAttempts) || 0) + 1;
    login.set({ loginAttempts: attempts, lockUntil: attempts >= MAX_ATTEMPTS ? new Date(now + LOCK_MS) : (expired ? null : login.lockUntil) });
    await login.save();
    return attempts >= MAX_ATTEMPTS ? 'locked' as const : 'wrong' as const;
  }
  if (login.active === false) return 'off' as const;
  return 'ok' as const;
}

