/**
 * Purchasing, through the real router: each request run on MongoDB, then on Postgres, must
 * answer the same and leave the same records behind (`t.differences()` is the copy's own
 * check of every table — purchasingRows is the spec for what a Postgres save writes).
 *
 * Stock, sales reports, reservations and transit stay on MongoDB (sources.ts), so both runs
 * read the same ones.
 */
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import createPurchasingRouter from '../../purchasing/router.ts';
import InventoryItem from '../../models/InventoryItem.ts';
import InventorySalesRecord from '../../models/InventorySalesRecord.ts';
import { inventoryRows } from '../copy/inventoryRows.ts';
import { inventoryTransitShipments, inventoryTransitLines } from '../schema/inventory.ts';
import InventoryTransitShipment from '../../models/InventoryTransitShipment.ts';
import { inPurchasingTransaction } from './index.ts';
import type { Loose } from '../../types/records.ts';

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
// A new record's id is made by the route: both runs of one request must get the same one.
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

const oid = () => String(new mongoose.Types.ObjectId());
const PERMS = ['view_inventory_analysis', 'view_purchasing', 'manage_purchasing', 'approve_purchasing'];
const ADMIN = { id: oid(), displayName: 'Buyer', assignedLocations: ['*'], permissions: PERMS };
const VIEWER = { ...ADMIN, permissions: ['view_inventory_analysis', 'view_purchasing'] };
const SPOKANE = { id: oid(), displayName: 'Ken', assignedLocations: ['Spokane'], permissions: PERMS };
const SEATTLE = { id: oid(), displayName: 'Dee', assignedLocations: ['Seattle'], permissions: PERMS };

const at = new Date('2026-11-10T17:30:00.000Z');
const policy = { product: 'Quartz 3CM', supplier: 'ABC', bundleSlabs: 6, minimumSlabs: 0, sfPerSlab: 1, weightKg: 400, mixGroup: 'same-origin-window', active: true };
const supply = { po: 'P1', line: '1', product: 'Quartz 3CM', branch: 'Seattle', supplier: 'ABC', ordered: 24, received: 0, cancelled: 0,
  eta: '2026-12-08', confirmed: true, shipment: '', shipped: 0, shipmentReceived: 0, shipmentEta: '' };
const legacyScope = oid(), legacyDraft = oid(), legacyInbound = oid();

/** A two-branch scope with an old import that never recorded its branches and a cancelled draft with a line at Spokane. */
async function seedLegacy(db: import('mongodb').Db) {
    const c = db.collection('purchasing_scopes');
    await c.insertOne({ _id: new mongoose.Types.ObjectId(legacyScope), name: 'Both', branches: ['Seattle', 'Spokane'], cohortId: 'legacy', aliases: [], policies: [policy],
      reviewDays: 7, bufferDays: 21, stockMaxHours: 24, salesMaxDays: 14, fullSalesCoverage: false, createdAt: new Date('2026-11-01T10:00:00Z'), updatedAt: new Date('2026-11-01T10:00:00Z'), __v: 0 });
    await db.collection('purchasing_inbound').insertOne({ _id: new mongoose.Types.ObjectId(legacyInbound), scopeId: new mongoose.Types.ObjectId(legacyScope), complete: true,
      rows: [supply], receipts: [], createdAt: new Date('2026-11-02T10:00:00Z'), updatedAt: new Date('2026-11-02T10:00:00Z'), __v: 0 });
    await db.collection('purchasing_drafts').insertOne({ _id: new mongoose.Types.ObjectId(legacyDraft), scopeId: new mongoose.Types.ObjectId(legacyScope), status: 'cancelled', lines: [{ key: 'k', branch: 'Spokane', quantity: 6 }],
      loads: [], note: 'old', createdBy: { id: 'x', name: 'Old Buyer' }, existingPoLines: [], existingTransitParents: [], linkedPoLines: [],
      history: [{ action: 'draft', at: new Date('2026-11-01T11:00:00Z'), name: 'Old Buyer', note: 'old' }, { action: 'cancel', at: new Date('2026-11-01T12:00:00Z'), name: 'Old Buyer', note: 'no' }],
      createdAt: new Date('2026-11-01T11:00:00Z'), updatedAt: new Date('2026-11-01T12:00:00Z'), __v: 1 });
}

