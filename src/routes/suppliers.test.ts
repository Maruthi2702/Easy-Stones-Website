import type { Loose } from '../types/records.ts';
// Supplier POs, both sides, against a throwaway in-memory MongoDB: the staff
// API (src/routes/suppliers.ts) and the supplier portal's
// (src/routes/supplierPortal.ts) — a supplier and its login, the invite link,
// signing in, a PO assigned and emailed, a block offered bundle by bundle,
// step 1, step 2 and the same-person rule, unlocking, Incoming material
// without supplier / PO, one supplier never seeing another's, staff and
// supplier tokens never crossing, the wrong-password lock, Fill from SPS.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; html: string }[] }));
vi.mock('../services/emailService.ts', () => ({
  sendEmail: async (m: { to: string; subject: string; html: string }) => { mail.sent.push(m); return { success: true }; }
}));

const { default: createSuppliersRouter } = await import('./suppliers.ts');
const { default: createSupplierPortalRouter } = await import('./supplierPortal.ts');
const { Supplier, SupplierLogin, SupplierPO, SupplierBlock } = await import('../models/Suppliers.ts');
const { default: Role } = await import('../models/Role.ts');
const { default: User } = await import('../models/User.ts');
const { default: InventoryTransitShipment } = await import('../models/InventoryTransitShipment.ts');

const SECRET = 'test-secret';
let mongo!: MongoMemoryServer;
let app!: import('express').Express;

