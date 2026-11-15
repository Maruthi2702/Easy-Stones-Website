import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectId } from 'mongodb';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import * as schema from '../schema/index.ts';
import { copyFromMongo, copyAreaFromMongo, verifyArea, lockArea, lockCopies, AreaLockedError, emptySource, type CopySource } from './plan.ts';

const oid = () => new ObjectId();
const seattle = oid(), oldCustomer = oid(), d1 = oid(), d2 = oid(), t1 = oid();

const source = (): CopySource => ({
  ...emptySource(),
  locations: [{ _id: seattle, name: 'Seattle', shortCode: 'SEA' }],
  customers: [{ _id: oldCustomer, company: 'Old Co', contactName: 'Ann', email: 'a@old.example', location: 'Seattle' }],
  deliveries: [
    { _id: d1, id: 'del_1', customerName: 'Old Co', customerId: String(oldCustomer), location: 'Seattle', date: '2026-11-13', status: 'pending' },
    { _id: d2, id: 'del_2', customerName: 'New Co', customerId: '', location: 'Seattle', date: '2026-11-13', status: 'pending' }
  ],
  trucks: [{ _id: t1, id: 'truck1', name: 'Truck 1' }]
} as unknown as CopySource);

let open: OpenDb;
beforeAll(async () => {
  open = await openDb('pglite:memory');
  await migrateDb(open.db, 'pglite:memory');
  await copyFromMongo(open.db, source(), { write: true });
  await lockCopies(open.db, 'cutover'); // the whole-database copy is locked, as live is
}, 60_000);
afterAll(async () => { await open?.close(); });

describe('the deliveries-only copy', () => {
  it('refills deliveries and trucks, leaves customers alone, and works though the whole copy is locked', async () => {
    // A customer made in Postgres after cutover, which MongoDB has never heard of.
    const newCustomer = oid();
    await open.db.insert(schema.customers).values({ id: String(newCustomer), company: 'New Co', contactName: 'Bo', email: 'b@new.example', locationId: String(seattle) });
    const src = source();
    (src.deliveries as unknown[])[1] = { ...(src.deliveries as Record<string, unknown>[])[1], customerId: String(newCustomer) };
    (src.deliveries as unknown[]).push({ _id: oid(), id: 'del_3', customerName: 'Old Co', location: 'Seattle', date: '2026-11-14' });

    const report = await copyAreaFromMongo(open.db, src, 'deliveries', { write: true });
    expect(report.tables).toEqual({ deliveries: 3, trucks: 1 });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(3);
    const row = (await open.db.select().from(schema.deliveries).where(eq(schema.deliveries.ticketId, 'del_2')))[0];
    expect(row.customerId).toBe(String(newCustomer)); // linked to the live Postgres customer
    const customers = await open.db.select().from(schema.customers);
    expect(customers.map(c => c.company).sort()).toEqual(['New Co', 'Old Co']); // untouched
    expect(await verifyArea(open.db, src, 'deliveries')).toEqual([]);
  });

  it('verify reports a ticket that differs', async () => {
    const src = source();
    (src.deliveries as Record<string, unknown>[])[0].notes = 'changed in Mongo';
    expect((await verifyArea(open.db, src, 'deliveries')).join('\n')).toMatch(/deliveries/);
  });

  it('refuses for good once the area is locked, and does not touch the rows', async () => {
    await lockArea(open.db, 'deliveries', 'cutover');
    const before = (await open.db.select().from(schema.deliveries)).length;
    await expect(copyAreaFromMongo(open.db, emptySource(), 'deliveries', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.deliveries)).length).toBe(before);
    // a dry run still works, and the lock is kept alongside the global one
    await copyAreaFromMongo(open.db, source(), 'deliveries', { write: false });
    const [state] = await open.db.select().from(schema.mongoCopyState);
    expect(state.lockedAreas).toEqual(['deliveries']);
    expect(state.lockedAt).toBeTruthy();
  });
});

