/**
 * Check In and the Selection Sheet, through the real router: each request run on MongoDB,
 * then on Postgres, must answer the same and leave the same check-ins behind (Postgres' rows
 * are compared with what the copy makes of MongoDB's — checkInRowsOf is the spec). The Users
 * and Locations the routes also read stay on MongoDB in both runs: those areas move last.
 *
 * Ids a request makes (the check-in's, its sheet lines') are handed out in order and start
 * over for each of the two runs, so both databases hold the same ids.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { asc } from 'drizzle-orm';

vi.mock('../../services/emailService.ts', () => ({
  sendCheckInAlertEmail: vi.fn(async () => ({ success: true })),
  sendSelectionSheetEmail: vi.fn(async () => ({ success: true }))
}));

const { openWriteParity } = await import('../customers/writes/writeParity.ts');
const { normalize } = await import('../customers/parity.ts');
const { default: OfficeCheckIn } = await import('../../models/OfficeCheckIn.ts');
const { checkInRowsOf } = await import('../copy/checkInsHoldsRows.ts');
const { referenceIndexOf } = await import('../customers/writes/coreSupport.postgres.ts');
const { officeCheckIns, checkInSelections } = await import('../schema/checkInsHolds.ts');
const { countCheckIns } = await import('./index.ts');
const { sendSelectionSheetEmail } = await import('../../services/emailService.ts');
const { default: createCheckInRouter } = await import('../../routes/checkIn.ts');
type WriteParity = Awaited<ReturnType<typeof openWriteParity>>;
type Loose = Record<string, any>;

const oid = () => String(new mongoose.Types.ObjectId());
const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const ALL = ['create_checkins', 'view_checkins', 'manage_checkins', 'delete_checkins', 'edit_selection_sheets', 'send_checkin_email'];
const dee = oid(), rita = oid(), ken = oid();
const SEATTLE = { id: dee, username: 'dee', displayName: 'Dee', permissions: ALL, assignedLocations: ['Seattle'] };
const ADMIN = { id: dee, username: 'root', displayName: 'Root', permissions: ALL, assignedLocations: ['*'] };
const VIEWER = { id: dee, username: 'vi', permissions: ['view_checkins'], assignedLocations: ['Seattle'] };
const DALLAS = { id: ken, username: 'ken', displayName: 'Ken', permissions: ALL, assignedLocations: ['Dallas'] };

let t: WriteParity;
let app: express.Express;
const SEED = {
  pat: oid(), sam: oid(), lee: oid(), dal: oid(), edge: oid(), old: oid()
};
const line = () => ({ _id: new mongoose.Types.ObjectId(), material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63', priceCentsPerSf: 6800 });

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane', 'Dallas'].map(name => ({ _id: new mongoose.Types.ObjectId(), name })));
    await db.collection('roles').insertOne({ _id: new mongoose.Types.ObjectId(), name: 'staff', displayName: 'Staff', permissions: [] });
    await db.collection('users').insertMany([
      { _id: new mongoose.Types.ObjectId(dee), username: 'dee', password: 'x', role: 'staff', email: 'dee@x.com', displayName: 'Dee', isActive: true },
      { _id: new mongoose.Types.ObjectId(rita), username: 'rita', password: 'x', role: 'staff', email: 'rita@x.com', displayName: 'Rita', isActive: true },
      { _id: new mongoose.Types.ObjectId(ken), username: 'ken', password: 'x', role: 'staff', email: 'ken@x.com', displayName: 'Ken', isActive: true }
    ]);
    const at = (iso: string) => new Date(iso);
    // Every check-in carries a status, as the model's default gives it (an older one with none reads 'New' on Postgres).
    await db.collection('officecheckins').insertMany([
      { _id: new mongoose.Types.ObjectId(SEED.pat), name: 'Pat Visitor', phone: '(206) 555-0142', location: 'Seattle', email: 'pat@x.com', fabricatorCompany: 'Granite Co', fabricatorPhone: '(206) 555-9000',
        status: 'New', selections: [line(), { ...line(), _id: new mongoose.Types.ObjectId(), material: 'STATUARIO', priceCentsPerSf: undefined }], specialNotes: 'Printed', internalNotes: 'Staff only', salesRep: 'Rita', salesRepEmail: 'rita@x.com',
        sheetEditedBy: 'dee', sheetEditedAt: at('2026-11-05T20:00:00Z'), loggedBy: { userId: new mongoose.Types.ObjectId(dee), username: 'dee', displayName: 'Dee' },
        createdAt: at('2026-11-05T18:00:00Z'), updatedAt: at('2026-11-05T20:00:00Z'), __v: 0 },
      { _id: new mongoose.Types.ObjectId(SEED.sam), name: 'Sam O\'Neil (Builder)', phone: '(425) 555-0100', location: 'Seattle', status: 'Processed', builderName: 'B & B', builderPhone: '(425) 555-0111',
        selections: [], loggedBy: { username: 'self-checkin', displayName: 'Self Check-In (QR/NFC)' }, createdAt: at('2026-11-02T17:00:00Z'), updatedAt: at('2026-11-02T17:00:00Z') },
      { _id: new mongoose.Types.ObjectId(SEED.lee), name: 'Lee Walker', status: 'New', phone: '(206) 555-0142', location: 'Seattle', fabricatorCompany: 'Walker Fab', selections: [],
        loggedBy: { userId: new mongoose.Types.ObjectId(dee), username: 'dee', displayName: 'Dee' }, createdAt: at('2026-10-31T23:30:00Z'), updatedAt: at('2026-10-31T23:30:00Z') },
      // 12:30 AM on Nov 1 in Dallas (Central) is 06:30Z; the Seattle month still says October there.
      { _id: new mongoose.Types.ObjectId(SEED.edge), name: 'Edge Case', status: 'New', phone: '(214) 555-0001', location: 'Dallas', selections: [], loggedBy: { username: 'ken', displayName: 'Ken', userId: new mongoose.Types.ObjectId(ken) },
        createdAt: at('2026-11-01T05:30:00Z'), updatedAt: at('2026-11-01T05:30:00Z') },
      { _id: new mongoose.Types.ObjectId(SEED.dal), name: 'Dana Dallas', status: 'New', phone: '(214) 555-0002', location: 'Dallas', selections: [], loggedBy: { username: 'ken', displayName: 'Ken' },
        createdAt: at('2026-11-09T17:00:00Z'), updatedAt: at('2026-11-09T17:00:00Z') },
      // Oldest check-ins: no loggedBy at all.
      { _id: new mongoose.Types.ObjectId(SEED.old), name: 'Old Timer', status: 'New', phone: '(206) 555-7777', location: 'Spokane', selections: [], createdAt: at('2025-03-01T17:00:00Z'), updatedAt: at('2025-03-01T17:00:00Z') }
    ]);
  }, 'DB_CHECKIN');

  // The check-in route's own ids, handed out in order so both runs hold the same ones.
  OfficeCheckIn.schema.path('_id').default(() => nextId());
  (OfficeCheckIn.schema.path('selections') as any).schema.path('_id').default(() => nextId());

  app = express();
  app.use(express.json());
  app.use('/api/checkin', createCheckInRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (p: string) => (req: Loose, res: Loose, next: () => void) => (has(req, p) ? next() : res.status(403).json({}))
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

const made: string[] = [];
let used = 0;
const nextId = () => new mongoose.Types.ObjectId((made[used] ??= oid(), made[used++]));

async function same(user: Loose, send: (a: ReturnType<typeof request>) => request.Test) {
  made.length = 0;
  const ask = async () => { used = 0; const r = await send(request(app)).set(as(user)); return { status: r.status, body: r.body, type: r.type }; };
  const { mongo, postgres } = await t.both(ask);
  expect(postgres.status).toBe(mongo.status);
  expect(postgres.type).toBe(mongo.type);
  if (mongo.type === 'application/json') expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  await expectSameCheckIns();
  return mongo;
}

/** Postgres' check-ins and lines = what the copy makes of MongoDB's now. */
async function expectSameCheckIns() {
  const ref = await referenceIndexOf(t.pg.db);
  const built = (await OfficeCheckIn.find().lean()).map(d => checkInRowsOf(d as Loose, ref, [])).filter(Boolean)
    .sort((a, b) => a!.checkIn.id.localeCompare(b!.checkIn.id));
  expect(await t.pg.db.select().from(officeCheckIns).orderBy(asc(officeCheckIns.id))).toEqual(built.map(b => b!.checkIn));
  expect(await t.pg.db.select().from(checkInSelections).orderBy(asc(checkInSelections.checkInId), asc(checkInSelections.position)))
    .toEqual(built.flatMap(b => b!.selections));
}