const P = {
  VIEW: 'view_supplier_pos', MANAGE_POS: 'manage_supplier_pos', REVIEW: 'review_supplier_blocks', FINAL: 'final_approve_supplier_blocks',
  UNLOCK: 'unlock_supplier_bundles', MANAGE_SUPPLIERS: 'manage_suppliers', INCOMING: 'view_incoming_material'
};
const ids = { admin: new mongoose.Types.ObjectId().toString(), ravi: new mongoose.Types.ObjectId().toString(), dana: new mongoose.Types.ObjectId().toString(), sales: new mongoose.Types.ObjectId().toString() };
const ADMIN = { id: ids.admin, displayName: 'Ana Admin', permissions: Object.values(P) };
const RAVI = { id: ids.ravi, displayName: 'Ravi Shah', permissions: [P.VIEW, P.REVIEW, P.UNLOCK] };
const DANA = { id: ids.dana, displayName: 'Dana Whitfield', permissions: [P.VIEW, P.FINAL, P.MANAGE_POS] };
const SALES = { id: ids.sales, displayName: 'Sam Sales', permissions: [P.INCOMING] };
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Supplier.init(), SupplierLogin.init(), SupplierPO.init(), SupplierBlock.init()]);
  app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(cookieParser());
  const authenticate = (req: Loose, res: Loose, next: () => void) => {
    // The staff check, as server.ts's: a JWT signed with the secret itself.
    const raw = req.headers['x-test-user'];
    if (raw) { req.user = JSON.parse(raw); return next(); }
    const token = req.cookies?.customerToken;
    try { jwt.verify(token, SECRET); req.user = { id: 'x', permissions: Object.values(P) }; return next(); } catch { return res.status(401).json({ error: 'Sign in' }); }
  };
  app.use('/api/suppliers', createSuppliersRouter({
    authenticate,
    processBase64Image: async () => `https://res.cloudinary.com/test/SupplierBlocks/staff_${Math.random().toString(36).slice(2)}.webp`
  }));
  app.use('/api/supplier-portal', createSupplierPortalRouter({
    jwtSecret: SECRET, loginLimiter: (_req, _res, next) => next(),
    processBase64Image: async () => `https://res.cloudinary.com/test/SupplierBlocks/img_${Math.random().toString(36).slice(2)}.webp`
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  mail.sent = [];
  await Promise.all([Supplier, SupplierLogin, SupplierPO, SupplierBlock, Role, User, InventoryTransitShipment].map((M) => (M as Loose).collection.deleteMany({})));
  await User.collection.insertMany([
    { _id: new mongoose.Types.ObjectId(ids.dana), username: 'dana', displayName: 'Dana Whitfield', email: 'dana@easystones.test', password: 'x'.repeat(10), role: 'purchasing' }
  ]);
  await Role.collection.insertOne({ name: 'purchasing', displayName: 'Purchasing', permissions: [P.VIEW, P.MANAGE_POS] });
});

const staff = (user: Loose) => {
  const h = (r: request.Test) => r.set('x-test-user', JSON.stringify(user));
  return {
    get: (url: string) => h(request(app).get(`/api/suppliers${url}`)),
    post: (url: string, body: Loose = {}) => h(request(app).post(`/api/suppliers${url}`)).send(body),
    put: (url: string, body: Loose) => h(request(app).put(`/api/suppliers${url}`)).send(body)
  };
};
const portal = () => {
  const agent = request.agent(app);
  return {
    agent,
    get: (url: string) => agent.get(`/api/supplier-portal${url}`),
    post: (url: string, body: Loose = {}) => agent.post(`/api/supplier-portal${url}`).send(body),
    put: (url: string, body: Loose) => agent.put(`/api/supplier-portal${url}`).send(body),
    patch: (url: string, body: Loose) => agent.patch(`/api/supplier-portal${url}`).send(body),
    del: (url: string) => agent.delete(`/api/supplier-portal${url}`)
  };
};
const newId = () => new mongoose.Types.ObjectId().toString();
const tokenFrom = (html: string) => decodeURIComponent(/token=([^"&<\s]+)/.exec(html)![1]!);

/** A supplier with a login that has chosen its password; returns the signed-in portal. */
async function supplierSignedIn(name = 'Pedras Vale Verde', email = 'marcos@pvv.test', language = 'pt') {
  const s = (await staff(ADMIN).post('/suppliers', { name, spsName: name.toUpperCase(), country: 'Brazil', language, timeZone: 'America/Sao_Paulo' }).expect(201)).body.supplier;
  const add = await staff(ADMIN).post(`/suppliers/${s.id}/logins`, { name: 'Marcos', email, language }).expect(201);
  expect(add.body.emailed).toBe(true);
  const invite = mail.sent.find((m) => m.to === email)!;
  const p = portal();
  await p.post('/link', { token: tokenFrom(invite.html), password: 'pedras-2026' }).expect(200);
  return { supplier: s, login: add.body.login, p };
}

async function assignPo(supplierId: string, poNumber = '41872', slabs = 56) {
  return (await staff(DANA).post('/pos', {
    id: newId(), poNumber, supplierId, shipTo: 'Seattle', readyBy: '2026-12-04',
    lines: [{ material: 'Taj Mahal Quartzite', thickness: '3 cm', finish: 'Polished', slabs }], note: 'Wet the slabs for the photos, please.'
  }).expect(201)).body.po;
}

/** Offers a block of `count` bundles × 8 slabs, every photo taken, and sends it. */
async function offerBlock(p: ReturnType<typeof portal>, po: Loose, count = 7) {
  const id = newId();
  let block = (await p.post(`/pos/${po.id}/blocks`, { id, lineId: po.lines[0].id }).expect(201)).body.block;
  expect(block.bundles).toHaveLength(7);
  while (block.bundles.length > count) block = (await p.del(`/blocks/${id}/bundles/${block.bundles[block.bundles.length - 1].id}`).expect(200)).body.block;
  block = (await p.put(`/blocks/${id}`, { blockNumber: '3317', length: '124', height: '76', unit: 'in', note: 'Bloco muito bonito' }).expect(200)).body.block;
  for (const b of block.bundles) {
    await p.put(`/blocks/${id}/bundles/${b.id}`, { slabs: 8 }).expect(200);
    await p.post(`/blocks/${id}/bundles/${b.id}/photo`, { data: PHOTO }).expect(200);
  }
  return (await p.post(`/blocks/${id}/send`).expect(200)).body.block;
}

describe('suppliers and their logins', () => {
  it('adds a supplier once per name and SPS name, and emails the login an invite in its language', async () => {
    const { supplier, p } = await supplierSignedIn();
    expect((await staff(ADMIN).post('/suppliers', { name: 'pedras vale verde', language: 'pt' }).expect(409)).body.problems.name).toBeTruthy();
    expect((await staff(ADMIN).post('/suppliers', { name: 'Other', spsName: ' pedras vale verde ', language: 'pt' }).expect(409)).body.problems.spsName).toMatch(/already has that SPS name/);
    expect(mail.sent[0]!.subject).toBe('Seu acesso de fornecedor da Easy Stones');
    expect((await p.get('/me').expect(200)).body.me).toMatchObject({ name: 'Marcos', language: 'pt', supplierName: 'Pedras Vale Verde' });
    // One login per supplier for now.
    expect((await staff(ADMIN).post(`/suppliers/${supplier.id}/logins`, { name: 'Ana', email: 'ana@pvv.test' }).expect(409)).body.message).toMatch(/one login/);
    // Only manage_suppliers adds them.
    await staff(RAVI).post('/suppliers', { name: 'X', language: 'en' }).expect(403);
  });

  it('an invite link works once; a wrong password five times locks the login', async () => {
    const { p } = await supplierSignedIn();
    const token = tokenFrom(mail.sent[0]!.html);
    await portal().get(`/link/${token}`).expect(410);
    await p.post('/sign-out').expect(200);
    await p.get('/me').expect(401);
    for (let i = 0; i < 4; i++) expect((await p.post('/sign-in', { email: 'marcos@pvv.test', password: 'nope' }).expect(401)).body.code).toBe('wrongPassword');
    expect((await p.post('/sign-in', { email: 'marcos@pvv.test', password: 'nope' }).expect(423)).body.code).toBe('locked');
    expect((await p.post('/sign-in', { email: 'marcos@pvv.test', password: 'pedras-2026' }).expect(423)).body.code).toBe('locked');
    const login = await SupplierLogin.findOne({ email: 'marcos@pvv.test' }).lean();
    await staff(ADMIN).post(`/suppliers/${login!.supplierId}/logins/${String(login!._id)}/unlock`).expect(200);
    await p.post('/sign-in', { email: 'MARCOS@pvv.test', password: 'pedras-2026' }).expect(200);
  });

  it('turning the login off ends its session; forgot-password always answers the same', async () => {
    const { supplier, login, p } = await supplierSignedIn();
    await staff(ADMIN).post(`/suppliers/${supplier.id}/logins/${login.id}/active`, { active: false }).expect(200);
    expect((await p.get('/me').expect(401)).body.code).toBe('loginOff');
    expect((await p.post('/sign-in', { email: 'marcos@pvv.test', password: 'pedras-2026' }).expect(403)).body.code).toBe('loginOff');
    mail.sent = [];
    await portal().post('/forgot', { email: 'marcos@pvv.test' }).expect(200);
    await portal().post('/forgot', { email: 'nobody@nowhere.test' }).expect(200);
    expect(mail.sent).toHaveLength(0);
    await staff(ADMIN).post(`/suppliers/${supplier.id}/logins/${login.id}/active`, { active: true }).expect(200);
    await portal().post('/forgot', { email: 'marcos@pvv.test' }).expect(200);
    expect(mail.sent[0]!.subject).toBe('Escolha uma nova senha da Easy Stones');
  });

  it('a staff token never opens the portal, and a supplier token never opens a staff route', async () => {
    const { p } = await supplierSignedIn();
    const staffToken = jwt.sign({ id: ids.admin, type: 'internal' }, SECRET);
    await request(app).get('/api/supplier-portal/me').set('Cookie', `supplierToken=${staffToken}`).expect(401);
    const res = await p.post('/sign-in', { email: 'marcos@pvv.test', password: 'pedras-2026' }).expect(200);
    const supplierToken = /supplierToken=([^;]+)/.exec(String(res.headers['set-cookie']))![1]!;
    expect(String(res.headers['set-cookie'])).toMatch(/Path=\/api\/supplier-portal/);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/);
    await request(app).get('/api/suppliers/pos').set('Cookie', `customerToken=${supplierToken}`).expect(401);
  });
});

describe('a PO from assignment to approved to load', () => {
  it('assigns, offers a block, goes through both steps and shows sales the approved bundles only', async () => {
    const { supplier, p } = await supplierSignedIn();
    const po = await assignPo(supplier.id);
    expect(po).toMatchObject({ poNumber: '41872', supplierName: 'Pedras Vale Verde', buyerName: 'Dana Whitfield', stage: 'supplier', source: 'typed' });
    const assigned = mail.sent.find((m) => m.subject === 'Novo pedido 41872 da Easy Stones');
    expect(assigned?.to).toBe('marcos@pvv.test');
    expect((await staff(DANA).post('/pos', { id: newId(), poNumber: ' 41872', supplierId: supplier.id, shipTo: 'Kent', lines: [{ material: 'x', slabs: 1 }] }).expect(409)).body.existingId).toBe(po.id);

    const home = (await p.get('/pos').expect(200)).body.pos;
    expect(home).toHaveLength(1);
    expect(home[0]).toMatchObject({ poNumber: '41872', group: 'needs_you' });
    expect(home[0]).not.toHaveProperty('buyerName');

    // Sending before every bundle has its photo and slabs is refused, naming them.
    const draftId = newId();
    const draft = (await p.post(`/pos/${po.id}/blocks`, { id: draftId, lineId: po.lines[0].id }).expect(201)).body.block;
    await p.post(`/pos/${po.id}/blocks`, { id: draftId, lineId: po.lines[0].id }).expect(200);
    const refused = (await p.post(`/blocks/${draftId}/send`).expect(400)).body;
    expect(refused.problems.block).toMatchObject({ blockNumber: 'blockNumber', size: 'size' });
    expect(Object.keys(refused.problems.bundles)).toHaveLength(7);
    expect((await staff(RAVI).get('/blocks?queue=review').expect(200)).body.blocks).toHaveLength(0);
    await p.del(`/blocks/${draft.id}`).expect(200);

    const sent = await offerBlock(p, po);
    expect(sent).toMatchObject({ stage: 'review', sent: true });
    // The buyer's email goes out after the supplier's answer.
    await new Promise((r) => setTimeout(r, 100));
    expect(mail.sent.some((m) => m.to === 'dana@easystones.test' && /block 3317 offered/.test(m.subject))).toBe(true);

    // Step 1: Ravi approves five, rejects one, asks for a new photo of one.
    const queue = (await staff(RAVI).get('/blocks?queue=review').expect(200)).body.blocks;
    expect(queue).toHaveLength(1);
    const blk = queue[0];
    expect(blk).toMatchObject({ supplierName: 'Pedras Vale Verde', shipTo: 'Seattle', blockNumber: '3317' });
    expect(blk.note.text).toBe('Bloco muito bonito');
    const [b1, b2, b3, b4, b5, b6, b7] = blk.bundles;
    mail.sent = [];
    await staff(DANA).post(`/blocks/${blk.id}/decide`, { step: 1, decisions: [{ bundleId: b1.id, decision: 'approve' }] }).expect(403);
    expect((await staff(RAVI).post(`/blocks/${blk.id}/decide`, { step: 1, decisions: [{ bundleId: b6.id, decision: 'reject' }] }).expect(409)).body.message).toMatch(/Choose why/);
    const step1 = (await staff(RAVI).post(`/blocks/${blk.id}/decide`, {
      step: 1, note: 'Bundle 7 is too dark.',
      decisions: [
        ...[b1, b2, b3, b4, b5].map((b) => ({ bundleId: b.id, decision: 'approve' })),
        { bundleId: b6.id, decision: 'reject', reason: 'cracks', comment: 'Crack across slab 3' },
        { bundleId: b7.id, decision: 'retake', reason: 'dark' }
      ]
    }).expect(200)).body;
    expect(step1.block.counts).toMatchObject({ final: 5, rejected: 1, retake: 1 });
    expect(step1.block.stage).toBe('final');
    expect(step1.emailed).toBe(1);
    expect(mail.sent[0]!.html).toContain('Trincas ou fissuras');
    expect(mail.sent[0]!.html).toContain('Foto escura demais');

    // Step 2: Ravi can't finalise what he approved; Dana can.
    expect((await staff(RAVI).post(`/blocks/${blk.id}/decide`, { step: 2, decisions: [{ bundleId: b1.id, decision: 'approve' }] }).expect(403)).body.message).toMatch(/final approval/);
    const both = { ...RAVI, permissions: [...RAVI.permissions, P.FINAL] };
    expect((await staff(both).post(`/blocks/${blk.id}/decide`, { step: 2, decisions: [{ bundleId: b1.id, decision: 'approve' }] }).expect(409)).body.message).toMatch(/someone else/);
    const finalQueue = (await staff(both).get('/blocks?queue=final').expect(200)).body.blocks[0];
    expect(finalQueue.decidable[2]).toEqual([]);
    mail.sent = [];
    const step2 = (await staff(DANA).post(`/blocks/${blk.id}/decide`, { step: 2, decisions: [b1, b2, b3, b4, b5].map((b) => ({ bundleId: b.id, decision: 'approve' })) }).expect(200)).body;
    expect(step2.block.counts).toMatchObject({ approved: 5, rejected: 1, retake: 1 });
    expect(step2.block.stage).toBe('supplier');
    expect(mail.sent[0]!.subject).toBe('Bloco 3317 · Pedido 41872: aprovado para carregar');

    // The supplier sees reasons as keys (named in their language) and no staff names.
    const mine = (await p.get(`/blocks/${blk.id}`).expect(200)).body.block;
    expect(mine.bundles.find((x: Loose) => x.n === 6)).toMatchObject({ status: 'rejected', decision: 'reject', reason: 'cracks' });
    expect(mine.bundles.find((x: Loose) => x.n === 7)).toMatchObject({ status: 'retake', reason: 'dark' });
    expect(JSON.stringify(mine)).not.toContain('Ravi');
    // Approved bundles are locked for the supplier.
    expect((await p.put(`/blocks/${blk.id}/bundles/${b1.id}`, { slabs: 7 }).expect(409)).body.code).toBe('lockNote');
    // A retake can't go back with the old photo.
    expect((await p.post(`/blocks/${blk.id}/send`).expect(400)).body.problems.bundles[b7.id]).toEqual(['newPhoto']);
    await p.post(`/blocks/${blk.id}/bundles/${b7.id}/photo`, { data: PHOTO }).expect(200);
    // …and replaces the rejected 6 with a new bundle.
    const added = (await p.post(`/blocks/${blk.id}/bundles`, { id: newId() }).expect(200)).body.block;
    const b8 = added.bundles.find((x: Loose) => x.n === 8);
    await p.put(`/blocks/${blk.id}/bundles/${b8.id}`, { slabs: 8 }).expect(200);
    await p.post(`/blocks/${blk.id}/bundles/${b8.id}/photo`, { data: PHOTO }).expect(200);
    const resent = (await p.post(`/blocks/${blk.id}/send`).expect(200)).body.block;
    expect(resent.counts).toMatchObject({ approved: 5, rejected: 1, review: 2 });
    const retaken = resent.bundles.find((x: Loose) => x.n === 7);
    expect(retaken.earlierPhoto).toMatch(/cloudinary/);

    // Unlock: an approved bundle goes back to the supplier, then through both steps again.
    await staff(DANA).post(`/blocks/${blk.id}/unlock`, { bundleIds: [b1.id], reason: 'Wrong slab count' }).expect(403);
    expect((await staff(RAVI).post(`/blocks/${blk.id}/unlock`, { bundleIds: [b1.id], reason: '' }).expect(400)).body.message).toMatch(/Say why/);
    const unlocked = (await staff(RAVI).post(`/blocks/${blk.id}/unlock`, { bundleIds: [b1.id], reason: 'Supplier says it holds 7 slabs' }).expect(200)).body.block;
    expect(unlocked.bundles.find((x: Loose) => x.id === b1.id).status).toBe('unlocked');
    expect(mail.sent.some((m) => /bundles destravados/.test(m.subject))).toBe(true);
    await p.put(`/blocks/${blk.id}/bundles/${b1.id}`, { slabs: 7 }).expect(200);

    // Sales: approved bundles only, and nothing about the supplier or the PO.
    const incoming = (await staff(SALES).get('/incoming').expect(200)).body.items;
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({ material: 'Taj Mahal Quartzite', blockNumber: '3317', slabs: 32, shipTo: 'Seattle' });
    expect(incoming[0].bundles.map((x: Loose) => x.n)).toEqual([2, 3, 4, 5]);
    const text = JSON.stringify(incoming);
    for (const hidden of ['41872', 'Pedras', 'supplier', 'poNumber', 'Ravi']) expect(text).not.toContain(hidden);
    await staff(RAVI).get('/incoming').expect(403);

    // The PO's history and coverage.
    const detail = (await staff(DANA).get(`/pos/${po.id}`).expect(200)).body.po;
    expect(detail.coverage[0]).toMatchObject({ ordered: 56, approved: 32 });
    expect(detail.blocks[0].history.map((h: Loose) => h.action)).toEqual(['started', 'sent for review', 'step 1', 'step 2', 'added a bundle', 'sent changes', 'unlocked']);
  });

  it('one supplier never sees another’s POs or blocks', async () => {
    const a = await supplierSignedIn();
    const b = await supplierSignedIn('Selangor Quartz', 'lim@selangor.test', 'ms');
    const po = await assignPo(a.supplier.id);
    const block = await offerBlock(a.p, po);
    expect((await b.p.get('/pos').expect(200)).body.pos).toHaveLength(0);
    await b.p.get(`/pos/${po.id}`).expect(404);
    await b.p.get(`/blocks/${block.id}`).expect(404);
    await b.p.post(`/blocks/${block.id}/send`).expect(404);
    await b.p.post(`/pos/${po.id}/blocks`, { id: newId(), lineId: po.lines[0].id }).expect(404);
  });

  it('a PO can’t move to another supplier once blocks were offered; a cancelled PO takes nothing new', async () => {
    const a = await supplierSignedIn();
    const other = (await staff(ADMIN).post('/suppliers', { name: 'Selangor Quartz', language: 'ms' }).expect(201)).body.supplier;
    const po = await assignPo(a.supplier.id);
    await offerBlock(a.p, po);
    const body = { supplierId: other.id, shipTo: 'Seattle', lines: po.lines };
    expect((await staff(DANA).put(`/pos/${po.id}`, body).expect(409)).body.problems.supplierId).toBeTruthy();
    expect((await staff(DANA).put(`/pos/${po.id}`, { supplierId: a.supplier.id, shipTo: 'Seattle', lines: [] }).expect(400)).body.problems.lines).toBeTruthy();
    const edited = (await staff(DANA).put(`/pos/${po.id}`, { supplierId: a.supplier.id, shipTo: 'Kent', readyBy: '2026-12-10', lines: [{ ...po.lines[0], slabs: 64 }] }).expect(200)).body.po;
    expect(edited.history.at(-1).changes).toBe('ship to Seattle → Kent, ready by 2026-12-04 → 2026-12-10, Taj Mahal Quartzite: 56 → 64 slabs');
    await staff(DANA).post(`/pos/${po.id}/status`, { status: 'cancelled' }).expect(400);
    await staff(DANA).post(`/pos/${po.id}/status`, { status: 'cancelled', reason: 'Quarry closed' }).expect(200);
    expect((await a.p.post(`/pos/${po.id}/blocks`, { id: newId(), lineId: po.lines[0].id }).expect(409)).body.code).toBe('poCancelled');
    expect((await a.p.get('/pos').expect(200)).body.pos[0].group).toBe('closed');
  });
});

describe('purchasing enters a block for its supplier', () => {
  /** Photos uploaded as they're picked, then the block entered and sent in one save. */
  async function enterBlock(user: Loose, po: Loose, count = 7, slabs: number | null = 8) {
    const bundles = [];
    for (let i = 0; i < count; i++) {
      const { url } = (await staff(user).post('/block-photos', { data: PHOTO }).expect(201)).body;
      bundles.push({ id: newId(), slabs, photoUrl: url });
    }
    return { id: newId(), lineId: po.lines[0].id, blockNumber: 'B-77', length: '320', height: '190', unit: 'cm', note: 'Sent on WhatsApp', bundles };
  }

  it('enters the photos a supplier with no login emailed; they hear the decisions by email with the photos', async () => {
    const s = (await staff(ADMIN).post('/suppliers', { name: 'Phuson Joint Stock', country: 'Vietnam', language: 'vi', timeZone: 'Asia/Ho_Chi_Minh', email: 'sales@phuson.test' }).expect(201)).body.supplier;
    const po = await assignPo(s.id, '14985', 56);

    // Only Add / edit POs may enter one.
    await staff(RAVI).post('/block-photos', { data: PHOTO }).expect(403);
    const body = await enterBlock(DANA, po);
    await staff(RAVI).post(`/pos/${po.id}/blocks`, body).expect(403);

    // Every bundle needs its photo and slabs before it goes.
    const missing = { ...body, bundles: body.bundles.map((b: Loose, i: number) => (i === 2 ? { ...b, slabs: null } : b)) };
    const refused = await staff(DANA).post(`/pos/${po.id}/blocks`, { ...missing, id: newId() }).expect(400);
    expect(refused.body.problems.bundles[body.bundles[2].id]).toMatch(/How many slabs/);
    // Only photos we stored.
    await staff(DANA).post(`/pos/${po.id}/blocks`, { ...body, id: newId(), bundles: [{ ...body.bundles[0], photoUrl: 'https://evil.test/x.jpg' }] }).expect(409);

    const first = await staff(DANA).post(`/pos/${po.id}/blocks`, body).expect(201);
    const block = first.body.block;
    expect(block).toMatchObject({ enteredBy: 'Dana Whitfield', blockNumber: 'B-77', stage: 'review', size: { length: 320, height: 190, unit: 'cm' } });
    expect(block.bundles.map((b: Loose) => b.status)).toEqual(Array(7).fill('review'));
    expect(block.history[0]).toMatchObject({ by: 'Dana Whitfield', side: 'staff', action: 'entered for the supplier', changes: '7 bundles, 56 slabs' });
    // A repeat of the same save doesn't double it.
    expect((await staff(DANA).post(`/pos/${po.id}/blocks`, body).expect(200)).body.alreadySaved).toBe(true);
    expect(await SupplierBlock.countDocuments({ poId: po.id })).toBe(1);
    // It's on the PO and in the review queue like any other.
    expect((await staff(DANA).get(`/pos/${po.id}`).expect(200)).body.po.blocks).toHaveLength(1);
    expect((await staff(RAVI).get('/blocks?queue=review').expect(200)).body.blocks[0].id).toBe(body.id);

    mail.sent = [];
    const decisions = block.bundles.map((b: Loose) => (b.n === 3 ? { bundleId: b.id, decision: 'retake', reason: 'dark' } : { bundleId: b.id, decision: 'approve' }));
    await staff(RAVI).post(`/blocks/${body.id}/decide`, { step: 1, decisions }).expect(200);
    // No login: the supplier's own email, in Vietnamese, with the photos and no portal link.
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe('sales@phuson.test');
    expect(mail.sent[0]!.html).toContain('<img src="https://res.cloudinary.com/test/SupplierBlocks/staff_');
    expect(mail.sent[0]!.html).not.toContain('/supplier/block/');

    // The new photo the supplier sent for bundle 3, and one more bundle.
    const now = (await staff(DANA).get(`/blocks/${body.id}`).expect(200)).body.block;
    const b3 = now.bundles.find((b: Loose) => b.n === 3);
    const b1 = now.bundles.find((b: Loose) => b.n === 1);
    const { url } = (await staff(DANA).post('/block-photos', { data: PHOTO }).expect(201)).body;
    const { url: url8 } = (await staff(DANA).post('/block-photos', { data: PHOTO }).expect(201)).body;
    // A bundle that's with Easy Stones can't be changed.
    await staff(DANA).put(`/blocks/${body.id}/entry`, { expectedUpdatedAt: now.updatedAt, bundles: [{ id: b1.id, slabs: 8, photoUrl: url }] }).expect(409);
    // Saving over a newer block is refused.
    await staff(DANA).put(`/blocks/${body.id}/entry`, { expectedUpdatedAt: '2020-01-01T00:00:00.000Z', bundles: [{ id: b3.id, slabs: 8, photoUrl: url }] }).expect(409);
    const id8 = newId();
    const changed = (await staff(DANA).put(`/blocks/${body.id}/entry`, {
      expectedUpdatedAt: now.updatedAt, bundles: [{ id: b3.id, slabs: 8, photoUrl: url }, { id: id8, slabs: 6, photoUrl: url8 }]
    }).expect(200)).body.block;
    const after3 = changed.bundles.find((b: Loose) => b.n === 3);
    expect(after3).toMatchObject({ status: 'review', round: 2, photoUrl: url });
    expect(after3.previousPhotos).toHaveLength(1);
    expect(changed.bundles.find((b: Loose) => b.id === id8)).toMatchObject({ n: 8, status: 'review', slabs: 6 });
    expect(changed.bundles.filter((b: Loose) => b.status === 'final')).toHaveLength(6);
    expect(changed.history.at(-1)).toMatchObject({ action: 'entered changes for the supplier', changes: '2 bundles, 14 slabs · 1 new photo' });
  });

  it('a block entered for a supplier with a login shows in their portal, without staff names; the buyer hears who entered it', async () => {
    const { supplier, p } = await supplierSignedIn();
    const po = await assignPo(supplier.id);
    mail.sent = [];
    const body = await enterBlock(ADMIN, po, 2);
    await staff(ADMIN).post(`/pos/${po.id}/blocks`, body).expect(201);
    const seen = (await p.get(`/blocks/${body.id}`).expect(200)).body.block;
    expect(seen.bundles.map((b: Loose) => b.status)).toEqual(['review', 'review']);
    expect(JSON.stringify(seen)).not.toMatch(/Ana Admin|enteredBy/);
    // Dana is the PO's buyer (she added it).
    await new Promise((r) => setTimeout(r, 100));
    const toBuyer = mail.sent.find((m) => m.to === 'dana@easystones.test')!;
    expect(toBuyer.subject).toBe('PO 41872: block B-77 offered by Pedras Vale Verde (entered by Ana Admin)');
    expect(toBuyer.html).toContain('Ana Admin entered <b>block B-77</b> for Pedras Vale Verde');
    // Whoever entered it may give it step 1 (owner's call); step 2 is still someone else's.
    const entered = (await staff(ADMIN).get(`/blocks/${body.id}`).expect(200)).body.block;
    await staff(ADMIN).post(`/blocks/${body.id}/decide`, { step: 1, decisions: entered.bundles.map((b: Loose) => ({ bundleId: b.id, decision: 'approve' })) }).expect(200);
    await staff(ADMIN).post(`/blocks/${body.id}/decide`, { step: 2, decisions: entered.bundles.map((b: Loose) => ({ bundleId: b.id, decision: 'approve' })) }).expect(409);
    // A block the supplier is still putting together in the portal is theirs.
    const draft = newId();
    await p.post(`/pos/${po.id}/blocks`, { id: draft, lineId: po.lines[0].id }).expect(201);
    await staff(ADMIN).put(`/blocks/${draft}/entry`, { bundles: [] }).expect(409);
  });
});

describe('Fill from SPS', () => {
  it('reads the import’s lines for a PO # and finds the supplier by its SPS name', async () => {
    const s = (await staff(ADMIN).post('/suppliers', { name: 'Pedras Vale Verde', spsName: 'PEDRAS VALE VERDE LTDA', language: 'pt' }).expect(201)).body.supplier;
    await InventoryTransitShipment.create({
      poNumber: '41890', containerNumber: 'MSKU1', location: 'Seattle', active: true,
      lines: [
        { product: 'Patagonia Quartzite 2cm', slabs: 30, supplier: 'Pedras Vale Verde Ltda', etaDate: new Date('2026-12-20') },
        { product: 'Patagonia Quartzite 2cm', slabs: 18, supplier: 'Pedras Vale Verde Ltda' }
      ]
    });
    const found = (await staff(DANA).get('/sps-lookup?po=41890').expect(200)).body;
    expect(found).toMatchObject({ found: true, supplierId: s.id, location: 'Seattle', eta: '2026-12-20', lines: [{ material: 'Patagonia Quartzite 2cm', slabs: 48 }] });
    expect((await staff(DANA).get('/sps-lookup?po=99999').expect(200)).body.found).toBe(false);
    await staff(RAVI).get('/sps-lookup?po=41890').expect(403);
  });
});
