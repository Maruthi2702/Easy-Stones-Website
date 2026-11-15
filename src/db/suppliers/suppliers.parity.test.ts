/**
 * Supplier POs and the supplier portal, through the real routers: each request run on MongoDB, then on
 * Postgres, must answer the same and leave the same records behind (`t.differences()` is the copy's own
 * check of every table, so the copy's row builders are the spec for what Postgres writes).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 180000 });

// Both runs of one request must make the same ids.
const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});
// A password's hash differs on every run (a random salt); here it doesn't, so the two databases can be compared.
vi.mock('bcryptjs', () => {
  const api = { genSalt: async () => 'salt', hash: async (p: string) => `hashed:${p}`, compare: async (p: string, h: string) => h === `hashed:${p}` };
  return { default: api, ...api };
});
const mail = vi.hoisted(() => ({ sent: [] as { to: string }[] }));
vi.mock('../../services/emailService.ts', () => ({ sendEmail: async (m: { to: string }) => { mail.sent.push(m); return { success: true }; } }));

const { default: createSuppliersRouter } = await import('../../routes/suppliers.ts');
const { default: createSupplierPortalRouter } = await import('../../routes/supplierPortal.ts');
const { Supplier, SupplierLogin, SupplierPO } = await import('../../models/Suppliers.ts');
const { signSupplierToken, hashLinkToken } = await import('../../services/supplierSession.ts');
const { default: User } = await import('../../models/User.ts');
const { default: Role } = await import('../../models/Role.ts');

// An invite link's token is random; here the two runs get the same one.
vi.spyOn(crypto, 'randomBytes').mockImplementation((() => Buffer.alloc(32, 7)) as never);

const SECRET = 'test-secret';
const oid = () => String(new mongoose.Types.ObjectId());
const P = {
  VIEW: 'view_supplier_pos', MANAGE_POS: 'manage_supplier_pos', REVIEW: 'review_supplier_blocks', FINAL: 'final_approve_supplier_blocks',
  UNLOCK: 'unlock_supplier_bundles', MANAGE_SUPPLIERS: 'manage_suppliers', INCOMING: 'view_incoming_material'
};
const who = (id: string, displayName: string, permissions: string[]) => ({ 'x-test-user': JSON.stringify({ id, displayName, permissions }) });
const dana = oid(), ravi = oid(), admin = oid(), sam = oid();
const ADMIN = who(admin, 'Ana Admin', Object.values(P));
const RAVI = who(ravi, 'Ravi Shah', [P.VIEW, P.REVIEW, P.UNLOCK]);
const DANA = who(dana, 'Dana Whitfield', [P.VIEW, P.FINAL, P.MANAGE_POS]);
const SALES = who(sam, 'Sam Sales', [P.INCOMING]);
const PHOTO = `data:image/jpeg;base64,${Buffer.from('fake-jpeg').toString('base64')}`;

const supB = oid(), loginB = oid(), poB = oid(), lineB = oid(), loginExpired = oid(), supC = oid();
const hex = (h: string) => new mongoose.Types.ObjectId(h);

let t: WriteParity;
let app: express.Express;
let clock = Date.parse('2026-11-10T17:30:00.000Z');
const cookie = (id: string, supplierId: string) => ({ Cookie: `supplierToken=${signSupplierToken({ _id: id, supplierId, sessionVersion: 0 }, SECRET)}` });

beforeAll(async () => {
  t = await openWriteParity(async () => {
    await User.collection.insertOne({ _id: hex(dana), username: 'dana', displayName: 'Dana Whitfield', email: 'dana@easystones.test', password: 'x'.repeat(10), role: 'purchasing' });
    await Role.collection.insertOne({ name: 'purchasing', displayName: 'Purchasing', permissions: [P.VIEW, P.MANAGE_POS] });
    const now = new Date('2026-11-10T17:00:00Z');
    await Supplier.create([
      { _id: hex(supB), name: 'Marmores do Sul', spsName: 'MARMORES DO SUL', spsKey: 'marmores do sul', country: 'Brazil', language: 'pt', email: 'sul@marmores.test', createdBy: 'Ana' },
      { _id: hex(supC), name: 'Quiet Quarry', language: 'en', email: '', createdBy: 'Ana' }
    ]);
    await SupplierLogin.create([
      { _id: hex(loginB), supplierId: supB, name: 'Marcos', email: 'marcos@marmores.test', password: 'pw-12345', language: 'pt', lastSeenAt: now, invitedAt: now },
      // An invite link that is still good, for choosing a first password.
      { _id: hex(loginExpired), supplierId: supB, name: 'Ines', email: 'ines@marmores.test', language: 'pt', linkTokenHash: hashLinkToken('t'.repeat(30)), linkExpiresAt: new Date('2026-11-14T00:00:00Z'), lastSeenAt: now }
    ]);
    await SupplierPO.create({
      _id: hex(poB), poNumber: 'SEED-1', supplierId: supB, supplierName: 'Marmores do Sul', shipTo: 'Seattle', readyBy: '2026-12-01', buyerId: dana, buyerName: 'Dana Whitfield',
      lines: [{ _id: lineB, material: 'Taj Mahal Quartzite', thickness: '3 cm', finish: 'Polished', slabs: 56 }], assignedAt: now, createdBy: 'Dana',
      history: [{ at: now, by: 'Dana', side: 'staff', action: 'added', changes: 'assigned to Marmores do Sul' }]
    });
  }, 'DB_SUPPLIERS');

  app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(cookieParser());
  const authenticate = (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); };
  app.use('/api/suppliers', createSuppliersRouter({ authenticate, processBase64Image: async () => 'https://res.cloudinary.com/test/SupplierBlocks/staff.webp' }));
  app.use('/api/supplier-portal', createSupplierPortalRouter({ jwtSecret: SECRET, loginLimiter: (_q, _r, next) => next(), processBase64Image: async () => 'https://res.cloudinary.com/test/SupplierBlocks/img.webp' }));
}, 240000);

afterAll(async () => { await t?.close(); });

/** Each call runs a minute after the last, so nothing ties on a time. */
async function same(send: (a: ReturnType<typeof request>) => request.Test, headers: Record<string, string>, expected?: number) {
  ids.made.length = 0;
  clock += 60000;
  const ask = async () => { ids.used = 0; mail.sent = []; const r = await send(request(app)).set(headers); return { status: r.status, body: r.body }; };
  const { mongo, postgres } = await t.both(ask, new Date(clock));
  expect(postgres.status, JSON.stringify(postgres.body)).toBe(mongo.status);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  if (expected) expect(mongo.status, JSON.stringify(mongo.body)).toBe(expected);
  expect(await t.differences()).toEqual([]);
  return mongo;
}
const staff = (path: string) => `/api/suppliers${path}`;
const portal = (path: string) => `/api/supplier-portal${path}`;

