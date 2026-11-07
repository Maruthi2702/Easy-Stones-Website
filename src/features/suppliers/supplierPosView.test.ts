// Supplier POs' list rules (supplierPosView.ts): which POs show and in what
// order, the tiles, the queues, and the words the screens use.
import { describe, it, expect } from 'vitest';
import { NO_FILTERS, visiblePos, poTiles, poTotals, visibleBlocks, timeAgo, loginState, poMatches } from './supplierPosView';
import type { Block, Po, SupplierLoginInfo } from './types';

const po = (id: string, o: Partial<Po> = {}): Po => ({
  id, poNumber: id, supplierId: 's1', supplierName: 'Pedras Vale Verde', supplierCountry: 'Brazil', shipTo: 'Seattle', readyBy: '',
  buyerId: '', buyerName: 'Dana', lines: [{ id: 'L1', material: 'Taj Mahal Quartzite', thickness: '3 cm', finish: 'Polished', slabs: 60, note: '' }],
  note: null, source: 'typed', status: 'open', statusReason: '', assignedAt: null,
  coverage: [{ lineId: 'L1', ordered: 60, approved: 0, final: 0, review: 0, supplier: 0, offered: 0, rejected: 0 }],
  stage: 'supplier', blockStages: { review: 0, final: 0, supplier: 0, approved: 0, sent: 0 }, lastActivityAt: '2026-11-01T00:00:00Z',
  createdAt: null, updatedAt: null, createdBy: '', draftBlocks: 0, ...o
});

describe('the POs list', () => {
  const list = [
    po('41001', { lastActivityAt: '2026-11-05T00:00:00Z' }),
    po('41002', { stage: 'review', blockStages: { review: 2, final: 0, supplier: 0, approved: 0, sent: 2 } }),
    po('41003', { stage: 'covered', coverage: [{ lineId: 'L1', ordered: 60, approved: 64, final: 0, review: 0, supplier: 0, offered: 64, rejected: 8 }] }),
    po('41004', { status: 'closed', stage: 'closed' }),
    po('41005', { stage: 'final', shipTo: 'Kent', supplierId: 's2', supplierName: 'Selangor Quartz', lines: [{ id: 'L1', material: 'Calacatta Novo', thickness: '2 cm', finish: '', slabs: 40, note: '' }], blockStages: { review: 0, final: 1, supplier: 0, approved: 0, sent: 1 } })
  ];
  it('lists the open ones, what waits on us first, then the newest activity', () => {
    expect(visiblePos(list, NO_FILTERS).rows.map((p) => p.id)).toEqual(['41002', '41005', '41001', '41003']);
    expect(visiblePos(list, { ...NO_FILTERS, stage: 'all' }).rows.map((p) => p.id)).toContain('41004');
    expect(visiblePos(list, { ...NO_FILTERS, stage: 'covered' }).rows.map((p) => p.id)).toEqual(['41003']);
  });
  it('filters by branch and supplier, and searches PO #, supplier and material', () => {
    expect(visiblePos(list, { ...NO_FILTERS, shipTo: 'Kent' }).rows.map((p) => p.id)).toEqual(['41005']);
    expect(visiblePos(list, { ...NO_FILTERS, supplierId: 's2' }).rows.map((p) => p.id)).toEqual(['41005']);
    expect(visiblePos(list, { ...NO_FILTERS, search: 'calacatta 2 cm' }).rows.map((p) => p.id)).toEqual(['41005']);
    expect(poMatches(list[0]!, 'pedras 41001')).toBe(true);
    expect(poMatches(list[0]!, 'selangor')).toBe(false);
  });
  it('counts the tiles over open POs', () => {
    expect(poTiles(list, NO_FILTERS)).toEqual({ open: 4, review: 2, final: 1, supplier: 1, approvedSlabs: 64, orderedSlabs: 240 });
    expect(poTiles(list, { shipTo: 'Kent', supplierId: '' }).open).toBe(1);
    expect(poTotals(list[2]!)).toEqual({ ordered: 60, approved: 64, waiting: 0, rejected: 8 });
  });
});

describe('the queues and words', () => {
  it('lists the longest-waiting block first, filtered like the POs', () => {
    const b = (id: string, sentAt: string, shipTo = 'Seattle') => ({ id, sentAt, shipTo, supplierId: 's1', poNumber: id, blockNumber: id, supplierName: 'P', material: 'Taj' } as unknown as Block);
    expect(visibleBlocks([b('b', '2026-11-05'), b('a', '2026-11-01'), b('c', '2026-11-03', 'Kent')], NO_FILTERS).map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(visibleBlocks([b('b', '2026-11-05'), b('c', '2026-11-03', 'Kent')], { ...NO_FILTERS, shipTo: 'Kent' }).map((x) => x.id)).toEqual(['c']);
  });
  it('says how long ago', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    expect(timeAgo('2026-11-07T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-11-07T11:48:00Z', now)).toBe('12 min ago');
    expect(timeAgo('2026-11-07T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-11-05T12:00:00Z', now)).toBe('2 days ago');
    expect(timeAgo(null, now)).toBe('');
  });
  it('names a login’s state', () => {
    const l = (o: Partial<SupplierLoginInfo>): SupplierLoginInfo => ({ id: 'l', name: 'M', email: 'm@x', language: 'pt', active: true, hasPassword: true, invitedAt: null, invitedBy: '', linkExpiresAt: null, locked: false, lastLoginAt: null, lastSeenAt: null, ...o });
    expect(loginState(undefined).label).toBe('No login');
    expect(loginState(l({ active: false })).label).toBe('Turned off');
    expect(loginState(l({ locked: true })).colour).toBe('back');
    expect(loginState(l({ hasPassword: false, invitedAt: new Date().toISOString() })).label).toBe('Invite sent just now');
    expect(loginState(l({})).label).toBe('Set up');
  });
});