const visitor = (over: Loose = {}) => ({ name: 'New Person', phone: '2065550199', email: 'New@X.com ', fabricatorCompany: ' Stone Fab ', location: 'Seattle', ...over });
const row = (over: Loose = {}) => ({ material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63', priceCentsPerSf: 6800, ...over });

describe('reading', () => {
  it('the log: plain, paged, by search (a name, a phone typed plain, a company), by branch', async () => {
    const plain = await same(ADMIN, a => a.get('/api/checkin'));
    expect(plain.body).toHaveLength(6);
    await same(SEATTLE, a => a.get('/api/checkin'));
    await same(DALLAS, a => a.get('/api/checkin'));
    await same(ADMIN, a => a.get('/api/checkin?page=1&limit=2'));
    await same(ADMIN, a => a.get('/api/checkin?page=2&limit=2'));
    expect((await same(ADMIN, a => a.get('/api/checkin?page=1&limit=20&search=pat'))).body.total).toBe(1);
    expect((await same(ADMIN, a => a.get('/api/checkin?page=1&limit=20&search=2065550142'))).body.total).toBe(2);
    expect((await same(ADMIN, a => a.get('/api/checkin?page=1&limit=20&search=206555'))).body.total).toBeGreaterThan(2);
    await same(ADMIN, a => a.get('/api/checkin?page=1&limit=20&search=Walker%20Fab'));
    await same(ADMIN, a => a.get('/api/checkin?page=1&limit=20&search=O%27Neil%20(Builder)'));
    await same(ADMIN, a => a.get('/api/checkin?page=1&limit=20&search=B%20%26%20B'));
    await same(ADMIN, a => a.get('/api/checkin?page=1&limit=20&search=nobody-here'));
    await same(ADMIN, a => a.get('/api/checkin?page=1&limit=20&location=Dallas'));
    expect((await same(SEATTLE, a => a.get('/api/checkin?page=1&limit=20&location=Dallas'))).status).toBe(403);
  });

  it('a month is read on each check-in’s own branch clock (Dallas 12:30 AM Nov 1 is November, not October)', async () => {
    const nov = await same(ADMIN, a => a.get('/api/checkin?page=1&limit=50&month=11&year=2026'));
    const oct = await same(ADMIN, a => a.get('/api/checkin?page=1&limit=50&month=10&year=2026'));
    expect(nov.body.checkIns.map((c: Loose) => c.name)).toContain('Edge Case');
    expect(oct.body.checkIns.map((c: Loose) => c.name)).not.toContain('Edge Case');
    await same(SEATTLE, a => a.get('/api/checkin?page=1&limit=50&month=11&year=2026'));
    await same(ADMIN, a => a.get('/api/checkin?month=3&year=2025&search=old'));
    await same(ADMIN, a => a.get('/api/checkin?month=12&year=2026'));
  });

  it('the counts for today, this month and all time', async () => {
    const stats = await same(ADMIN, a => a.get('/api/checkin/stats'));
    expect(stats.body.allTimeCount).toBe(6);
    await same(SEATTLE, a => a.get('/api/checkin/stats'));
    await same(ADMIN, a => a.get('/api/checkin/stats?location=Dallas'));
    expect((await same(SEATTLE, a => a.get('/api/checkin/stats?location=Dallas'))).status).toBe(403);
  });

  it('one check-in, a missing one, a stranger’s branch, a read-only login and an id that isn’t one', async () => {
    const one = await same(SEATTLE, a => a.get(`/api/checkin/${SEED.pat}`));
    expect(one.body.selections).toHaveLength(2);
    await same(ADMIN, a => a.get(`/api/checkin/${SEED.old}`));
    expect((await same(SEATTLE, a => a.get(`/api/checkin/${oid()}`))).status).toBe(404);
    expect((await same(SEATTLE, a => a.get(`/api/checkin/${SEED.dal}`))).status).toBe(403);
    expect((await same(SEATTLE, a => a.get('/api/checkin/not-an-id'))).status).toBe(500);
    await same(VIEWER, a => a.get(`/api/checkin/${SEED.pat}`));
  });

  it('the phone lookup: the newest visit at a number, scoped to the caller’s branches', async () => {
    const found = await same(SEATTLE, a => a.get('/api/checkin/lookup?phone=2065550142'));
    expect(found.body.found).toBe(true);
    expect(found.body.name).toBe('Pat Visitor');
    await same(DALLAS, a => a.get('/api/checkin/lookup?phone=2065550142'));
    await same(ADMIN, a => a.get('/api/checkin/lookup?phone=(214)%20555-0001'));
    await same(SEATTLE, a => a.get('/api/checkin/lookup?phone=555'));
  });

  it('the log as a PDF opens for the same filters', async () => {
    const pdf = await same(ADMIN, a => a.get('/api/checkin/export.pdf?month=11&year=2026'));
    expect(pdf.status).toBe(200);
    expect(pdf.type).toBe('application/pdf');
    expect((await same(SEATTLE, a => a.get('/api/checkin/export.pdf?location=Dallas'))).status).toBe(403);
  });

  it('the Daily Report’s visitor count is the same number', async () => {
    const day = (iso: string) => ({ $gte: new Date(`${iso}T00:00:00Z`), $lt: new Date(`${iso}T23:59:59Z`) });
    const { mongo, postgres } = await t.both(() => countCheckIns({ location: 'Seattle', createdAt: day('2026-11-05') }));
    expect(postgres).toBe(mongo);
    expect(mongo).toBe(1);
  });
});

describe('checking in', () => {
  it('saves a visitor as MongoDB would: phone formatted, email lower-cased, text trimmed, who logged it', async () => {
    const r = await same(SEATTLE, a => a.post('/api/checkin').send(visitor()));
    expect(r.status).toBe(201);
    expect(r.body.data.phone).toBe('(206) 555-0199');
    expect(r.body.data.email).toBe('new@x.com');
    expect(r.body.data.fabricatorCompany).toBe('Stone Fab');
    expect(r.body.data.loggedBy.username).toBe('dee');
  });

  it('the same phone at the same branch within two minutes is the same visit', async () => {
    const send = visitor({ name: 'Twice', phone: '2065550333' });
    // Both runs hold one visit, so the second request finds it.
    await same(SEATTLE, a => a.post('/api/checkin').send(send));
    const again = await same(SEATTLE, a => a.post('/api/checkin').send(send));
    expect(again.body.duplicate).toBe(true);
    expect(again.status).toBe(200);
  });

  it('a missing name, a branch they can’t use, an admin choosing a branch, a login that can’t check in', async () => {
    await same(SEATTLE, a => a.post('/api/checkin').send(visitor({ name: '' })));
    expect((await same(SEATTLE, a => a.post('/api/checkin').send(visitor({ location: 'Dallas', phone: '2145550404' })))).status).toBe(403);
    await same(ADMIN, a => a.post('/api/checkin').send(visitor({ name: 'Dallas Walk-in', location: 'Dallas', phone: '2145550505' })));
    await same(DALLAS, a => a.post('/api/checkin').send(visitor({ name: 'Home Branch', location: undefined, phone: '2145550606' })));
    await same(VIEWER, a => a.post('/api/checkin').send(visitor({ phone: '2065550707' })));
  });

  it('a name too long for the record is refused the same way', async () => {
    expect((await same(SEATTLE, a => a.post('/api/checkin').send(visitor({ name: 'x'.repeat(201), phone: '2065550808' })))).status).toBe(500);
  });

  it('the visitor’s own phone (QR / NFC): saved, a bot and a hurry refused, an unknown branch refused', async () => {
    const send = (over: Loose = {}) => ({ ...visitor({ name: 'Self Visitor', phone: '2065550909', location: 'seattle' }), formLoadTime: Date.now() - 20000, ...over });
    const r = await same({}, a => a.post('/api/checkin/self').send(send()));
    expect(r.status).toBe(201);
    expect(r.body.data.location).toBe('Seattle');
    expect(r.body.data.loggedBy.username).toBe('self-checkin');
    await same({}, a => a.post('/api/checkin/self').send(send({ location: 'Narnia' })));
  });
});

describe('the Selection Sheet', () => {
  it('prices in cents, internal notes, and who edited it', async () => {
    const r = await same(SEATTLE, a => a.put(`/api/checkin/${SEED.sam}`).send({ selections: [row(), row({ material: 'STATUARIO', priceCentsPerSf: null })], internalNotes: 'Builder pricing', specialNotes: 'Printed' }));
    expect(r.status).toBe(200);
    expect(r.body.data.selections).toHaveLength(2);
    expect(r.body.data.sheetEditedBy).toBe('dee');
  });

  it('a sheet’s lines can be replaced, reordered and cleared', async () => {
    await same(SEATTLE, a => a.put(`/api/checkin/${SEED.pat}`).send({ selections: [row({ material: 'FIRST' }), row({ material: 'SECOND' }), row({ material: 'THIRD' })] }));
    await same(SEATTLE, a => a.put(`/api/checkin/${SEED.pat}`).send({ selections: [row({ material: 'THIRD' }), row({ material: 'FIRST' })] }));
    await same(SEATTLE, a => a.put(`/api/checkin/${SEED.pat}`).send({ selections: [] }));
  });

  it('a price that isn’t whole cents and a bad sheet are refused', async () => {
    for (const bad of [12.5, -100, 0, '68.00']) {
      expect((await same(SEATTLE, a => a.put(`/api/checkin/${SEED.lee}`).send({ selections: [row({ priceCentsPerSf: bad })] }))).status).toBe(400);
    }
    expect((await same(SEATTLE, a => a.put(`/api/checkin/${SEED.lee}`).send({ selections: 'nope' }))).status).toBe(400);
  });

  it('visitor details and the branch; a save that changes nothing writes nothing', async () => {
    await same(SEATTLE, a => a.put(`/api/checkin/${SEED.lee}`).send({ name: 'Lee W. Walker', fabricatorCompany: 'Walker Fab LLC', builderName: 'Bob', email: 'LEE@X.COM' }));
    const before = (await t.pg.db.select().from(officeCheckIns)).find(c => c.id === SEED.lee)!;
    await same(SEATTLE, a => a.put(`/api/checkin/${SEED.lee}`).send({ name: 'Lee W. Walker' }));
    const after = (await t.pg.db.select().from(officeCheckIns)).find(c => c.id === SEED.lee)!;
    expect(after.updatedAt).toEqual(before.updatedAt);
    await same(ADMIN, a => a.put(`/api/checkin/${SEED.lee}`).send({ location: 'Spokane' }));
    expect((await same(SEATTLE, a => a.put(`/api/checkin/${SEED.pat}`).send({ location: 'Dallas' }))).status).toBe(403);
  });

  it('the rep: one of our staff, else refused; the sheet’s rep email goes out only when it changed', async () => {
    await same(SEATTLE, a => a.put(`/api/checkin/${SEED.sam}`).send({ salesRep: 'Rita', salesRepEmail: 'rita@x.com' }));
    expect((await same(SEATTLE, a => a.put(`/api/checkin/${SEED.sam}`).send({ salesRep: 'Out', salesRepEmail: 'out@elsewhere.com' }))).status).toBe(400);
    vi.mocked(sendSelectionSheetEmail).mockClear();
    await same(SEATTLE, a => a.put(`/api/checkin/${SEED.sam}`).send({ selections: [row({ priceCentsPerSf: 7100 })] }));
    await new Promise(r => setTimeout(r, 40));
    // One email per database run (Mongo, then Postgres).
    expect(vi.mocked(sendSelectionSheetEmail).mock.calls.filter(c => c[1] === 'rita@x.com')).toHaveLength(2);
  });

  it('two people with the sheet open: the second save is told, with what is there now', async () => {
    const stale = await same(SEATTLE, a => a.put(`/api/checkin/${SEED.pat}`).send({ specialNotes: 'x', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }));
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('conflict');
    const current = (await t.on('mongo', () => OfficeCheckIn.findById(SEED.pat).lean()))!;
    await same(SEATTLE, a => a.put(`/api/checkin/${SEED.pat}`).send({ specialNotes: 'saved', expectedUpdatedAt: current.updatedAt!.toISOString() }));
  });

  it('refused without the switch for what it changes, for a missing check-in, and for a stranger’s branch', async () => {
    await same(VIEWER, a => a.put(`/api/checkin/${SEED.pat}`).send({ name: 'X' }));
    await same(SEATTLE, a => a.put(`/api/checkin/${oid()}`).send({ name: 'X' }));
    await same(SEATTLE, a => a.put(`/api/checkin/${SEED.dal}`).send({ name: 'X' }));
  });

  it('the email: found, refused for another branch, and with prices only when asked', async () => {
    vi.mocked(sendSelectionSheetEmail).mockClear();
    await same(SEATTLE, a => a.post(`/api/checkin/${SEED.pat}/send-email`).send({ email: 'pat@example.com', withPrices: true }));
    const sent = vi.mocked(sendSelectionSheetEmail).mock.calls;
    expect(sent).toHaveLength(2);
    expect(normalize({ ...(sent[1]![0] as Loose), _id: 0 })).toEqual(normalize({ ...(sent[0]![0] as Loose), _id: 0 }));
    expect((sent[0]![3] as Loose).showPrices).toBe(true);
    expect((await same(SEATTLE, a => a.post(`/api/checkin/${SEED.dal}/send-email`).send({ email: 'a@b.com' }))).status).toBe(403);
    expect((await same(SEATTLE, a => a.post(`/api/checkin/${oid()}/send-email`).send({ email: 'a@b.com' }))).status).toBe(404);
  });
});

describe('deleting', () => {
  it('removes the check-in and its sheet; a stranger’s branch, a missing one and a login without Delete are refused', async () => {
    await same(VIEWER, a => a.delete(`/api/checkin/${SEED.pat}`));
    expect((await same(SEATTLE, a => a.delete(`/api/checkin/${SEED.dal}`))).status).toBe(403);
    expect((await same(SEATTLE, a => a.delete(`/api/checkin/${oid()}`))).status).toBe(404);
    expect((await same(SEATTLE, a => a.delete(`/api/checkin/${SEED.pat}`))).status).toBe(200);
    expect((await same(SEATTLE, a => a.get(`/api/checkin/${SEED.pat}`))).status).toBe(404);
    expect(await t.differences()).toEqual([]);
  });
});