describe('the Credit Card Receipts copy', () => {
  const at = new Date('2026-11-13T21:05:00Z');
  const user = oid(), card = oid(), cat = oid(), exp = oid();
  const withCards = (): CopySource => ({
    ...source(),
    roles: [{ _id: oid(), name: 'staff', displayName: 'Staff', permissions: [] }],
    users: [{ _id: user, username: 'maru', displayName: 'Maru', password: 'x', role: 'staff', isActive: true }],
    companyCards: [{ _id: card, userId: String(user), label: 'MARU92069', issuer: 'amex', lastDigits: '92069', active: true, createdAt: at, updatedAt: at }],
    receiptCategories: [{ _id: cat, name: 'fuel', label: 'Fuel', order: 0, active: true, fields: {}, createdAt: at, updatedAt: at }],
    cardExpenses: [{
      _id: exp, userId: String(user), holderName: 'Maru', cardId: String(card), cardLabel: 'MARU92069', location: 'Seattle', date: '2026-11-13', month: '2026-11',
      merchant: 'Shell', cents: 6120, category: 'fuel', status: 'waiting', createdAt: at, updatedAt: at, history: [{ at, by: 'Maru', action: 'added', changes: '' }]
    }]
  } as unknown as CopySource);

  it('fills only its four tables, leaves the rest alone, then refuses for good once locked', async () => {
    await open.db.insert(schema.roles).values({ id: String(oid()), name: 'staff', displayName: 'Staff' } as never).onConflictDoNothing();
    await open.db.insert(schema.users).values({ id: String(user), username: 'maru', displayName: 'Maru', passwordHash: 'x', role: 'staff' } as never);
    const deliveriesBefore = (await open.db.select().from(schema.deliveries)).length;
    const report = await copyAreaFromMongo(open.db, withCards(), 'card_receipts', { write: true });
    expect(report.tables).toEqual({ company_cards: 1, receipt_categories: 1, card_expenses: 1, card_expense_history: 1 });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(deliveriesBefore);
    expect(await verifyArea(open.db, withCards(), 'card_receipts')).toEqual([]);
    const src = withCards();
    (src.cardExpenses as Record<string, unknown>[])[0].status = 'approved';
    expect((await verifyArea(open.db, src, 'card_receipts')).join('\n')).toMatch(/card_expenses/);
    await lockArea(open.db, 'card_receipts', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'card_receipts', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.cardExpenses)).length).toBe(1);
  });
});

describe('the operations copy (Payments, Check In + Selection Sheet, Daily Reports)', () => {
  const at = new Date('2026-11-13T21:05:00Z');
  const report = oid(), payment = oid(), checkIn = oid(), selection = oid();
  const withOps = (): CopySource => {
    const src = source();
    return {
      ...src,
      dailyReports: [{
        _id: report, date: '2026-11-13', location: 'Seattle', status: 'submitted', visitors: { homeowners: 3, fabricators: null },
        payments: { cash: { count: 1, amount: 20.25 } }, transfers: [{ fromTo: 'SEA — SLC', count: 1, slabs: 4, auto: true, ticketIds: ['del_1'] }],
        containers: [{ poNumber: 'PO1', material: 'Calacatta', slabs: 12 }], log: [{ at, by: 'Jo', action: 'submitted', note: '' }],
        submittedAt: at, createdAt: at, updatedAt: at
      }],
      paymentsReceived: [{
        _id: payment, location: 'Seattle', date: '2026-11-13', customerId: String(oldCustomer), customerName: 'Old Co', method: 'return',
        cents: -100000, history: [{ at, by: 'Jo', action: 'added' }], createdAt: at, updatedAt: at
      }],
      officeCheckIns: [{
        _id: checkIn, name: 'Visitor', phone: '555', location: 'Seattle', status: 'New',
        selections: [{ _id: selection, material: 'Taj', priceCentsPerSf: 2500 }], createdAt: at, updatedAt: at
      }]
    } as unknown as CopySource;
  };

  it('fills only its eight tables and leaves customers and deliveries alone', async () => {
    const deliveriesBefore = (await open.db.select().from(schema.deliveries)).length;
    const report1 = await copyAreaFromMongo(open.db, withOps(), 'operations', { write: true });
    expect(report1.tables).toEqual({
      payments_received: 1, payment_history: 1, office_check_ins: 1, check_in_selections: 1,
      daily_reports: 1, daily_report_transfers: 1, daily_report_containers: 1, daily_report_log: 1
    });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(deliveriesBefore);
    expect((await open.db.select().from(schema.customers)).length).toBeGreaterThan(0);
    expect(await verifyArea(open.db, withOps(), 'operations')).toEqual([]);
  });

  it('verify reports a report that differs, then refuses for good once locked', async () => {
    const src = withOps();
    (src.dailyReports as Record<string, unknown>[])[0].status = 'draft';
    expect((await verifyArea(open.db, src, 'operations')).join('\n')).toMatch(/daily_reports/);
    await lockArea(open.db, 'operations', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'operations', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.dailyReports)).length).toBe(1);
    const [state] = await open.db.select().from(schema.mongoCopyState);
    expect(state.lockedAreas).toContain('operations');
  });
});

