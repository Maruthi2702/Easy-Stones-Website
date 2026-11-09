import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectId, Binary } from 'mongodb';
import { sql } from 'drizzle-orm';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { copyFromMongo, verifyCopy, emptySource, type CopySource } from './plan.ts';
import { uncopiedCollections, COPY_COLLECTIONS, NOT_COPIED } from './readMongo.ts';
import { packSnapshot, unpackSnapshot } from '../aws/snapshot.ts';

const oid = () => new ObjectId();
const seattle = oid(), role = oid(), rep = oid(), acme = oid();
const delivery = oid(), report = oid(), payment = oid(), checkIn = oid(), selection = oid(), hold = oid(), history = oid();
const item = oid(), shipment = oid(), scope = oid(), carrier = oid(), charge = oid(), flag = oid(), acctPay = oid(), audit = oid();
const fuelReport = oid(), fuelSource = oid(), fuelCost = oid(), card = oid(), category = oid(), expense = oid();
const supplier = oid(), po = oid(), block = oid(), permit = oid(), run = oid(), product = oid(), bundle = oid();
const spsRun = oid(), spsItem = oid(), lead = oid(), inbound = oid();
const at = new Date('2026-10-23T21:05:00Z');

function source(): CopySource {
  return {
    ...emptySource(),
    locations: [{ _id: seattle, name: 'Seattle' }],
    roles: [{ _id: role, name: 'sales_rep', displayName: 'Sales Rep', permissions: [] }],
    users: [{ _id: rep, username: 'jo', displayName: 'Jo Rep', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] }],
    customers: [{ _id: acme, company: 'Acme', contactName: 'Ann', email: 'a@acme.example', location: 'Seattle', createdAt: at }],

    deliveries: [{
      _id: delivery, id: 'del_1_abc', customerId: String(acme), customerName: 'Acme', truckId: 'drv_sergio', date: '2026-10-23',
      status: 'completed', deliveryType: 'transfer', location: 'Seattle', transferDestination: 'Nowhere', numberOfSlabs: 4,
      freightFee: 125.5, pod: { photos: ['https://x/p.jpg'], verified: true, signedAt: at }, createdAt: at, updatedAt: at
    }],
    dailyReports: [{
      _id: report, date: '2026-10-23', location: 'Seattle', status: 'submitted', visitors: { homeowners: 3, fabricators: null },
      deliveries: { assigned: 5, capacity: null }, pickups: { assigned: 1, capacity: 2 },
      payments: { cash: { count: 1, amount: 20.25 }, card: { count: null, amount: null } },
      transfers: [{ fromTo: 'SEA — SLC', count: 1, slabs: 4, auto: true, ticketIds: ['del_1_abc'] }],
      containers: [{ poNumber: 'PO1', material: 'Calacatta', slabs: 12 }],
      log: [{ at, by: 'Jo', action: 'submitted', note: '' }], submittedAt: at, createdAt: at, updatedAt: at
    }],
    paymentsReceived: [{
      _id: payment, location: 'Seattle', date: '2026-10-23', customerId: String(acme), customerName: 'Acme', method: 'return',
      cents: -100000, history: [{ at, by: 'Jo', action: 'added' }], createdAt: at, updatedAt: at
    }],

    officeCheckIns: [{
      _id: checkIn, name: 'Visitor', phone: '555', location: 'Seattle', status: 'New', loggedBy: { userId: rep, username: 'jo' },
      selections: [{ _id: selection, material: 'Taj', priceCentsPerSf: 2500 }], createdAt: at, updatedAt: at
    }],
    salesHolds: [{
      _id: hold, number: 7, status: 'active', branch: 'Seattle', customer: { id: String(acme), name: 'Acme' },
      expiresOn: '2026-11-01', expiresAt: at, releaseAt: at, lines: [{ slabKey: 'S1', sfHundredths: 5050, priceCentsPerSf: 1999 }],
      slabKeys: ['S1'], createdBy: { id: 'system', name: 'System' }, requestId: 'r1', __v: 2, createdAt: at, updatedAt: at
    }],
    salesHoldHistory: [{ _id: history, holdId: hold, holdNumber: 7, action: 'edited', at, changes: [{ field: 'job', from: null, to: 3 }] }],
    salesCounters: [{ _id: 'hold', seq: 7 }],

    inventoryItems: [{
      _id: item, product: 'Taj Mahal', serialNumber: 'SN-1', instockQty: 52.75, unitLandedCost: 18.4, location: 'Fabricator LLC',
      receivedDate: at, importedAt: at, createdAt: at, updatedAt: at
    }],
    inventoryTransitShipments: [{
      _id: shipment, poNumber: 'PO1', containerNumber: 'C1', location: 'Atlanta',
      lines: [{ product: 'Taj', slabs: null, quantity: 300.5, etaDate: at }], createdAt: at, updatedAt: at
    }],
    inventoryRevision: [{ _id: 'stock', revision: 3 }],

    purchasingScopes: [{
      _id: scope, name: 'NW', branches: ['Seattle'], aliases: [{ salesProduct: 'A', stockProduct: 'B' }],
      container: { payloadKg: 21000.5, maxSlabs: 40 }, createdAt: at, updatedAt: at
    }],
    purchasingInbound: [{ _id: inbound, scopeId: scope, rows: [{ any: 'shape', at }], receipts: [], createdAt: at, updatedAt: at }],

    acctCarriers: [{ _id: carrier, name: 'Fast', nameKey: 'fast', paymentTerms: 'per_invoice', createdAt: at, updatedAt: at }],
    acctFreightCharges: [{
      _id: charge, source: 'delivery', deliveryId: 'del_1_abc', location: 'Seattle', carrierId: carrier, amountCents: 12550,
      status: 'paid', payment: { paymentId: 'PAY-1', paidOn: '2026-10-24', method: 'check', recordedAt: at },
      flags: [{ _id: flag, code: 'delivery_changed', at }], sourceSnapshot: { amountCents: 12000 }, createdAt: at, updatedAt: at
    }],
    acctPayments: [{
      _id: acctPay, paymentId: 'PAY-1', kind: 'charges', carrierId: carrier, chargeIds: [charge], totalCents: 12550,
      paidOn: '2026-10-24', method: 'check', recordedAt: at
    }],
    acctAudit: [{ _id: audit, txnId: 'TX-1', entityType: 'charge', entityId: String(charge), action: 'paid', at, changes: [] }],
    fuelReports: [{ _id: fuelReport, scopeKey: 's', fileHash: 'f', contentHash: 'c', periodKey: 'p', parsed: { month: '2026-10' }, dispositions: [], overrides: [] }],
    fuelSources: [{ _id: fuelSource, reportId: fuelReport, pdf: new Binary(Buffer.from('%PDF-1.4 fake')) }],
    fuelExpenses: [{ _id: fuelCost, reportId: fuelReport, month: '2026-10', location: 'FWB', amountCents: 4210, sourceLine: 3, date: '2026-10-05' }],

    companyCards: [{ _id: card, userId: String(rep), label: 'JORE12345', lastDigits: '12345', createdAt: at, updatedAt: at }],
    receiptCategories: [{ _id: category, name: 'meals', label: 'Meals', fields: { attendees: true }, createdAt: at, updatedAt: at }],
    cardExpenses: [{
      _id: expense, userId: String(rep), cardId: String(card), cardLabel: 'JORE12345', location: '', date: '2026-10-22',
      month: '2026-10', merchant: 'Cafe', cents: 4500, category: 'meals', customerId: '', status: 'approved',
      approval: { by: String(rep), byName: 'Jo', at, comment: 'ok' }, history: [{ at, by: 'Jo', action: 'added' }], createdAt: at, updatedAt: at
    }],
    suppliers: [{ _id: supplier, name: 'Quarry', spsKey: 'quarry', history: [{ at, action: 'added', side: 'staff' }], createdAt: at, updatedAt: at }],
    supplierPos: [{
      _id: po, poNumber: 'PO-77', supplierId: String(supplier), readyBy: '2026-12-01',
      lines: [{ _id: 'L1', material: 'Taj', slabs: 40 }], note: { text: 'Hola', lang: 'es', translations: { en: 'Hi' } },
      createdAt: at, updatedAt: at
    }],
    supplierBlocks: [{
      _id: block, poId: String(po), poNumber: 'PO-77', supplierId: String(supplier), lineId: 'L1', size: { length: 120.5, height: 70, unit: 'in' },
      bundles: [
        { _id: 'B1', n: 1, slabs: 6, photoUrl: 'https://x/1.jpg', status: 'approved', step1: { decision: 'approve', by: 'u', at }, step2: { decision: 'approve', by: 'v', at } },
        { _id: 'B2', n: 2, status: 'retake', previousPhotos: [{ url: 'https://x/old.jpg', at }], unlock: { by: 'u', at, reason: 'wrong' } }
      ],
      stage: 'review', createdAt: at, updatedAt: at
    }],

    permits: [{
      _id: permit, source: 'whatcom', permitNumber: 'BLD-1', category: 'new_home', issuedOn: '2026-10-01', valuation: 450000,
      contacts: [{ role: 'Contractor', kind: 'contractor', company: 'Build Co', license: 'BUILDCO123' }, { role: 'Owner' }],
      firstSeenAt: at, lastSeenAt: at
    }],
    permitRuns: [{ _id: run, source: 'whatcom', kind: 'daily', since: '2026-09-01', startedAt: at, ok: true, unsortedTypes: [{ type: 'X', count: 2 }] }],

    products: [{
      _id: product, id: 101, name: 'Taj', category: 'Quartzite', priceLevels: { level1: 10.5 },
      bundles: [{ _id: bundle, bundleNumber: 'BN1', images: ['a.jpg'] }], createdAt: at, updatedAt: at
    }],
    spsImportRuns: [{ _id: spsRun, fileName: 'sps.xlsx', status: 'done', mapping: { a: 1 }, results: {}, planCounts: {}, createdAt: at, updatedAt: at }],
    spsImportItems: [{ _id: spsItem, runId: String(spsRun), seq: 1, key: 'acme', action: 'update', customerId: String(acme), before: { phone: '1' } }],
    legacyLeads: [{ _id: lead, company: 'Old Co', status: 'new', createdBy: rep, createdAt: at, updatedAt: at }]
  };
}

