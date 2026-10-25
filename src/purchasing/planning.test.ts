import { describe, it, expect } from 'vitest';
import { inclusiveDays, validDay, normalizeInbound, project, packContainers, variantKey } from './planning';
import type { Policy, InboundRow, DraftLine } from './types';
const policy: Policy = {
  product: 'Quartz 3CM',
  supplier: 'ABC',
  bundleSlabs: 6,
  minimumSlabs: 0,
  sfPerSlab: 1,
  weightKg: 400,
  mixGroup: 'same-origin-window',
  active: true,
};
const row = (over: Partial<InboundRow> = {}): InboundRow => ({
  po: 'P1',
  line: '1',
  product: 'Quartz 3CM',
  branch: 'Seattle',
  supplier: 'ABC',
  ordered: 120,
  received: 0,
  cancelled: 0,
  eta: '2026-12-08',
  confirmed: true,
  shipment: 'S1',
  shipped: 60,
  shipmentReceived: 0,
  shipmentEta: '2026-12-08',
  ...over,
});
const setup = (over: Partial<Parameters<typeof project>[0]> = {}) =>
  project({
    daily: 1.8,
    ready: 42,
    receipts: [
      {
        key: 'P1:1',
        product: policy.product,
        branch: 'Seattle',
        supplier: 'ABC',
        slabs: 24,
        eta: '2026-12-08',
        confirmed: true,
      },
    ],
    policy,
    today: '2026-10-24',
    leadDays: 90,
    reviewDays: 7,
    bufferDays: 21,
    ...over,
  });
