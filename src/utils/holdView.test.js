import { describe, it, expect } from 'vitest';
import {
  HOLD_TABS, productSummary, longDate, dayMonth, releaseDayOf, expiryLine, elapsedShare, holdActions,
  priceDraftOf, sharedPrice, priceChanges, lineAmount, extendChoices, cartSlabsFor, historyLabel,
  changeText, visibleChanges, detailsOf, detailsPatch
} from './holdView.js';
import { HOLDS } from '../holds/permissions.js';
import { expiryMoments } from '../holds/holdRules.js';

// Seattle: Oct 10, 2026, 10:00 AM (PDT, UTC-7).
const NOW = new Date('2026-10-10T17:00:00Z');
const hold = (over = {}) => {
  const expiresOn = over.expiresOn || '2026-10-16';
  return {
    _id: 'h1', number: 25, status: 'active', branch: 'Seattle', expiresOn,
    ...expiryMoments(expiresOn, over.branch || 'Seattle'),
    createdAt: '2026-10-09T17:00:00Z', lines: [], ...over
  };
};
const user = (...perms) => ({ permissions: perms });

describe('tabs', () => {
  it('are Active, Expiring soon, Expired, Released, All — Converted waits for Sales Orders', () => {
    expect(HOLD_TABS.map((t) => t.id)).toEqual(['active', 'expiring', 'expired', 'released', 'all']);
  });
});

describe('productSummary', () => {
  it('names the first two products and counts the rest', () => {
    expect(productSummary([{ product: 'Taj Mahal 3CM', slabs: 12 }])).toBe('Taj Mahal 3CM ×12');
    expect(productSummary([
      { product: 'A', slabs: 1 }, { product: 'B', slabs: 2 }, { product: 'C', slabs: 1 }, { product: 'D', slabs: 1 }
    ])).toBe('A ×1 · B ×2 · 2 more');
    expect(productSummary([])).toBe('');
  });
});

describe('dates', () => {
  it('show a calendar day as that day, whatever the viewer’s zone', () => {
    expect(longDate('2026-10-16')).toBe('Oct 16, 2026');
    expect(dayMonth('2026-01-01')).toBe('Jan 1');
    expect(longDate('')).toBe('—');
  });

  it('frees an expired hold’s slabs at the start of the 8th day after its date', () => {
    expect(releaseDayOf(hold({ expiresOn: '2026-10-16' }))).toBe('2026-10-24');
  });
});

describe('expiryLine', () => {
  it('counts days on the branch clock and flags the last three', () => {
    expect(expiryLine(hold({ expiresOn: '2026-10-16' }), NOW)).toEqual({ text: '6 days to go', tone: 'ok' });
    expect(expiryLine(hold({ expiresOn: '2026-10-13' }), NOW)).toEqual({ text: '3 days to go', tone: 'soon' });
    expect(expiryLine(hold({ expiresOn: '2026-10-11' }), NOW)).toEqual({ text: 'Ends tomorrow', tone: 'soon' });
    expect(expiryLine(hold({ expiresOn: '2026-10-10' }), NOW)).toEqual({ text: 'Ends today', tone: 'soon' });
  });

  it('says when an expired hold lets go, and how a closed one ended', () => {
    expect(expiryLine(hold({ expiresOn: '2026-10-08' }), NOW)).toEqual({ text: 'Expired · slabs free Oct 16', tone: 'expired' });
    expect(expiryLine(hold({ status: 'released', releasedAt: '2026-10-09T20:00:00Z' }), NOW).tone).toBe('closed');
    expect(expiryLine(hold({ status: 'converted' }), NOW).text).toBe('Converted to an order');
  });

  it('elapsedShare runs 0 → 1 from creation to expiry', () => {
    const h = hold({ createdAt: '2026-10-09T17:00:00Z', expiresAt: '2026-10-11T17:00:00Z' });
    expect(elapsedShare(h, NOW)).toBe(0.5);
    expect(elapsedShare(h, new Date('2026-10-20T00:00:00Z'))).toBe(1);
    expect(elapsedShare({ createdAt: 'x', expiresAt: 'y' }, NOW)).toBe(1);
  });
});

describe('holdActions', () => {
  it('offers each change only with its own permission', () => {
    expect(holdActions(user(HOLDS.VIEW_OWN), hold())).toEqual({ edit: false, slabs: false, prices: false, extend: false, release: false, print: false });
    expect(holdActions(user(HOLDS.PRICES, HOLDS.PRINT), hold())).toMatchObject({ prices: true, print: true, edit: false, release: false });
  });

  it('keeps an expired hold changeable, and a released one print-only', () => {
    const all = user(...Object.values(HOLDS));
    expect(holdActions(all, hold({ expiresOn: '2026-10-01' }))).toMatchObject({ extend: true, release: true, slabs: true });
    expect(holdActions(all, hold({ status: 'released' }))).toEqual({ edit: false, slabs: false, prices: false, extend: false, release: false, print: true });
  });
});