let open: OpenDb;
beforeAll(async () => {
  open = await openDb('pglite:memory');
  await migrateDb(open.db, 'pglite:memory');
}, 60_000);
afterAll(async () => { await open?.close(); });

const rows = async (table: string) =>
  ((await open.db.execute(sql.raw(`select * from ${table}`))) as unknown as { rows: Record<string, unknown>[] }).rows;

describe('every area copies and checks equal', () => {
  it('copies each area into its tables, linked by id', async () => {
    const report1 = await copyFromMongo(open.db, source(), { write: true });
    expect(await verifyCopy(open.db, source())).toEqual([]);
    expect(report1.tables).toMatchObject({
      deliveries: 1, daily_reports: 1, daily_report_transfers: 1, daily_report_containers: 1, daily_report_log: 1,
      payments_received: 1, payment_history: 1, office_check_ins: 1, check_in_selections: 1, sales_holds: 1, sales_hold_lines: 1,
      inventory_items: 1, inventory_transit_lines: 1, purchasing_scope_aliases: 1, acct_freight_charge_flags: 1,
      acct_payment_charges: 1, acct_fuelman_sources: 1, card_expense_history: 1, supplier_po_lines: 1, supplier_bundles: 2,
      permit_contacts: 2, product_bundles: 1, sps_import_items: 1, legacy_leads: 1
    });
    const [d] = await rows('deliveries');
    expect(d).toMatchObject({ ticket_id: 'del_1_abc', customer_id: String(acme), truck_key: 'drv_sergio', transfer_destination_id: null, freight_fee: '125.5' });
    const [p] = await rows('payments_received');
    expect(p.cents).toBe(-100000);
    const [pdf] = await rows('acct_fuelman_sources');
    expect(Buffer.from(pdf.pdf as Uint8Array).toString()).toBe('%PDF-1.4 fake');
    const bundles = await rows('supplier_bundles order by position');
    expect(bundles.map(b => [b.id, b.status, b.step2_decision, b.unlock_reason])).toEqual([['B1', 'approved', 'approve', null], ['B2', 'retake', null, 'wrong']]);
  });

  it('reports what it couldn’t link, never silently', async () => {
    const r = await copyFromMongo(open.db, source(), { write: false });
    expect(r.summary).toMatchObject({ 'deliveries.transfer_destination_id · not a location · blanked': 1 });
  });

  it('copies the same through the Lambda’s snapshot (ids, dates, decimals, PDF bytes)', async () => {
    await copyFromMongo(open.db, unpackSnapshot(packSnapshot(source())), { write: true });
    expect(await verifyCopy(open.db, source())).toEqual([]);
  });
});

describe('collections the copy doesn’t take', () => {
  it('stops on a collection with records it doesn’t know', () => {
    const known = Object.values(COPY_COLLECTIONS).map(name => ({ name, count: 5 }));
    expect(uncopiedCollections([...known, { name: 'admins', count: 0 }, { name: 'system.views', count: 1 }])).toEqual([]);
    expect(uncopiedCollections([...known, { name: 'newfeature', count: 3 }, { name: 'admins', count: 2 }]))
      .toEqual(['newfeature (3)', 'admins (2)']);
    expect(NOT_COPIED).toEqual(['admins', 'crossoversheets']);
  });
});