describe('calendar and exact variant planning', () => {
  it('counts inclusive calendar days without DST distortion', () => {
    expect(inclusiveDays('2026-03-01', '2026-03-31')).toBe(31);
    expect(inclusiveDays('2026-10-24', '2026-10-24')).toBe(1);
    expect(validDay('2026-02-30')).toBe(false);
    expect(inclusiveDays('2026-10-24', '2026-10-01')).toBe(0);
  });
  it('normalizes whitespace/case without merging thickness or format', () => {
    expect(variantKey(' Quartz   3CM ')).toBe(variantKey('quartz 3cm'));
    expect(variantKey('Quartz 2CM')).not.toBe(variantKey('Quartz 3CM'));
  });
});
describe('SPS PO and shipment reconciliation', () => {
  it('keeps 120 ordered with 60 in transit at 120 inbound, not 180', () => {
    expect(normalizeInbound([row()]).reduce((n, r) => n + r.slabs, 0)).toBe(120);
  });
  it('moves partial receipts from remaining inbound exactly once', () => {
    const receipts = normalizeInbound([row({ received: 30, shipmentReceived: 30 })]);
    expect(receipts.reduce((n, r) => n + r.slabs, 0)).toBe(90);
    expect(receipts.find((r) => r.key.endsWith(':S1'))?.slabs).toBe(30);
  });
  it('handles two partial shipments with one parent balance', () => {
    const out = normalizeInbound([
      row({ shipped: 30 }),
      row({ shipment: 'S2', shipped: 30, shipmentEta: '2026-12-12' }),
    ]);
    expect(out.reduce((n, r) => n + r.slabs, 0)).toBe(120);
    expect(out).toHaveLength(3);
  });
  it('rejects duplicate shipments, conflicting totals and over-receipts', () => {
    expect(() => normalizeInbound([row(), row()])).toThrow(/duplicate/);
    expect(() => normalizeInbound([row(), row({ shipment: 'S2', ordered: 121 })])).toThrow(/conflicting/);
    expect(() => normalizeInbound([row({ received: 121 })])).toThrow();
    expect(() => normalizeInbound([row({ shipped: 121 })])).toThrow();
    expect(() => normalizeInbound([row({ shipmentReceived: 20, received: 0 })])).toThrow();
  });
});
describe('reorder targets and dated supply', () => {
  it('produces 150 slabs in the 90-day case and 96 at 60 days', () => {
    expect(setup().proposedSlabs).toBe(150);
    expect(setup({ leadDays: 60 }).proposedSlabs).toBe(96);
    expect(setup().urgentSlabs).toBe(96);
    expect(setup().stockoutOn).toBe('2026-11-17');
  });
  it('a late large receipt never erases an early shortage', () => {
    const p = setup({
      receipts: [
        {
          key: 'x',
          product: 'Quartz',
          branch: 'Seattle',
          supplier: 'ABC',
          slabs: 1000,
          eta: '2026-12-08',
          confirmed: true,
        },
      ],
    });
    expect(p.proposedSlabs).toBe(0);
    expect(p.bridgeShortfall).toBeGreaterThan(0);
    expect(p.stockoutOn).not.toBeNull();
    expect(p.points.at(-1)!.available).toBeGreaterThan(0);
  });
  it('excludes overdue, unconfirmed and beyond-horizon supply', () => {
    const receipts = [
      {
        key: 'late',
        product: 'Quartz',
        branch: 'Seattle',
        supplier: 'ABC',
        slabs: 1000,
        eta: '2026-10-23',
        confirmed: true,
      },
      {
        key: 'future',
        product: 'Quartz',
        branch: 'Seattle',
        supplier: 'ABC',
        slabs: 1000,
        eta: '2027-05-01',
        confirmed: true,
      },
      {
        key: 'unconfirmed',
        product: 'Quartz',
        branch: 'Seattle',
        supplier: 'ABC',
        slabs: 1000,
        eta: '2026-11-01',
        confirmed: false,
      },
    ];
    expect(setup({ receipts }).inbound).toBe(0);
    expect(setup({ receipts }).warnings).toHaveLength(2);
  });
  it('does not invent buys for zero demand, excess cover or discontinued variants', () => {
    expect(setup({ daily: 0, policy: { ...policy, minimumSlabs: 100 } }).proposedSlabs).toBe(0);
    expect(setup({ ready: 1000 }).proposedSlabs).toBe(0);
    expect(setup({ policy: { ...policy, active: false } }).proposedSlabs).toBe(0);
  });
});
describe('container allocation', () => {
  const line = (key: string, quantity: number, over: Partial<DraftLine> = {}): DraftLine => ({
    key,
    product: key,
    branch: 'Seattle',
    quantity,
    supplier: 'ABC',
    mixGroup: 'same-origin-window',
    bundleSlabs: 6,
    weightKg: 400,
    requiredOn: '2026-11-01',
    ...over,
  });
  const container = {
    payloadKg: 25000,
    tareKg: 600,
    maxSlabs: 60,
    layoutConfirmed: true,
    mixingConfirmed: true,
  };
  it('combines compatible exact needs without adding filler', () => {
    const loads = packContainers([line('A', 150), line('B', 30)], container);
    expect(loads).toHaveLength(3);
    expect(loads.reduce((n, l) => n + l.slabs, 0)).toBe(180);
    expect(loads.every((l) => l.grossKg <= 25000)).toBe(true);
    expect(loads[2]!.lines).toHaveLength(2);
  });
  it('respects payload independently of slab slots', () => {
    const loads = packContainers([line('A', 60, { weightKg: 800 })], container);
    expect(loads).toHaveLength(2);
    expect(loads.every((l) => l.slabs <= 30)).toBe(true);
  });
  it('keeps unapproved mixes, suppliers and destinations separate', () => {
    expect(
      packContainers([line('A', 6), line('B', 6)], { ...container, mixingConfirmed: false }),
    ).toHaveLength(2);
    expect(packContainers([line('A', 6), line('B', 6, { supplier: 'Other' })], container)).toHaveLength(2);
    expect(packContainers([line('A', 6), line('B', 6, { branch: 'Spokane' })], container)).toHaveLength(2);
  });
  it('blocks invalid bundles and unknown or impossible loading limits', () => {
    expect(() => packContainers([line('A', 7)], container)).toThrow();
    expect(() => packContainers([line('A', 6)], { ...container, layoutConfirmed: false })).toThrow();
    expect(() => packContainers([line('A', 6, { weightKg: 5000 })], container)).toThrow();
  });
});