describe('the Lost Sales copy', () => {
  const at = new Date('2026-11-14T18:00:00Z');
  const sale = oid(), liveOnly = oid();
  const withSales = (): CopySource => ({
    ...source(),
    lostSales: [{
      _id: sale, customerName: 'New Co', customerId: String(liveOnly), productName: 'Taj', lengthInches: 126, widthInches: 63, sfPerSlab: 55, slabsCount: 2,
      totalSf: 110, pricePerSf: 12.5, totalLostValue: 1375, reason: 'Price Too High', location: 'Seattle', date: at, createdAt: at, updatedAt: at
    }]
  } as unknown as CopySource);

  it('fills only the lost_sales table, linking to a customer that exists only in Postgres, and verifies', async () => {
    await open.db.insert(schema.customers).values({ id: String(liveOnly), company: 'Live Only', contactName: 'Cy', email: 'c@live.example', locationId: String(seattle) });
    const before = (await open.db.select().from(schema.deliveries)).length;
    const report = await copyAreaFromMongo(open.db, withSales(), 'lost_sales', { write: true });
    expect(report.tables).toEqual({ lost_sales: 1 });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(before);
    const [row] = await open.db.select().from(schema.lostSales);
    expect(row.customerId).toBe(String(liveOnly));
    expect(row.locationId).toBe(String(seattle));
    expect(await verifyArea(open.db, withSales(), 'lost_sales')).toEqual([]);
  });

  it('refuses for good once locked', async () => {
    const src = withSales();
    (src.lostSales as Record<string, unknown>[])[0].notes = 'changed in Mongo';
    expect((await verifyArea(open.db, src, 'lost_sales')).join('\n')).toMatch(/lost_sales/);
    await lockArea(open.db, 'lost_sales', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'lost_sales', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.lostSales)).length).toBe(1);
  });
});

describe('the Settings copy (app settings and the three archive tables)', () => {
  const at = new Date('2026-11-14T18:00:00Z');
  const setting = oid(), backup = oid(), lead = oid(), legacyCustomer = oid(), backedUpDoc = oid();
  const withSettings = (): CopySource => ({
    ...source(),
    appSettings: [{ _id: setting, key: 'navOrder', value: { sections: ['sales'], items: {} }, updatedBy: 'root', createdAt: at, updatedAt: at }],
    cloudinaryToS3Backups: [{ _id: backup, runId: 'run1', collection: 'customers', docId: backedUpDoc, fields: { photo: 'https://res.cloudinary.com/x/a.jpg' }, at }],
    legacyLeads: [{ _id: lead, name: 'Old Lead', company: 'Old Co', email: 'l@old.example', createdAt: at, updatedAt: at }],
    legacySalesCustomers: [{ _id: legacyCustomer, customerName: 'Old', company: 'Old Co', createdAt: at, updatedAt: at }]
  } as unknown as CopySource);

  it('fills only the four settings tables and verifies', async () => {
    const before = (await open.db.select().from(schema.deliveries)).length;
    const report = await copyAreaFromMongo(open.db, withSettings(), 'settings', { write: true });
    expect(report.tables).toEqual({ app_settings: 1, cloudinary_to_s3_backups: 1, legacy_leads: 1, legacy_sales_customers: 1 });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(before);
    const [row] = await open.db.select().from(schema.appSettings);
    expect(row.key).toBe('navOrder');
    expect(await verifyArea(open.db, withSettings(), 'settings')).toEqual([]);
  });

  it('refuses for good once locked', async () => {
    const src = withSettings();
    (src.appSettings as Record<string, unknown>[])[0].updatedBy = 'someone else';
    expect((await verifyArea(open.db, src, 'settings')).join('\n')).toMatch(/app_settings/);
    await lockArea(open.db, 'settings', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'settings', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.appSettings)).length).toBe(1);
  });
});