describe('staff: suppliers and their logins', () => {
  const ghost = oid();
  let supplierId = '', loginId = '';
  it('adds a supplier, refuses a repeated name and SPS name, edits it', async () => {
    const r = await same(a => a.post(staff('/suppliers')).send({ name: 'Pedras Vale Verde', spsName: 'Pedras Vale Verde', country: 'Brazil', language: 'pt', timeZone: 'America/Sao_Paulo', email: 'vv@pedras.test' }), ADMIN, 201);
    supplierId = r.body.supplier.id;
    await same(a => a.post(staff('/suppliers')).send({ name: 'pedras vale verde', language: 'pt' }), ADMIN, 409);
    await same(a => a.post(staff('/suppliers')).send({ name: 'Other', spsName: ' PEDRAS vale verde ', language: 'pt' }), ADMIN, 409);
    await same(a => a.put(staff(`/suppliers/${supplierId}`)).send({ name: 'Pedras Vale Verde Ltda', spsName: 'Pedras Vale Verde', country: 'Brazil', language: 'pt', notes: 'Pays slow' }), ADMIN, 200);
    await same(a => a.get(staff('/suppliers')), DANA, 200);
  });
  it('adds a login (emailed), edits it, resends the link, turns it off and on, unlocks it, and ends sessions when the supplier goes inactive', async () => {
    const added = await same(a => a.post(staff(`/suppliers/${supplierId}/logins`)).send({ name: 'Vera', email: 'Vera@Pedras.test', language: 'pt' }), ADMIN, 201);
    loginId = added.body.login.id;
    await same(a => a.post(staff(`/suppliers/${supplierId}/logins`)).send({ name: 'Second', email: 'second@pedras.test' }), ADMIN, 409);
    await same(a => a.put(staff(`/suppliers/${supplierId}/logins/${loginId}`)).send({ name: 'Vera S.', email: 'vera.s@pedras.test', language: 'pt' }), ADMIN, 200);
    await same(a => a.post(staff(`/suppliers/${supplierId}/logins/${loginId}/invite`)), ADMIN, 200);
    await same(a => a.post(staff(`/suppliers/${supplierId}/logins/${loginId}/active`)).send({ active: false }), ADMIN, 200);
    await same(a => a.post(staff(`/suppliers/${supplierId}/logins/${loginId}/invite`)), ADMIN, 409);
    await same(a => a.post(staff(`/suppliers/${supplierId}/logins/${loginId}/active`)).send({ active: true }), ADMIN, 200);
    await same(a => a.post(staff(`/suppliers/${supplierId}/logins/${loginId}/unlock`)), ADMIN, 200);
    await same(a => a.put(staff(`/suppliers/${supplierId}`)).send({ name: 'Pedras Vale Verde Ltda', language: 'pt', active: false }), ADMIN, 200);
    await same(a => a.put(staff(`/suppliers/${supplierId}`)).send({ name: 'Pedras Vale Verde Ltda', language: 'pt', active: true }), ADMIN, 200);
  });
  it('a bad id finds nothing', async () => {
    await same(a => a.put(staff('/suppliers/nope')).send({ name: 'x' }), ADMIN, 404);
    await same(a => a.put(staff(`/suppliers/${ghost}`)).send({ name: 'x', language: 'pt' }), ADMIN, 404);
  });
});