describe('prices', () => {
  const lines = [
    { slabKey: 'A-1', product: 'Taj', sfHundredths: 6446, priceCentsPerSf: 2450 },
    { slabKey: 'A-2', product: 'Taj', sfHundredths: 6446, priceCentsPerSf: 2450 },
    { slabKey: 'B-1', product: 'Pearl', sfHundredths: 5510, priceCentsPerSf: null }
  ];

  it('starts from the saved prices and finds a product’s shared one', () => {
    const draft = priceDraftOf(lines);
    expect(draft).toEqual({ 'A-1': '24.50', 'A-2': '24.50', 'B-1': '' });
    expect(sharedPrice(lines.slice(0, 2), draft)).toBe('24.50');
    expect(sharedPrice(lines.slice(0, 2), { ...draft, 'A-2': '26' })).toBe('');
  });

  it('sends only changed prices, a blank as "no price", and refuses nonsense or $0', () => {
    const { changed, errors } = priceChanges(lines, { 'A-1': '$24.50', 'A-2': '26', 'B-1': '18.5' });
    expect(changed).toEqual([{ slabKey: 'A-2', price: '26.00' }, { slabKey: 'B-1', price: '18.50' }]);
    expect(errors).toEqual({});
    expect(priceChanges(lines, { 'A-1': '', 'A-2': '24.5', 'B-1': '' }).changed).toEqual([{ slabKey: 'A-1', price: null }]);
    expect(priceChanges(lines, { 'A-1': 'abc', 'A-2': '0', 'B-1': '' }).errors).toEqual({ 'A-1': 'Enter the price like 12.50', 'A-2': 'Enter the price like 12.50' });
  });

  it('works out a line’s amount from the saved price or the draft', () => {
    expect(lineAmount(lines[0])).toBe(157927); // 64.46 SF × $24.50
    expect(lineAmount(lines[2])).toBeNull();
    expect(lineAmount(lines[2], { 'B-1': '20' })).toBe(110200);
    expect(lineAmount(lines[0], { 'A-1': 'x' })).toBeNull();
  });
});

describe('extendChoices', () => {
  it('counts from the current expiry, or from today once it has passed', () => {
    expect(extendChoices(hold({ expiresOn: '2026-10-16' }), NOW).map((c) => c.expiresOn)).toEqual(['2026-10-23', '2026-10-30', '2026-11-15']);
    expect(extendChoices(hold({ expiresOn: '2026-10-05' }), NOW)[0].expiresOn).toBe('2026-10-17');
  });
});

describe('cartSlabsFor', () => {
  it('offers in-stock, unheld cart slabs not on the hold, priced like their product on it', () => {
    const h = hold({ lines: [
      { slabKey: 'A-1', product: 'Taj', priceCentsPerSf: 2450 },
      { slabKey: 'B-1', product: 'Pearl', priceCentsPerSf: 1800 },
      { slabKey: 'B-2', product: 'Pearl', priceCentsPerSf: 1900 }
    ] });
    const cart = [
      { slabKey: 'A-1', inStock: true, lock: { holdNumber: 25 }, slab: { product: 'Taj' } },
      { slabKey: 'A-3', inStock: true, lock: null, slab: { product: 'Taj' } },
      { slabKey: 'B-3', inStock: true, lock: null, slab: { product: 'Pearl' } },
      { slabKey: 'C-1', inStock: true, lock: null, slab: { product: 'New' } },
      { slabKey: 'D-1', inStock: false, lock: null, slab: null },
      { slabKey: 'E-1', inStock: true, lock: { holdNumber: 9 }, slab: { product: 'Taj' } }
    ];
    const offered = cartSlabsFor(h, cart);
    expect(offered.map((l) => [l.slabKey, l.suggestedPrice])).toEqual([['A-3', '24.50'], ['B-3', ''], ['C-1', '']]);
  });
});

describe('history', () => {
  it('labels every action the server and the expiry job write', () => {
    for (const a of ['created', 'edited', 'slabs_added', 'slabs_removed', 'slab_swapped', 'prices_changed', 'extended', 'expired', 'released']) {
      expect(historyLabel(a)).not.toBe(a);
    }
    expect(historyLabel('something_new')).toBe('something_new');
  });

  it('spells out each change', () => {
    expect(changeText({ field: 'price 14744-29', from: 2450, to: null })).toBe('14744-29: $24.50/SF → no price');
    expect(changeText({ field: 'expiresOn', from: '2026-10-16', to: '2026-10-30' })).toBe('Hold until: Oct 16, 2026 → Oct 30, 2026');
    expect(changeText({ field: 'slab', from: 'A-1', to: 'A-9' })).toBe('A-1 → A-9');
    expect(changeText({ field: 'chanceToClose', from: null, to: 75 })).toBe('Chance to close: — → 75%');
    expect(changeText({ field: 'note A-1', from: '', to: 'chip on edge' })).toBe('A-1 note: — → chip on edge');
    expect(changeText({ field: 'job', from: '', to: 'Miller kitchen' })).toBe('Job: — → Miller kitchen');
    expect(visibleChanges({ changes: [{ field: 'status', from: 'active', to: 'released' }] })).toEqual([]);
  });
});

describe('edit details', () => {
  const h = hold({ customer: { id: 'c1', name: 'Granite and Marble' }, job: 'Miller', chanceToClose: null, notes: '', commissionNotes: '' });

  it('sends only what changed, trimmed', () => {
    expect(detailsPatch(h, { ...detailsOf(h) })).toEqual({});
    expect(detailsPatch(h, { ...detailsOf(h), job: ' Miller kitchen ', chanceToClose: 75 })).toEqual({ job: 'Miller kitchen', chanceToClose: 75 });
    expect(detailsPatch(h, { ...detailsOf(h), customerId: 'c2', notes: '   ' })).toEqual({ customerId: 'c2' });
    expect(detailsPatch(h, { ...detailsOf(h), job: '' })).toEqual({ job: '' });
  });
});