describe('the small ones copy (products, colours, crossovers, contact form, Team Files, sales resources)', () => {
  const at = new Date('2026-11-14T18:00:00Z');
  const product = oid(), bundle = oid(), color = oid(), sheet = oid(), cross = oid(), contact = oid(), file = oid(), resource = oid();
  const withSmall = (): CopySource => ({
    ...source(),
    products: [{ _id: product, id: 7, name: 'Taj', category: 'Quartzite', colors: [{ name: 'Cream' }], bundles: [{ _id: bundle, bundleNumber: '1', images: [] }], priceLevels: { level1: 12.5 }, createdAt: at, updatedAt: at }],
    easyStonesColors: [{ _id: color, name: 'Alpine', order: 0, createdAt: at, updatedAt: at }],
    crossoverColors: [{ _id: sheet, easyStonesName: 'Alpine', crossovers: [{ _id: cross, distributorName: 'MSI', distributorColorName: 'Grey', matchType: 'Similar', createdAt: at, updatedAt: at }], createdAt: at, updatedAt: at }],
    contactSubmissions: [{ _id: contact, name: 'Ann', email: 'a@x.test', message: 'Hi', createdAt: at, updatedAt: at }],
    teamFiles: [{ _id: file, name: 'Price list', type: 'link', content: 'https://x.test', isFolder: false, createdAt: at.toISOString().slice(0, 19) }],
    salesResources: [{ _id: resource, name: 'Old', type: 'file', content: 'abc', createdAt: at }]
  } as unknown as CopySource);

  it('fills only the nine small tables and verifies', async () => {
    const before = (await open.db.select().from(schema.deliveries)).length;
    const report = await copyAreaFromMongo(open.db, withSmall(), 'small', { write: true });
    expect(report.tables).toEqual({
      products: 1, product_colors: 1, product_bundles: 1, easy_stones_colors: 1, crossover_colors: 1, crossovers: 1,
      contact_submissions: 1, team_files: 1, sales_resources: 1
    });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(before);
    expect(await verifyArea(open.db, withSmall(), 'small')).toEqual([]);
  });

  it('refuses for good once locked', async () => {
    const src = withSmall();
    (src.easyStonesColors as Record<string, unknown>[])[0].name = 'Renamed';
    expect((await verifyArea(open.db, src, 'small')).join('\n')).toMatch(/easy_stones_colors/);
    await lockArea(open.db, 'small', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'small', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.easyStonesColors)).length).toBe(1);
  });
});

describe('the Inventory copy (stock, in-transit and Purchasing, one switch)', () => {
  const at = new Date('2026-11-14T18:00:00Z');
  const item = oid(), ship = oid(), scope = oid(), draft = oid();
  const withInventory = (): CopySource => ({
    ...source(),
    inventoryItems: [{ _id: item, product: 'Quartz 3CM', sku: 'Q3', location: 'Seattle', instockQty: 10, importedAt: at }],
    inventoryTransitShipments: [{
      _id: ship, location: 'Seattle', poNumber: 'PO1', containerNumber: 'C1', active: true, importedAt: at,
      lines: [{ product: 'Quartz 3CM', quantity: 4 }]
    }],
    inventoryRevision: [{ _id: 'inventory', revision: 3 }],
    purchasingScopes: [{ _id: scope, name: 'Seattle', branches: ['Seattle'], cohortId: 'c1', createdAt: at, updatedAt: at }],
    purchasingDrafts: [{ _id: draft, scopeId: scope, status: 'draft', createdAt: at, updatedAt: at }]
  } as unknown as CopySource);

  it('fills only the 18 inventory tables, verifies, and refuses for good once locked', async () => {
    const deliveriesBefore = (await open.db.select().from(schema.deliveries)).length;
    const report = await copyAreaFromMongo(open.db, withInventory(), 'inventory', { write: true });
    expect(Object.keys(report.tables)).toHaveLength(18);
    expect(report.tables).toMatchObject({ inventory_items: 1, inventory_transit_shipments: 1, inventory_transit_lines: 1, purchasing_scopes: 1, purchasing_drafts: 1 });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(deliveriesBefore);
    expect(await verifyArea(open.db, withInventory(), 'inventory')).toEqual([]);
    const src = withInventory();
    (src.inventoryItems as Record<string, unknown>[])[0].instockQty = 11;
    expect((await verifyArea(open.db, src, 'inventory')).join('\n')).toMatch(/inventory_items/);
    await lockArea(open.db, 'inventory', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'inventory', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.inventoryItems)).length).toBe(1);
  });
});

