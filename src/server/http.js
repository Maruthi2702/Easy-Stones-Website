/**
 * Shared building blocks for the app's newer API modules (Holds & Cart first,
 * 2026-10-10), so each one doesn't carry its own copy of the same plumbing:
 *
 *   HttpError           throw it anywhere in a handler to answer with a status
 *   handle(fn)          runs a handler, maps errors to readable JSON replies
 *   requireAll/Any(...) permission checks — permissions only, never role names
 *   parse(schema, data) zod input check that answers 400 with one sentence
 *   inTransaction(fn)   all of it lands, or none of it
 *   checkVersion(...)   a stale screen can't overwrite someone else's change
 *   actorOf(req)        { id, name } of whoever is making the request
 *
 * Server-only.
 */
import mongoose from 'mongoose';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const NO_ACCESS = 'Your role doesn’t have access to this. Ask an admin to turn it on under Users & Roles.';

export const hasPermission = (user, perm) => Array.isArray(user?.permissions) && user.permissions.includes(perm);

/** Every one of these permissions. */
export const requireAll = (...perms) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (perms.every((p) => hasPermission(req.user, p))) return next();
  return res.status(403).json({ error: NO_ACCESS });
};

/** Any one of these permissions. */
export const requireAny = (...perms) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (perms.some((p) => hasPermission(req.user, p))) return next();
  return res.status(403).json({ error: NO_ACCESS });
};

/** The first problem zod found, as one sentence for the screen. */
export const firstIssue = (error) => {
  const issue = error?.issues?.[0];
  if (!issue) return 'Check the form and try again.';
  if (issue.code === 'unrecognized_keys') return `Unexpected field: ${issue.keys.join(', ')}.`;
  return issue.message;
};

export const parse = (schema, data) => {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw new HttpError(400, firstIssue(result.error));
  return result.data;
};

/** Runs `fn(session)` as one MongoDB transaction and returns what it returns. */
export async function inTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => { out = await fn(session); });
    return out;
  } finally {
    await session.endSession();
  }
}

/** 409 when the document changed since the person loaded it. */
export const checkVersion = (doc, version, what = 'This') => {
  if (doc.__v !== version) {
    throw new HttpError(409, `${what} was changed by someone else. Reload to see the latest, then try again.`);
  }
};

export const actorOf = (req) => ({
  id: String(req.user?.id || ''),
  name: req.user?.displayName || req.user?.username || ''
});

/** Wraps an async handler: HttpError → its status; clashes → 409; anything else → 500 (logged). */
export const handle = (fn, { label = 'api' } = {}) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err?.code === 11000) return res.status(409).json({ error: 'That already exists — reload and check before trying again.' });
    if (err?.name === 'VersionError') return res.status(409).json({ error: 'Someone else changed this at the same moment. Reload and try again.' });
    console.error(`[${label}]`, req.method, req.originalUrl, err);
    return res.status(500).json({ error: 'Something went wrong on our side. Nothing was changed.' });
  }
};

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
