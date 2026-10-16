// Getting a new staff account signed in, against a throwaway in-memory
// MongoDB: a temporary password gets only a setup session, which can do
// nothing but choose a password; choosing one signs them in for real; an
// invite link does the same once; and any password change ends older
// sessions.
//
// The two login routes and `authenticate` live in server.js, which can't be
// loaded in a test. `signIn` and `authenticate` below are stand-ins doing
// exactly what those do with src/services/staffSession.js — keep them in step.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('../services/emailService.js', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

const { default: createUserOnboardingRouter, newInvite, inviteLinkFor } = await import('./userOnboarding.js');
const { default: User } = await import('../models/User.js');
const {
  temporaryPasswordAnswer, temporaryPasswordFields, startStaffSession, sessionIsCurrent,
  sessionVersionOf, TEMP_PASSWORD_TTL_MS, SETUP_COOKIE, SESSION_COOKIE
} = await import('../services/staffSession.js');

const SECRET = 'test-secret';
let mongo;
let app;

const authenticate = async (req, res, next) => {
  const token = req.cookies.adminToken || req.cookies.customerToken
    || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'none' });
  let decoded;
  try {
    decoded = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid' });
  }
  const id = decoded.userId || decoded.id || decoded.sub;
  if (!id || !mongoose.isValidObjectId(id)) return res.status(401).json({ error: 'malformed' });
  const user = await User.findById(id).lean();
  if (!user || user.isActive === false) return res.status(401).json({ error: 'gone' });
  if (user.mustChangePassword || !sessionIsCurrent(decoded, user)) return res.status(401).json({ error: 'stale' });
  // Stand-in for the role lookup: admins can manage users, nobody else.
  req.user = { id: user._id, username: user.username, permissions: user.role === 'admin' ? ['manage_users'] : [] };
  req.userId = user._id;
  next();
};

// What /api/customer/login does for a staff account: locked → refused before
// the password is checked; a wrong one is counted towards the lock.
const signIn = async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (!user) return res.status(401).json({ message: 'Invalid' });
  if (user.isLocked()) return res.status(423).json({ message: 'Locked' });
  if (!(await user.comparePassword(req.body.password))) {
    await user.incLoginAttempts();
    return res.status(401).json({ message: 'Invalid' });
  }
  if (user.isActive === false) return res.status(403).json({ message: 'Deactivated' });
  const temporary = temporaryPasswordAnswer(res, user, SECRET);
  if (temporary) return res.status(403).json(temporary.body);
  startStaffSession(res, user, SECRET);
  res.json({ success: true });
};

// The cookie `name` a response set, as a request Cookie header ('' if none —
// or if it was being cleared).
const cookieFrom = (res, name) => {
  const line = (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`));
  if (!line) return '';
  const pair = line.split(';')[0];
  return pair === `${name}=` ? '' : pair;
};
const setCookieLine = (res, name) => (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`)) || '';

const makeUser = async (over = {}) => new User({
  username: 'rita', displayName: 'Rita Gomez', email: 'rita@x.com', role: 'sales_rep',
  password: 'Granite-4821-Ridge', ...temporaryPasswordFields(), ...over
}).save();

const login = (username = 'rita', password = 'Granite-4821-Ridge') => request(app).post('/api/test-login').send({ username, password });
const protectedWith = (cookie) => request(app).get('/api/protected').set('Cookie', cookie);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  const pass = (req, res, next) => next();
  app.post('/api/test-login', signIn);
  app.get('/api/protected', authenticate, (req, res) => res.json({ ok: true, username: req.user.username }));
  const requirePermission = (p) => (req, res, next) => (req.user?.permissions.includes(p) ? next() : res.status(403).json({ message: 'No' }));
  app.use('/api', createUserOnboardingRouter({ authenticate, requirePermission, loginLimiter: pass, jwtSecret: SECRET }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await User.collection.deleteMany({});
});