describe('the Cart & Holds copy', () => {
  const at = new Date('2026-11-14T18:00:00Z');
  const cart = oid(), hold = oid(), lock = oid(), history = oid(), liveOnly = oid(), newStaff = oid();
  const withHolds = (): CopySource => ({
    ...source(),
    salesCarts: [{
      _id: cart, userId: String(newStaff), userName: 'New Rep', customer: { id: String(liveOnly), name: 'Live Only' },
      lines: [{ slabKey: '14744-29', product: 'Taj', note: 'Island', addedAt: at }], createdAt: at, updatedAt: at
    }],
    salesHolds: [{
      _id: hold, number: 7, status: 'active', branch: 'Seattle', customer: { id: String(liveOnly), name: 'Live Only', contact: 'Cy' },
      job: 'Kitchen', expiresOn: '2026-11-21', expiresAt: at, releaseAt: at, createdBy: { id: String(newStaff), name: 'New Rep' },
      updatedBy: { id: String(newStaff), name: 'New Rep' }, requestId: 'req-1', __v: 2, createdAt: at, updatedAt: at,
      lines: [{ slabKey: '14744-30', serial: '14744-30', sfHundredths: 6446, priceCentsPerSf: 2450 }], slabKeys: ['14744-30']
    }],
    salesSlabReservations: [{ _id: lock, slabKey: '14744-30', holdId: hold, holdNumber: 7, customerName: 'Live Only', branch: 'Seattle', by: { id: String(newStaff), name: 'New Rep' }, expiresOn: '2026-11-21', createdAt: at, updatedAt: at }],
    salesCounters: [{ _id: 'hold', seq: 7 }],
    salesHoldHistory: [{ _id: history, holdId: hold, holdNumber: 7, action: 'created', by: { id: String(newStaff), name: 'New Rep' }, at, changes: [], note: 'one slab' }]
  } as unknown as CopySource);

  it('fills only the 7 holds tables (a cart of a user not in Postgres, a hold of a customer only in Postgres), verifies, and refuses for good once locked', async () => {
    await open.db.insert(schema.customers).values({ id: String(liveOnly), company: 'Live Only', contactName: 'Cy', email: 'c2@live.example', locationId: String(seattle) });
    const deliveriesBefore = (await open.db.select().from(schema.deliveries)).length;
    const report = await copyAreaFromMongo(open.db, withHolds(), 'holds', { write: true });
    expect(report.tables).toEqual({
      sales_carts: 1, sales_cart_lines: 1, sales_holds: 1, sales_hold_lines: 1, sales_slab_reservations: 1, sales_counters: 1, sales_hold_history: 1
    });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(deliveriesBefore);
    const [row] = await open.db.select().from(schema.salesHolds);
    expect(row.customerId).toBe(String(liveOnly));
    expect(row.version).toBe(2);
    expect((await open.db.select().from(schema.salesCarts))[0].userId).toBe(String(newStaff));
    expect(await verifyArea(open.db, withHolds(), 'holds')).toEqual([]);
    const src = withHolds();
    (src.salesHolds as Record<string, unknown>[])[0].job = 'Bath';
    expect((await verifyArea(open.db, src, 'holds')).join('\n')).toMatch(/sales_holds/);
    await lockArea(open.db, 'holds', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'holds', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.salesHolds)).length).toBe(1);
  });
});