describe('staff: POs', () => {
  const po = oid(), lineA = oid(), otherPo = oid(), noSupplier = oid();
  it('assigns a PO (emailed to a login that has a password), repeats it, refuses the same number', async () => {
    const body = { id: po, poNumber: ' 41872 ', supplierId: supB, shipTo: 'Seattle', readyBy: '2026-12-04', buyerId: dana, note: 'Wet the slabs, please.', lines: [{ id: lineA, material: 'Taj Mahal Quartzite', thickness: '3 cm', finish: 'Polished', slabs: 56 }] };
    await same(a => a.post(staff('/pos')).send(body), DANA, 201);
    await same(a => a.post(staff('/pos')).send(body), DANA, 200);
    await same(a => a.post(staff('/pos')).send({ ...body, id: otherPo }), DANA, 409);
    await same(a => a.post(staff('/pos')).send({ ...body, id: otherPo, poNumber: '5', supplierId: noSupplier }), DANA, 400);
  });
  it('edits it (a rename follows to unsent blocks), closes, cancels with a reason, reopens, emails again, lists it', async () => {
    await same(a => a.put(staff(`/pos/${po}`)).send({ poNumber: '41872', supplierId: supB, shipTo: 'Spokane', readyBy: '2026-12-10', buyerId: dana, lines: [{ id: lineA, material: 'Taj Mahal Quartzite', thickness: '2 cm', finish: 'Honed', slabs: 60 }] }), DANA, 200);
    await same(a => a.post(staff(`/pos/${po}/status`)).send({ status: 'closed', reason: 'Done' }), DANA, 200);
    await same(a => a.post(staff(`/pos/${po}/status`)).send({ status: 'cancelled' }), DANA, 400);
    await same(a => a.post(staff(`/pos/${po}/status`)).send({ status: 'cancelled', reason: 'Wrong supplier' }), DANA, 200);
    await same(a => a.put(staff(`/pos/${po}`)).send({ poNumber: '41872', supplierId: supB, lines: [{ id: lineA, material: 'x', slabs: 1 }] }), DANA, 409);
    await same(a => a.post(staff(`/pos/${po}/status`)).send({ status: 'open' }), DANA, 200);
    await same(a => a.post(staff(`/pos/${po}/notify`)), DANA, 200);
    await same(a => a.get(staff(`/pos/${po}`)), DANA, 200);
    for (const status of ['open', 'closed', 'cancelled', 'all']) await same(a => a.get(staff(`/pos?status=${status}`)), DANA, 200);
    await same(a => a.get(staff('/suppliers')), DANA, 200);
    await same(a => a.get(staff('/pos/nope')), DANA, 404);
  });
});