describe('signing in with a temporary password', () => {
  it('gets a setup session only — no real session cookie', async () => {
    await makeUser();
    const res = await login().expect(403);
    expect(res.body).toMatchObject({ code: 'must-change-password', setup: true });
    expect(cookieFrom(res, SESSION_COOKIE)).toBe('');
    expect(setCookieLine(res, SETUP_COOKIE)).toMatch(/Path=\/api\/auth/);
    expect(setCookieLine(res, SETUP_COOKIE)).toMatch(/HttpOnly/);
  });

  it('the setup session says who it is for', async () => {
    await makeUser();
    const setup = cookieFrom(await login(), SETUP_COOKIE);
    const res = await request(app).get('/api/auth/setup').set('Cookie', setup).expect(200);
    expect(res.body).toEqual({ pending: true, username: 'rita', name: 'Rita Gomez' });
  });

  it('no setup session: nothing pending', async () => {
    const res = await request(app).get('/api/auth/setup').expect(200);
    expect(res.body).toEqual({ pending: false });
  });

  it('the setup token opens nothing else, whichever way it is sent', async () => {
    await makeUser();
    const token = cookieFrom(await login(), SETUP_COOKIE).split('=')[1];
    await protectedWith(`${SETUP_COOKIE}=${token}`).expect(401);
    await protectedWith(`${SESSION_COOKIE}=${token}`).expect(401);
    await protectedWith(`adminToken=${token}`).expect(401);
    await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`).expect(401);
    // …including changing the password the ordinary way.
    await request(app).post('/api/auth/change-password').set('Cookie', `${SESSION_COOKIE}=${token}`)
      .send({ currentPassword: 'Granite-4821-Ridge', newPassword: 'my-own-pass' }).expect(401);
  });

  it('an expired temporary password is refused, with no setup session', async () => {
    await makeUser(temporaryPasswordFields(Date.now() - TEMP_PASSWORD_TTL_MS - 1000));
    const res = await login().expect(403);
    expect(res.body.code).toBe('temp-password-expired');
    expect(cookieFrom(res, SETUP_COOKIE)).toBe('');
  });

  it('a wrong temporary password gets nothing', async () => {
    await makeUser();
    const res = await login('rita', 'nope-nope').expect(401);
    expect(cookieFrom(res, SETUP_COOKIE)).toBe('');
  });
});

describe('POST /api/auth/first-password — choosing their own', () => {
  const choose = (cookie, newPassword) => request(app).post('/api/auth/first-password').set('Cookie', cookie).send({ newPassword });

  it('signs them in for real, and the temporary password stops working', async () => {
    await makeUser();
    const setup = cookieFrom(await login(), SETUP_COOKIE);
    const res = await choose(setup, 'my-own-pass').expect(200);
    expect(res.body).toMatchObject({ success: true, username: 'rita', user: { username: 'rita', type: 'internal' } });
    expect(res.body.token).toBeTruthy();
    const session = cookieFrom(res, SESSION_COOKIE);
    expect(session).not.toBe('');
    // The setup cookie is cleared on the way out.
    expect(cookieFrom(res, SETUP_COOKIE)).toBe('');
    expect((await protectedWith(session).expect(200)).body.username).toBe('rita');
    // So is the token the page keeps in memory.
    await request(app).get('/api/protected').set('Authorization', `Bearer ${res.body.token}`).expect(200);

    const saved = await User.findOne({ username: 'rita' });
    expect(saved.mustChangePassword).toBe(false);
    expect(saved.tempPasswordExpiresAt).toBe(null);
    expect(sessionVersionOf(saved)).toBe(1);
    await login('rita', 'Granite-4821-Ridge').expect(401);
    await login('rita', 'my-own-pass').expect(200);
  });

  it('works once — the same setup session can\'t set it again', async () => {
    await makeUser();
    const setup = cookieFrom(await login(), SETUP_COOKIE);
    await choose(setup, 'my-own-pass').expect(200);
    const again = await choose(setup, 'another-pass').expect(401);
    expect(again.body.code).toBe('setup-expired');
    await login('rita', 'my-own-pass').expect(200);
  });

  it('refuses a short password, or the temporary one again, and changes nothing', async () => {
    await makeUser();
    const setup = cookieFrom(await login(), SETUP_COOKIE);
    expect((await choose(setup, 'abc').expect(400)).body.message).toMatch(/at least 6/);
    expect((await choose(setup, 'Granite-4821-Ridge').expect(400)).body.message).toMatch(/different/);
    expect((await User.findOne({ username: 'rita' })).mustChangePassword).toBe(true);
    // The setup session still works for the next try.
    await choose(setup, 'my-own-pass').expect(200);
  });

  it('an admin resetting the account again ends the setup session', async () => {
    await makeUser();
    const setup = cookieFrom(await login(), SETUP_COOKIE);
    await User.updateOne({ username: 'rita' }, { $inc: { sessionVersion: 1 } });
    expect((await request(app).get('/api/auth/setup').set('Cookie', setup)).body.pending).toBe(false);
    expect((await choose(setup, 'my-own-pass').expect(401)).body.code).toBe('setup-expired');
  });

  it('deactivating the account ends the setup session', async () => {
    await makeUser();
    const setup = cookieFrom(await login(), SETUP_COOKIE);
    await User.updateOne({ username: 'rita' }, { $set: { isActive: false } });
    expect((await request(app).get('/api/auth/setup').set('Cookie', setup)).body.pending).toBe(false);
    await choose(setup, 'my-own-pass').expect(401);
  });

  it('the 7 days running out mid-setup ends it too', async () => {
    await makeUser();
    const setup = cookieFrom(await login(), SETUP_COOKIE);
    await User.updateOne({ username: 'rita' }, { $set: { tempPasswordExpiresAt: new Date(Date.now() - 1000) } });
    await choose(setup, 'my-own-pass').expect(401);
  });

  it('with no setup session and nothing else, it says to sign in again', async () => {
    const res = await request(app).post('/api/auth/first-password').send({ newPassword: 'my-own-pass' }).expect(401);
    expect(res.body.code).toBe('setup-expired');
  });

  describe('a page cached from before (username + temporary password in the body)', () => {
    const legacy = (body) => request(app).post('/api/auth/first-password').send(body);

    it('still works, and signs them in', async () => {
      await makeUser();
      const res = await legacy({ username: 'rita', currentPassword: 'Granite-4821-Ridge', newPassword: 'my-own-pass' }).expect(200);
      expect(cookieFrom(res, SESSION_COOKIE)).not.toBe('');
      await login('rita', 'my-own-pass').expect(200);
    });

    it('a wrong temporary password is refused and counted', async () => {
      await makeUser();
      await legacy({ username: 'rita', currentPassword: 'guess-guess', newPassword: 'my-own-pass' }).expect(401);
      expect((await User.findOne({ username: 'rita' })).loginAttempts).toBe(1);
    });

    it('an expired temporary password is refused', async () => {
      await makeUser(temporaryPasswordFields(Date.now() - TEMP_PASSWORD_TTL_MS - 1000));
      const res = await legacy({ username: 'rita', currentPassword: 'Granite-4821-Ridge', newPassword: 'my-own-pass' }).expect(403);
      expect(res.body.code).toBe('temp-password-expired');
    });

    it('an account with its own password can\'t use it', async () => {
      await makeUser({ mustChangePassword: false, tempPasswordExpiresAt: null });
      await legacy({ username: 'rita', currentPassword: 'Granite-4821-Ridge', newPassword: 'my-own-pass' }).expect(400);
    });
  });
});

describe('an emailed invite link', () => {
  const inviteUser = async (over = {}) => {
    const invite = newInvite();
    await makeUser({ password: invite.placeholderPassword, ...invite.fields, mustChangePassword: false, tempPasswordExpiresAt: null, ...over });
    return invite.token;
  };
  const accept = (token, newPassword = 'my-own-pass') => request(app).post('/api/auth/accept-invite').send({ token, newPassword });

  it('points at /set-password, not the admin pages', () => {
    const req = { get: (h) => (h === 'origin' ? 'https://app.easystones.com' : undefined) };
    expect(inviteLinkFor(req, 'abc')).toBe('https://app.easystones.com/set-password?token=abc');
  });

  it('says whose it is while it\'s good', async () => {
    const token = await inviteUser();
    const res = await request(app).get(`/api/auth/invite/${token}`).expect(200);
    expect(res.body).toEqual({ valid: true, username: 'rita', name: 'Rita Gomez' });
  });

  it('choosing a password signs them straight in', async () => {
    const token = await inviteUser();
    const res = await accept(token).expect(200);
    expect(res.body).toMatchObject({ success: true, username: 'rita', user: { type: 'internal' } });
    await protectedWith(cookieFrom(res, SESSION_COOKIE)).expect(200);
    await request(app).get('/api/protected').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    await login('rita', 'my-own-pass').expect(200);
  });

  it('works once', async () => {
    const token = await inviteUser();
    await accept(token).expect(200);
    expect((await accept(token, 'second-try').expect(410)).body.code).toBe('invite-invalid');
    expect((await request(app).get(`/api/auth/invite/${token}`)).body.valid).toBe(false);
    await login('rita', 'my-own-pass').expect(200);
  });

  it('two saves racing on one link: only one wins', async () => {
    const token = await inviteUser();
    const results = await Promise.all([accept(token, 'first-pass'), accept(token, 'second-pass')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
  });

  it('an expired link is refused', async () => {
    const token = await inviteUser({ inviteExpiresAt: new Date(Date.now() - 1000) });
    await accept(token).expect(410);
  });

  it('a short password is refused without using up the link', async () => {
    const token = await inviteUser();
    await accept(token, 'abc').expect(400);
    await accept(token).expect(200);
  });

  it('a deactivated account\'s link is refused', async () => {
    const token = await inviteUser({ isActive: false });
    await accept(token).expect(410);
  });

  it('a reset link ends the sessions they had before', async () => {
    await makeUser({ mustChangePassword: false, tempPasswordExpiresAt: null, password: 'old-own-pass' });
    const before = cookieFrom(await login('rita', 'old-own-pass'), SESSION_COOKIE);
    await protectedWith(before).expect(200);
    const invite = newInvite();
    await User.updateOne({ username: 'rita' }, { $set: { inviteTokenHash: invite.fields.inviteTokenHash, inviteExpiresAt: invite.fields.inviteExpiresAt } });
    await accept(invite.token).expect(200);
    await protectedWith(before).expect(401);
  });
});

describe('POST /api/auth/change-password', () => {
  const change = (cookie, body) => request(app).post('/api/auth/change-password').set('Cookie', cookie).send(body);
  const signedIn = async () => {
    await makeUser({ mustChangePassword: false, tempPasswordExpiresAt: null, password: 'old-own-pass' });
    return cookieFrom(await login('rita', 'old-own-pass'), SESSION_COOKIE);
  };

  it('keeps this browser signed in and ends every other session', async () => {
    const here = await signedIn();
    const elsewhere = cookieFrom(await login('rita', 'old-own-pass'), SESSION_COOKIE);
    const res = await change(here, { currentPassword: 'old-own-pass', newPassword: 'new-own-pass' }).expect(200);
    await protectedWith(cookieFrom(res, SESSION_COOKIE)).expect(200);
    await request(app).get('/api/protected').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    await protectedWith(elsewhere).expect(401);
    await protectedWith(here).expect(401);
    await login('rita', 'new-own-pass').expect(200);
  });

  it('a wrong current password is a 400, not a 401 (which would sign them out)', async () => {
    const here = await signedIn();
    await change(here, { currentPassword: 'wrong-wrong', newPassword: 'new-own-pass' }).expect(400);
    await protectedWith(here).expect(200);
  });

  it('refuses a short password or the same one', async () => {
    const here = await signedIn();
    await change(here, { currentPassword: 'old-own-pass', newPassword: 'abc' }).expect(400);
    await change(here, { currentPassword: 'old-own-pass', newPassword: 'old-own-pass' }).expect(400);
    await login('rita', 'old-own-pass').expect(200);
  });

  it('needs a session', async () => {
    await request(app).post('/api/auth/change-password').send({ currentPassword: 'a', newPassword: 'bbbbbbbb' }).expect(401);
  });
});

describe('an admin reset to a temporary password', () => {
  it('ends the sessions they already had', async () => {
    await makeUser({ mustChangePassword: false, tempPasswordExpiresAt: null, password: 'old-own-pass' });
    const before = cookieFrom(await login('rita', 'old-own-pass'), SESSION_COOKIE);
    await protectedWith(before).expect(200);
    // What PUT /api/admin/users/:id does for Sign-in → Temporary password.
    const user = await User.findOne({ username: 'rita' });
    user.password = 'Basalt-1234-Creek';
    Object.assign(user, temporaryPasswordFields());
    user.sessionVersion = sessionVersionOf(user) + 1;
    await user.save();
    await protectedWith(before).expect(401);
    expect((await login('rita', 'Basalt-1234-Creek').expect(403)).body.setup).toBe(true);
  });

  it('a session from before this change existed (no version) keeps working', async () => {
    const user = await makeUser({ mustChangePassword: false, tempPasswordExpiresAt: null });
    const legacy = jwt.sign({ id: String(user._id), type: 'internal' }, SECRET);
    await protectedWith(`${SESSION_COOKIE}=${legacy}`).expect(200);
    const legacyAdmin = jwt.sign({ userId: String(user._id), username: 'rita' }, SECRET);
    await protectedWith(`adminToken=${legacyAdmin}`).expect(200);
  });
});

describe('POST /api/admin/users/:id/unlock — Edit user → Unlock now', () => {
  const adminSession = async () => {
    await new User({ username: 'boss', displayName: 'Boss', role: 'admin', password: 'boss-pass-1' }).save();
    return cookieFrom(await login('boss', 'boss-pass-1'), SESSION_COOKIE);
  };
  const lockedRita = async () => {
    const rita = await makeUser({ mustChangePassword: false, tempPasswordExpiresAt: null, password: 'own-pass-1' });
    for (let i = 0; i < 5; i += 1) await login('rita', 'wrong-pass');
    return rita;
  };
  const unlock = (cookie, id) => request(app).post(`/api/admin/users/${id}/unlock`).set('Cookie', cookie);

  it('five wrong passwords lock the account, even against the right one', async () => {
    await lockedRita();
    await login('rita', 'own-pass-1').expect(423);
  });

  it('an admin unlocks it and they can sign in straight away', async () => {
    const admin = await adminSession();
    const rita = await lockedRita();
    const res = await unlock(admin, rita._id).expect(200);
    expect(res.body.user).toMatchObject({ loginAttempts: 0, lockUntil: null, editedBy: 'boss' });
    const saved = await User.findById(rita._id);
    expect(saved.loginAttempts).toBe(0);
    expect(saved.lockUntil).toBeUndefined();
    expect(saved.editedBy).toBe('boss');
    await login('rita', 'own-pass-1').expect(200);
  });

  it('doesn\'t change their password or end their sessions', async () => {
    const admin = await adminSession();
    await makeUser({ mustChangePassword: false, tempPasswordExpiresAt: null, password: 'own-pass-1' });
    const ritaSession = cookieFrom(await login('rita', 'own-pass-1'), SESSION_COOKIE);
    const rita = await User.findOne({ username: 'rita' });
    for (let i = 0; i < 5; i += 1) await login('rita', 'wrong-pass');
    await unlock(admin, rita._id).expect(200);
    await protectedWith(ritaSession).expect(200);
    expect(sessionVersionOf(await User.findById(rita._id))).toBe(0);
  });

  it('needs Manage users', async () => {
    const rita = await lockedRita();
    await new User({ username: 'sam', role: 'sales_rep', password: 'sam-pass-1' }).save();
    const sam = cookieFrom(await login('sam', 'sam-pass-1'), SESSION_COOKIE);
    await unlock(sam, rita._id).expect(403);
    await request(app).post(`/api/admin/users/${rita._id}/unlock`).expect(401);
    await login('rita', 'own-pass-1').expect(423);
  });

  it('an unknown or malformed id is a 404', async () => {
    const admin = await adminSession();
    await unlock(admin, new mongoose.Types.ObjectId()).expect(404);
    await unlock(admin, 'not-an-id').expect(404);
  });

  it('choosing their own password (here, an invite) also lifts a lock', async () => {
    const rita = await lockedRita();
    const invite = newInvite();
    await User.updateOne({ _id: rita._id }, { $set: { inviteTokenHash: invite.fields.inviteTokenHash, inviteExpiresAt: invite.fields.inviteExpiresAt } });
    await request(app).post('/api/auth/accept-invite').send({ token: invite.token, newPassword: 'fresh-pass-1' }).expect(200);
    await login('rita', 'fresh-pass-1').expect(200);
  });
});