describe('the Fuel Man copy', () => {
  const at = new Date('2026-11-13T21:05:00Z');
  const report = oid(), source1 = oid(), assignment = oid(), cost = oid(), audit = oid();
  const withFuel = (): CopySource => ({
    ...source(),
    fuelReports: [{
      _id: report, scopeKey: 's', fileHash: 'f', contentHash: 'c', periodKey: 's:2026-10', filename: 'oct.pdf', parsed: { month: '2026-10', totalCents: 4210, company: 'Test Fleet' },
      revision: 1, status: 'posted', dispositions: [], overrides: [], importedAt: at, importedBy: { id: 'finance', name: 'Finance' }, __v: 2
    }],
    fuelSources: [{ _id: source1, reportId: report, pdf: Buffer.from('%PDF-1.4 fake') }],
    fuelAssignments: [{
      _id: assignment, scopeKey: 's', externalId: 'A', reportedName: 'Driver Alp', driverKey: 'user:1', driverName: 'Driver Alpha',
      from: '2026-10-01', to: '', allocations: [{ location: 'Seattle', basisPoints: 10000 }], updatedBy: { id: 'finance', name: 'Finance' }, updatedAt: at
    }],
    fuelExpenses: [{ _id: cost, reportId: report, month: '2026-10', scopeKey: 's', externalId: 'A', driverKey: 'user:1', driverName: 'Driver Alpha', location: 'Seattle', category: 'fuel', amountCents: 4210, sourceLine: 3, date: '2026-10-05' }],
    fuelState: [{ _id: 's', revision: 4 }],
    fuelPeriods: [{ _id: 's:2026-10', scopeKey: 's', month: '2026-10', publishedReportId: report, closed: false }],
    fuelHistory: [{ _id: audit, reportId: report, scopeKey: 's', action: 'published', at, actor: { id: 'finance', name: 'Finance' }, note: 'ok', detail: { totalCents: 4210 } }]
  } as unknown as CopySource);

  it('fills only its nine tables (Accounting\'s stay out), verifies, and refuses for good once locked', async () => {
    const deliveriesBefore = (await open.db.select().from(schema.deliveries)).length;
    const copied = await copyAreaFromMongo(open.db, withFuel(), 'fuelman', { write: true });
    expect(copied.tables).toEqual({
      acct_fuelman_reports: 1, acct_fuelman_sources: 1, acct_fuelman_assignments: 1, acct_fuelman_assignment_allocations: 1,
      acct_fuelman_profiles: 0, acct_fuelman_expenses: 1, acct_fuelman_state: 1, acct_fuelman_periods: 1, acct_fuelman_history: 1
    });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(deliveriesBefore);
    expect((await open.db.select().from(schema.fuelReports))[0]!.version).toBe(2);
    expect(await verifyArea(open.db, withFuel(), 'fuelman')).toEqual([]);
    const src = withFuel();
    (src.fuelExpenses as Record<string, unknown>[])[0]!.amountCents = 1;
    expect((await verifyArea(open.db, src, 'fuelman')).join('\n')).toMatch(/acct_fuelman_expenses/);
    await lockArea(open.db, 'fuelman', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'fuelman', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.fuelReports)).length).toBe(1);
  });
});

describe('the Suppliers copy', () => {
  const at = new Date('2026-11-14T18:00:00Z');
  const supplier = oid(), login = oid(), po = oid(), block = oid();
  const withSuppliers = (): CopySource => ({
    ...source(),
    suppliers: [{ _id: supplier, name: 'Marmores do Sul', spsKey: 'marmores do sul', language: 'pt', createdAt: at, updatedAt: at, history: [{ at, by: 'Ana', side: 'staff', action: 'added' }] }],
    supplierLogins: [{ _id: login, supplierId: String(supplier), name: 'Marcos', email: 'm@sul.test', password: 'hash', createdAt: at, updatedAt: at }],
    supplierPos: [{
      _id: po, poNumber: '41872', supplierId: String(supplier), readyBy: '2026-12-01', __v: 3, createdAt: at, updatedAt: at,
      lines: [{ _id: 'l1', material: 'Taj', slabs: 56 }], history: [{ at, by: 'Dana', side: 'staff', action: 'added' }]
    }],
    supplierBlocks: [{
      _id: block, poId: String(po), poNumber: '41872', supplierId: String(supplier), lineId: 'l1', size: { length: 124, height: 76.5, unit: 'in' }, __v: 2, createdAt: at, updatedAt: at,
      bundles: [{ _id: 'b1', n: 1, slabs: 8, status: 'review', step1: { decision: 'approve', by: 'x', byName: 'Ravi', at, reason: '' } }], history: []
    }]
  } as unknown as CopySource);

  it('fills only the 9 suppliers tables, verifies, and refuses for good once locked', async () => {
    const report = await copyAreaFromMongo(open.db, withSuppliers(), 'suppliers', { write: true });
    expect(report.tables).toEqual({
      suppliers: 1, supplier_history: 1, supplier_logins: 1, supplier_pos: 1, supplier_po_lines: 1, supplier_po_history: 1,
      supplier_blocks: 1, supplier_bundles: 1, supplier_block_history: 0
    });
    expect((await open.db.select().from(schema.supplierPos))[0].version).toBe(3);
    expect(await verifyArea(open.db, withSuppliers(), 'suppliers')).toEqual([]);
    const src = withSuppliers();
    (src.suppliers as Record<string, unknown>[])[0].name = 'Other';
    expect((await verifyArea(open.db, src, 'suppliers')).join('\n')).toMatch(/suppliers/);
    await lockArea(open.db, 'suppliers', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'suppliers', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.suppliers)).length).toBe(1);
  });
});