describe('the supplier portal and the two steps', () => {
  const me = cookie(loginB, supB), ghost2 = oid(), ghostLogin = oid();
  const block = oid(), blockDup = oid(), extraBundle = oid();
  let bundles: string[] = [];
  it('signs in (and counts wrong passwords towards the lock), shows the supplier its POs, changes its language', async () => {
    await same(a => a.post(portal('/sign-in')).send({ email: 'marcos@marmores.test', password: 'pw-12345' }), {}, 200);
    await same(a => a.post(portal('/sign-in')).send({ email: 'ines@marmores.test', password: 'whatever' }), {}, 401);
    await same(a => a.get(portal('/me')), me, 200);
    await same(a => a.patch(portal('/me')).send({ language: 'es' }), me, 200);
    await same(a => a.get(portal('/pos')), me, 200);
    await same(a => a.get(portal(`/pos/${poB}`)), me, 200);
    await same(a => a.get(portal(`/pos/${ghost2}`)), me, 404);
  });
  it('chooses a first password from an invite link, and asks for a reset', async () => {
    await same(a => a.get(portal(`/link/${'t'.repeat(30)}`)), {}, 200);
    await same(a => a.post(portal('/link')).send({ token: 't'.repeat(30), password: 'a-new-password' }), {}, 200);
    await same(a => a.get(portal(`/link/${'t'.repeat(30)}`)), {}, 410);
    await same(a => a.post(portal('/forgot')).send({ email: 'marcos@marmores.test' }), {}, 200);
    await same(a => a.post(portal('/sign-in')).send({ email: 'marcos@marmores.test', password: 'pw-12345' }), {}, 423 as never).catch(() => undefined);
  });
  it('puts a block together bundle by bundle and sends it', async () => {
    const started = await same(a => a.post(portal(`/pos/${poB}/blocks`)).send({ id: block, lineId: lineB }), cookie(loginB, supB), 201);
    bundles = started.body.block.bundles.map((b: Loose) => b.id);
    await same(a => a.post(portal(`/pos/${poB}/blocks`)).send({ id: block, lineId: lineB }), cookie(loginB, supB), 200);
    await same(a => a.put(portal(`/blocks/${block}`)).send({ blockNumber: '3317', length: '124', height: '76.5', unit: 'in', note: 'Bloco bonito' }), cookie(loginB, supB), 200);
    await same(a => a.post(portal(`/blocks/${block}/bundles`)).send({ id: extraBundle }), cookie(loginB, supB), 200);
    await same(a => a.del(portal(`/blocks/${block}/bundles/${bundles[6]}`)), cookie(loginB, supB), 200);
    await same(a => a.post(portal(`/blocks/${block}/send`)), cookie(loginB, supB), 400);
    for (const id of bundles.slice(0, 6)) {
      await same(a => a.put(portal(`/blocks/${block}/bundles/${id}`)).send({ slabs: 8 }), cookie(loginB, supB), 200);
      await same(a => a.post(portal(`/blocks/${block}/bundles/${id}/photo`)).send({ data: PHOTO }), cookie(loginB, supB), 200);
    }
    const extra = (await same(a => a.get(portal(`/blocks/${block}`)), cookie(loginB, supB), 200)).body.block.bundles.find((b: Loose) => !bundles.slice(0, 6).includes(b.id));
    await same(a => a.del(portal(`/blocks/${block}/bundles/${extra.id}`)), cookie(loginB, supB), 200);
    await same(a => a.post(portal(`/blocks/${block}/send`)), cookie(loginB, supB), 200);
    await same(a => a.get(portal(`/pos/${poB}`)), cookie(loginB, supB), 200);
    // Another supplier's login never sees it.
    await same(a => a.get(portal(`/blocks/${block}`)), cookie(ghostLogin, supC), 401);
  });
  it('a block never sent can be removed; one that was stays', async () => {
    await same(a => a.post(portal(`/pos/${poB}/blocks`)).send({ id: blockDup, lineId: lineB }), cookie(loginB, supB), 201);
    await same(a => a.del(portal(`/blocks/${blockDup}`)), cookie(loginB, supB), 200);
    await same(a => a.del(portal(`/blocks/${block}`)), cookie(loginB, supB), 409);
  });
  it('goes through step 1 and 2 (reject, new photo, send again), unlock, Incoming material, and the queues', async () => {
    await same(a => a.get(staff('/blocks?queue=review')), RAVI, 200);
    await same(a => a.post(staff(`/blocks/${block}/decide`)).send({ step: 1, note: 'Two need work', decisions: [
      ...bundles.slice(0, 4).map(bundleId => ({ bundleId, decision: 'approve' })),
      { bundleId: bundles[4], decision: 'reject', reason: 'chips', comment: 'Too dark' },
      { bundleId: bundles[5], decision: 'retake', reason: 'blurry', comment: 'Show the back' }
    ] }), RAVI, 200);
    await same(a => a.get(staff(`/blocks/${block}`)), RAVI, 200);
    for (const id of bundles.slice(5, 6)) await same(a => a.post(portal(`/blocks/${block}/bundles/${id}/photo`)).send({ data: PHOTO }), cookie(loginB, supB), 200);
    await same(a => a.post(portal(`/blocks/${block}/send`)), cookie(loginB, supB), 200);
    await same(a => a.post(staff(`/blocks/${block}/decide`)).send({ step: 1, decisions: bundles.slice(5, 6).map(bundleId => ({ bundleId, decision: 'approve' })) }), RAVI, 200);
    await same(a => a.get(staff('/blocks?queue=final')), DANA, 200);
    await same(a => a.post(staff(`/blocks/${block}/decide`)).send({ step: 2, decisions: [...bundles.slice(0, 4), bundles[5]].map(bundleId => ({ bundleId, decision: 'approve' })) }), DANA, 200);
    await same(a => a.get(staff('/incoming')), SALES, 200);
    await same(a => a.post(staff(`/blocks/${block}/unlock`)).send({ bundleIds: [bundles[0]], reason: 'Wrong count' }), RAVI, 200);
    await same(a => a.post(staff(`/blocks/${block}/unlock`)).send({ bundleIds: [bundles[1]] }), RAVI, 400);
    await same(a => a.get(staff(`/pos/${poB}`)), DANA, 200);
    await same(a => a.get(staff('/incoming')), SALES, 200);
  });
  it('purchasing enters a block for a supplier, and changes to it', async () => {
    const entered = oid(), newBundles = [oid(), oid(), oid()], fourth = oid();
    const r = await same(a => a.post(staff(`/pos/${poB}/blocks`)).send({
      id: entered, lineId: lineB, blockNumber: '9001', length: 120, height: 70, unit: 'cm', note: 'From WhatsApp',
      bundles: newBundles.map((id, n) => ({ id, slabs: 6, photoUrl: `https://res.cloudinary.com/test/SupplierBlocks/p${n}.webp` }))
    }), DANA, 201);
    const b = r.body.block;
    await same(a => a.post(staff(`/pos/${poB}/blocks`)).send({ id: entered, lineId: lineB }), DANA, 200);
    await same(a => a.get(staff(`/blocks/${entered}`)), DANA, 200);
    await same(a => a.put(staff(`/blocks/${entered}/entry`)).send({ expectedUpdatedAt: b.updatedAt, blockNumber: '9002', bundles: [{ id: fourth, slabs: 7, photoUrl: 'https://res.cloudinary.com/test/SupplierBlocks/p9.webp' }] }), DANA, 200);
    await same(a => a.put(staff(`/blocks/${entered}/entry`)).send({ expectedUpdatedAt: b.updatedAt, blockNumber: '9003', bundles: [] }), DANA, 409);
  });
});