let t: WriteParity;
let app: express.Express;

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane'].map(name => ({ _id: new mongoose.Types.ObjectId(), name })));
    await InventoryItem.collection.insertMany(Array.from({ length: 42 }, (_, i) => ({
      product: 'Quartz 3CM', location: 'Seattle', type: 'SLAB', units: 'SF', instockQty: 1,
      availableSlabs: 1, availableQuantity: 1, slabStatus: '', remnant: '', serialNumber: `SER${i + 1}`, importedAt: new Date('2026-11-10T16:00:00Z')
    })));
    await InventorySalesRecord.collection.insertMany([
      { product: 'Quartz 3CM', location: 'Seattle', uom: 'SF', slabsSold: 54, quantitySold: 54,
        periodStart: new Date('2026-10-12T00:00:00Z'), periodEnd: new Date('2026-11-17T00:00:00Z'), importedAt: new Date('2026-11-10T16:00:00Z') },
      // A legacy combined report, the only way to build a scope over two branches.
      { product: 'Quartz 3CM', location: 'Seattle Spokane', uom: 'SF', slabsSold: 10, quantitySold: 10,
        periodStart: new Date('2026-10-12T00:00:00Z'), periodEnd: new Date('2026-11-17T00:00:00Z'), importedAt: new Date('2026-11-10T16:00:00Z') }
    ]);
    await seedLegacy(db);
  }, 'DB_INVENTORY');

  app = express();
  app.use(express.json());
  app.use('/api/purchasing', createPurchasingRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

/** Every test starts from the same Purchasing records (and the same locks) on both databases. */
beforeEach(async () => {
  const db = mongoose.connection.db!;
  for (const name of ['purchasing_scopes', 'purchasing_inbound', 'purchasing_drafts', 'purchasing_locks', 'purchasing_po_links']) await db.collection(name).deleteMany({});
  await seedLegacy(db);
  await t.resync();
});

type Call = (user: Loose, method: 'get' | 'post' | 'put', path: string, body?: unknown) => Promise<{ status: number; body: Loose }>;
const call: Call = async (user, method, path, body) => {
  const r = await request(app)[method](`/api/purchasing${path}`).set({ 'x-test-user': JSON.stringify(user) }).send(body as object);
  return { status: r.status, body: r.body };
};

/**
 * What differs on purpose: a plan's / draft's `fingerprint` is a hash of the whole scope record,
 * whose key order is the database's own — it only has to agree with the plan the same database
 * showed (the flows below always send back the fingerprint they just read). The inventory
 * `revision` is a counter both runs bump, so the second run starts higher (its steps are
 * checked in "the revision").
 */
const comparable = (v: unknown): unknown => normalize(JSON.parse(JSON.stringify(v ?? null), (k, x) => (k === 'fingerprint' || (k === 'revision' && typeof x === 'number') ? undefined : x)));

/** Run a flow of requests on MongoDB, then on Postgres: same answers, same rows afterwards. */
async function same<T>(flow: () => Promise<T>, { rows = true } = {}) {
  ids.made.length = 0;
  const { mongo, postgres } = await t.both(async () => { ids.used = 0; return flow(); });
  expect(comparable(postgres)).toEqual(comparable(mongo));
  // The inventory revision is another area's table (a counter both runs bump).
  if (rows) expect((await t.differences()).filter(d => !d.startsWith('inventory_revision'))).toEqual([]);
  return mongo;
}

const scopeBody = (cohortId: string, stockSnapshotId: string, over: Loose = {}) => ({
  name: 'Seattle buying', branches: ['Seattle'], cohortId, observedThrough: '2026-11-10', fullSalesCoverage: true, stockSnapshotId,
  stockCoverageConfirmed: true, freeStockValidated: true, policyConfirmed: true, reviewDays: 7, bufferDays: 21, stockMaxHours: 24, salesMaxDays: 14,
  aliases: [], policies: [policy], container: { payloadKg: 25000, tareKg: 600, maxSlabs: 60, layoutConfirmed: true, mixingConfirmed: true }, ...over
});
const seattleCohort = (meta: Loose) => meta.cohorts.find((c: Loose) => c.location === 'Seattle').id;

/** Metadata → create a Seattle scope → import supply: the answers of each step. */
async function setup(over: Loose = {}) {
  const meta = (await call(ADMIN, 'get', '/metadata')).body;
  const made = await call(ADMIN, 'post', '/scopes', scopeBody(seattleCohort(meta), meta.stockSnapshotId, over));
  const imported = made.status === 201 ? await call(ADMIN, 'post', `/scopes/${made.body._id}/inbound`, { complete: true, rows: [supply] }) : null;
  return { meta, made, imported, id: made.body._id as string };
}

describe('reading and scopes', () => {
  it('metadata lists the scopes a login may see (the seeded two-branch one only to an all-branch login)', async () => {
    await same(async () => ({
      admin: await call(ADMIN, 'get', '/metadata'), seattle: await call(SEATTLE, 'get', '/metadata'), spokane: await call(SPOKANE, 'get', '/metadata')
    }));
  });

  it('creates a scope with its aliases, policies and container, then edits it by version', async () => {
    const first = await same(async () => {
      const s = await setup();
      const meta = s.meta;
      const edited = await call(ADMIN, 'put', `/scopes/${s.id}`, { ...scopeBody(seattleCohort(meta), meta.stockSnapshotId, { name: 'Renamed', reviewDays: 10, container: { payloadKg: 24000, tareKg: 500, maxSlabs: 55, layoutConfirmed: true, mixingConfirmed: false } }), version: 0 });
      const stale = await call(ADMIN, 'put', `/scopes/${s.id}`, { ...scopeBody(seattleCohort(meta), meta.stockSnapshotId), version: 0 });
      const noVersion = await call(ADMIN, 'put', `/scopes/${s.id}`, scopeBody(seattleCohort(meta), meta.stockSnapshotId));
      const again = await call(ADMIN, 'put', `/scopes/${s.id}`, { ...scopeBody(seattleCohort(meta), meta.stockSnapshotId, { policies: [] }), version: 1 });
      return { s, edited, stale, noVersion, again, list: await call(ADMIN, 'get', '/metadata') };
    });
    expect(first.s.made.status).toBe(201);
    expect(first.edited.status).toBe(200);
    expect(first.edited.body.__v).toBe(1);
    expect(first.stale.status).toBe(409);
    expect(first.noVersion.status).toBe(409);
    expect(first.again.status).toBe(200);
  });

  it('refuses what the rules refuse: no Manage, another branch, a wrong cohort, a future cutoff, an unverified alias', async () => {
    await same(async () => {
      const meta = (await call(ADMIN, 'get', '/metadata')).body;
      const cohort = seattleCohort(meta), snap = meta.stockSnapshotId;
      return [
        await call(VIEWER, 'post', '/scopes', scopeBody(cohort, snap)),
        await call(SPOKANE, 'post', '/scopes', scopeBody(cohort, snap)),
        await call(ADMIN, 'post', '/scopes', scopeBody('nope', snap)),
        await call(ADMIN, 'post', '/scopes', scopeBody(cohort, snap, { observedThrough: '2026-11-17' })),
        await call(ADMIN, 'post', '/scopes', scopeBody(cohort, snap, { branches: ['Spokane'] })),
        await call(ADMIN, 'post', '/scopes', scopeBody(cohort, snap, { aliases: [{ salesProduct: 'Quartz 3CM', stockProduct: 'Typo variant' }] })),
        await call(ADMIN, 'put', `/scopes/${oid()}`, { ...scopeBody(cohort, snap), version: 0 }),
        await call(ADMIN, 'put', '/scopes/zzz', { ...scopeBody(cohort, snap), version: 0 }),
        await call(ADMIN, 'get', '/scopes/zzz/plan')
      ];
    }, { rows: false });
  });

  it('changing a scope’s branches: refused while a draft has a line at the branch being removed, else imports with no branches take the old ones', async () => {
    const result = await same(async () => {
      const meta = (await call(ADMIN, 'get', '/metadata')).body;
      const legacy = meta.cohorts.find((c: Loose) => c.location === 'Seattle Spokane');
      const body = (over: Loose) => ({ ...scopeBody(legacy.id, meta.stockSnapshotId, { name: 'Both', branches: ['Seattle', 'Spokane'], fullSalesCoverage: false, stockCoverageConfirmed: false, ...over }), version: 0 });
      const refused = await call(ADMIN, 'put', `/scopes/${legacyScope}`, body({ branches: ['Seattle'] }));
      return { refused };
    });
    expect(result.refused.status).toBe(409);
    expect(result.refused.body.error).toMatch(/Purchase history/);
  });

  it('with no draft at the removed branch, the branches change and the old import takes the scope’s old branches', async () => {
    // Make the seeded draft's line a Seattle one, on both databases, so nothing stops the change.
    await mongoose.connection.collection('purchasing_drafts').updateOne({ _id: new mongoose.Types.ObjectId(legacyDraft) }, { $set: { 'lines.0.branch': 'Seattle' } });
    await t.resync();
    const changed = await same(async () => {
      const meta = (await call(ADMIN, 'get', '/metadata')).body;
      const legacy = meta.cohorts.find((c: Loose) => c.location === 'Seattle Spokane');
      const put = await call(ADMIN, 'put', `/scopes/${legacyScope}`, { ...scopeBody(legacy.id, meta.stockSnapshotId, { name: 'Both', branches: ['Seattle', 'Spokane'], fullSalesCoverage: false, stockCoverageConfirmed: false, reviewDays: 9 }), version: 0 });
      // Now narrowing is allowed; the import recorded no branches, so it is stamped with the old two first.
      const narrowed = await call(ADMIN, 'put', `/scopes/${legacyScope}`, { ...scopeBody(legacy.id, meta.stockSnapshotId, { name: 'Both', branches: ['Seattle'], fullSalesCoverage: false, stockCoverageConfirmed: false }), version: 1 });
      return { put, narrowed, inbound: await call(ADMIN, 'get', `/scopes/${legacyScope}/inbound`) };
    });
    expect(changed.put.status).toBe(200);
    // Narrowing is allowed; the import recorded no branches, so it was stamped with the old two (rows compared above)
    // and no longer matches the one-branch scope — the plan sees no supply until a new import.
    expect(changed.narrowed.status).toBe(200);
    expect(changed.inbound.body).toBeNull();
  });
});

describe('incoming supply', () => {
  it('imports, reads the latest, and refuses a branch outside the scope, an invalid total and a viewer', async () => {
    await same(async () => {
      const s = await setup();
      const second = await call(ADMIN, 'post', `/scopes/${s.id}/inbound`, { complete: true, rows: [{ ...supply, ordered: 30, eta: '2026-12-15' }] });
      return {
        s, second,
        latest: await call(ADMIN, 'get', `/scopes/${s.id}/inbound`),
        wrongBranch: await call(ADMIN, 'post', `/scopes/${s.id}/inbound`, { complete: true, rows: [{ ...supply, branch: 'Spokane' }] }),
        invalid: await call(ADMIN, 'post', `/scopes/${s.id}/inbound`, { complete: true, rows: [{ ...supply, received: 30 }] }),
        viewer: await call(VIEWER, 'post', `/scopes/${s.id}/inbound`, { complete: true, rows: [] }),
        stranger: await call(SPOKANE, 'get', `/scopes/${s.id}/inbound`)
      };
    });
  });
});

describe('plan and drafts', () => {
  const draftBody = (p: Loose, over: Loose = {}) => ({ fingerprint: p.fingerprint,
    lines: [{ key: p.rows[0].key, branch: 'Seattle', quantity: p.rows[0].protective.proposedSlabs }], note: 'Weekly replenishment', ...over });

  it('draft → approve → export → link, each step by version, and the lists', async () => {
    const out = await same(async () => {
      const s = await setup();
      const plan = (await call(ADMIN, 'get', `/scopes/${s.id}/plan`)).body;
      const make = await call(ADMIN, 'post', `/scopes/${s.id}/drafts`, draftBody(plan));
      const d = make.body;
      const again = await call(ADMIN, 'post', `/scopes/${s.id}/drafts`, draftBody(plan));
      const planAfter = await call(ADMIN, 'get', `/scopes/${s.id}/plan`);
      const list = await call(ADMIN, 'get', `/scopes/${s.id}/drafts`);
      const approve = await call(ADMIN, 'post', `/drafts/${d._id}/approve`, { version: 0, note: 'ok' });
      const reapprove = await call(ADMIN, 'post', `/drafts/${d._id}/approve`, { version: 0, note: 'ok' });
      const exported = await call(ADMIN, 'get', `/drafts/${d._id}/export`);
      const linkNone = await call(ADMIN, 'post', `/drafts/${d._id}/link`, { version: 1, note: 'ordered', poLines: [] });
      const link = await call(ADMIN, 'post', `/drafts/${d._id}/link`, { version: 1, note: 'ordered', poLines: [JSON.stringify(['P9', '1'])] });
      return { s, plan, make, again, planAfter, list, approve, reapprove, exported, linkNone, link, after: await call(ADMIN, 'get', `/scopes/${s.id}/drafts?paginated=true`) };
    });
    expect(out.make.status).toBe(201);
    expect(out.make.body.history).toHaveLength(1);
    expect(out.again.status).toBe(409);
    expect(out.approve.status).toBe(200);
    expect(out.approve.body.status).toBe('approved');
    expect(out.approve.body.history).toHaveLength(2);
    expect(out.reapprove.status).toBe(409);
    expect(out.exported.status).toBe(200);
  });

  it('cancel frees the locks; a cancelled draft goes to the history list; cursors page it', async () => {
    const out = await same(async () => {
      const s = await setup();
      const results: Loose[] = [];
      for (let i = 0; i < 3; i++) {
        const plan = (await call(ADMIN, 'get', `/scopes/${s.id}/plan`)).body;
        const made = await call(ADMIN, 'post', `/scopes/${s.id}/drafts`, draftBody(plan));
        results.push(made);
        results.push(await call(ADMIN, 'post', `/drafts/${made.body._id}/cancel`, { version: 0, note: `no ${i}` }));
      }
      const wrong = await call(ADMIN, 'post', `/drafts/${results[0].body._id}/cancel`, { version: 1, note: 'again' });
      const first = await call(ADMIN, 'get', `/scopes/${s.id}/drafts?paginated=true&limit=2`);
      const next = await call(ADMIN, 'get', `/scopes/${s.id}/drafts?paginated=true&limit=2&cursor=${first.body.nextCursor}`);
      return { results, wrong, first, next, flat: await call(ADMIN, 'get', `/scopes/${s.id}/drafts`), bad: await call(ADMIN, 'get', `/scopes/${s.id}/drafts?cursor=zzz`) };
    });
    expect(out.first.body.nextCursor).toBeTruthy();
    expect(out.wrong.status).toBe(409);
  });

  it('refuses a stale fingerprint, an unknown line, a viewer, a below-bundle quantity and a missing note on an override', async () => {
    await same(async () => {
      const s = await setup();
      const plan = (await call(ADMIN, 'get', `/scopes/${s.id}/plan`)).body;
      return [
        await call(ADMIN, 'post', `/scopes/${s.id}/drafts`, draftBody(plan, { fingerprint: 'stale' })),
        await call(ADMIN, 'post', `/scopes/${s.id}/drafts`, draftBody(plan, { lines: [{ key: 'nope', branch: 'Seattle', quantity: 6 }] })),
        await call(VIEWER, 'post', `/scopes/${s.id}/drafts`, draftBody(plan)),
        await call(ADMIN, 'post', `/scopes/${s.id}/drafts`, draftBody(plan, { lines: [{ key: plan.rows[0].key, branch: 'Seattle', quantity: 7 }] })),
        await call(ADMIN, 'post', `/scopes/${s.id}/drafts`, draftBody(plan, { lines: [{ key: plan.rows[0].key, branch: 'Seattle', quantity: 12 }], note: '' })),
        await call(ADMIN, 'post', `/drafts/${oid()}/approve`, { version: 0, note: 'x' }),
        await call(ADMIN, 'get', `/drafts/${oid()}/export`),
        await call(SEATTLE, 'get', `/scopes/${legacyScope}/drafts`)
      ];
    }, { rows: false });
  });

  it('a stock change after drafting stops approval, as a changed plan always has', async () => {
    const out = await same(async () => {
      const s = await setup();
      const plan = (await call(ADMIN, 'get', `/scopes/${s.id}/plan`)).body;
      const made = await call(ADMIN, 'post', `/scopes/${s.id}/drafts`, draftBody(plan));
      // New supply arrives: the fingerprint no longer matches.
      const more = await call(ADMIN, 'post', `/scopes/${s.id}/inbound`, { complete: true, rows: [{ ...supply, ordered: 99 }] });
      const approve = await call(ADMIN, 'post', `/drafts/${made.body._id}/approve`, { version: 0, note: 'ok' });
      return { made, more, approve };
    });
    expect(out.approve.status).toBe(409);
  });
});

describe('receiving date of an in-transit container (the shipment is read and saved through the transit layer)', () => {
  it('confirms a date through the Postgres scope', async () => {
    const out = await same(async () => {
      const s = await setup();
      return { s, plan: (await call(ADMIN, 'get', `/scopes/${s.id}/plan`)).body.transitLineCount };
    }, { rows: false });
    expect(out.plan).toBe(0);
    const shipment = await InventoryTransitShipment.create({ poNumber: 'P2', containerNumber: 'CONT2', location: 'Seattle', importedAt: at,
      lines: [{ product: 'Quartz 3CM', poNumber: 'P2', containerNumber: 'CONT2', location: 'Seattle', units: 'SF', slabs: 24, quantity: 24, etaDate: new Date('2026-12-08'), status: 'INTRANSIT', supplier: 'ABC' }] });
    // The shipment exists in both databases (as the copy would have made it).
    const built = inventoryRows({ inventoryItems: [], inventorySalesRecords: [], inventoryTransitShipments: [shipment.toObject() as Loose], inventoryTransitReports: [],
      inventoryTransitEvents: [], inventoryRevision: [], inventoryStockImports: [], inventoryStockBackups: [], inventoryStockState: [] }, []);
    await t.pg.db.insert(inventoryTransitShipments).values(built.inventoryTransitShipments);
    await t.pg.db.insert(inventoryTransitLines).values(built.inventoryTransitLines);
    await same(async () => {
      const s = await setup();
      const plan = (await call(ADMIN, 'get', `/scopes/${s.id}/plan`)).body;
      const line = plan.rows[0].transit[0];
      const ok = await call(ADMIN, 'post', `/scopes/${s.id}/incoming/${String(shipment._id)}/receipt`, { date: '2026-12-08', signature: line.sourceSignature });
      const stale = await call(ADMIN, 'post', `/scopes/${s.id}/incoming/${String(shipment._id)}/receipt`, { date: '2026-12-08', signature: 'a'.repeat(64) });
      return { ok, stale: stale.status };
    }, { rows: false });
  });
});

describe('the inventory revision', () => {
  it('goes up once per Purchasing write on Postgres, as it does on MongoDB, and not on a failed one', async () => {
    const revisions = async () => (await call(ADMIN, 'get', '/revision')).body.revision as number;
    const steps = async () => {
      const before = await revisions();
      const s = await setup();            // scope + import: two writes
      const after = await revisions();
      await call(ADMIN, 'put', `/scopes/${s.id}`, { ...scopeBody(s.meta.cohorts[0].id, s.meta.stockSnapshotId), version: 99 }); // refused: nothing bumped
      return { writes: after - before, refused: (await revisions()) - after };
    };
    const { mongo, postgres } = await t.both(steps);
    expect(mongo).toEqual({ writes: 2, refused: 0 });
    expect(postgres).toEqual(mongo);
  });
});

describe('locks are one row per stock line, taken with the draft', () => {
  it('a lock already held fails the whole draft (code 11000, nothing left behind) on Postgres as on MongoDB', async () => {
    const draft = (n: string) => ({ scopeId: legacyScope, status: 'draft', lines: [], loads: [], note: n, createdBy: { id: 'a', name: 'A' }, history: [] });
    const lockId = JSON.stringify(['Seattle', 'quartz 3cm']);
    const attempt = async () => {
      const first = oid(), second = oid();
      await inPurchasingTransaction(s => s.createDraft(first, draft('first'), [{ _id: lockId, scopeId: legacyScope }]));
      let code: unknown = null;
      try { await inPurchasingTransaction(s => s.createDraft(second, draft('second'), [{ _id: lockId, scopeId: legacyScope }])); } catch (e) { code = (e as { code?: unknown }).code; }
      const left = await inPurchasingTransaction(async s => ({ first: !!(await s.findDraft(first)), second: !!(await s.findDraft(second)), locks: (await s.listLocks()).map(l => l._id) }));
      await inPurchasingTransaction(s => s.releaseLocks(first));
      return { code, left };
    };
    const { mongo, postgres } = await t.both(attempt);
    expect(mongo).toEqual({ code: 11000, left: { first: true, second: false, locks: [lockId] } });
    expect(postgres).toEqual(mongo);
  });
});
