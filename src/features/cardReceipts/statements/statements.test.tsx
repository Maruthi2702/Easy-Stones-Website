// @vitest-environment jsdom
// Credit Card Receipts → Statements (the Amex check): the tab opens for someone with only the
// Amex check switch, shows the month's lines with their status and the cards not set up, and a
// tile filters the list. The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { periodLabel, personOptions, visibleLines } from './statementsView';
import type { StatementLine } from './statementsApi';

const line = (reference: string, o: Partial<StatementLine> = {}): StatementLine => ({
  reference, date: '2026-11-05', description: 'CHEVRON 0207730', cardMember: 'MARUTHI PONUGUPATI', digits: '92069', cents: 1200, kind: 'charge',
  amexCategory: 'Transportation-Fuel', cityState: 'SEATTLE WA', cardId: 'c1', cardLabel: 'MARU92069', holderId: 'u1', holderName: 'Maruthi Ponugupati',
  expenseId: 'e1', expenseStatus: 'missing', status: 'missing', ...o
});
const LINES = [
  line('r1'),
  line('r2', { description: 'JINYA RAMEN BAR', cents: 5040, status: 'matched', expenseStatus: 'waiting' }),
  line('r3', { description: 'ONLINE PAYMENT - THANK YOU', cents: -50000, kind: 'credit', status: 'no_receipt', expenseId: null, expenseStatus: null }),
  line('r4', { description: 'OFFICE DEPOT', cardMember: 'SRINI MANAM', digits: '93018', cardId: null, cardLabel: '', holderName: '', status: 'no_card', expenseId: null, expenseStatus: null })
];
const VIEW = {
  lines: LINES,
  unknownCards: [{ digits: '93018', cardMember: 'SRINI MANAM', charges: 1, cents: 1200, first: '2026-11-05', last: '2026-11-05', suggestedUserId: 'u2' }],
  missingNow: { count: 3, cents: 4100 },
  imports: [{ id: 'i1', fileName: 'amex.xlsx', periodFrom: '2026-11-01', periodTo: '2026-11-07', lines: 4, added: 4, chargesCents: 7440, byName: 'Ann Count', at: '2026-11-08T17:00:00Z' }],
  people: [{ id: 'u1', name: 'Maruthi Ponugupati', role: 'sales_rep', location: 'Seattle', active: true, card: 'MARU92069' }, { id: 'u2', name: 'Srini Manam', role: 'sales_rep', location: 'Seattle', active: true, card: '' }],
  missingFrom: '2026-11-01'
};
const posted: { url: string; body: unknown }[] = [];
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
const answer = (url: string, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST') { posted.push({ url: u, body: JSON.parse(String(init.body || '{}')) }); return ok({ check: { linked: 0, created: 1, retired: 0, cardsFound: 1 } }); }
  if (/\/statements\?month=/.test(u)) return ok(VIEW);
  if (/\/me$/.test(u)) return ok({ user: { id: 'a1', name: 'Ann Count', location: 'Seattle' }, card: null, categories: [], approverRoles: [], today: '2026-11-20' });
  if (/\/expenses/.test(u)) return ok({ expenses: [] });
  return ok({});
};
vi.mock('../../../api/authFetch', () => ({ authFetch: (u: string, init?: RequestInit) => answer(u, init), resetSessionExpiredGuard() {} }));

const { default: CardReceiptsPage } = await import('../CardReceiptsPage');
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const text = () => document.body.textContent || '';

beforeEach(() => { posted.length = 0; Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

describe('the Statements tab', () => {
  it('opens on Statements for the Amex check switch alone, with lines, statuses and the cards not set up', async () => {
    render(<CardReceiptsPage currentUser={{ _id: 'a1', displayName: 'Ann Count', permissions: ['check_amex_statements'] }} />);
    await settle();
    expect(document.querySelector('.ccr-tab.is-on')?.textContent).toBe('Statements');
    expect(text()).toContain('Last upload 11-08-2026 by Ann Count');
    expect(text()).toContain('3 receipts still missing · $41.00');
    expect(text()).toContain('Cards not set up · 1');
    expect(text()).toContain('SRINI MANAM');
    expect(document.querySelectorAll('.ccr-st-lines tbody tr')).toHaveLength(4);
    expect(text()).toContain('Receipt uploaded');
    expect(text()).toContain('No receipt needed');
    // The Missing receipt tile lists only those.
    const tile = [...document.querySelectorAll('.ccr-tile')].find((t) => t.textContent?.includes('Missing receipt'))!;
    fireEvent.click(tile);
    expect(document.querySelectorAll('.ccr-st-lines tbody tr')).toHaveLength(1);
  });

  it('sets up a card with the suggested holder', async () => {
    render(<CardReceiptsPage currentUser={{ _id: 'a1', displayName: 'Ann Count', permissions: ['check_amex_statements'] }} />);
    await settle();
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Set up card')!;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await settle();
    expect(posted).toEqual([{ url: expect.stringContaining('/api/card-receipts/statements/cards'), body: { digits: '93018', userId: 'u2', replace: false } }]);
    expect(text()).toContain('Card set up · 1 Missing receipt row made');
  });

  it('is not offered without the switch', async () => {
    render(<CardReceiptsPage currentUser={{ _id: 'u1', displayName: 'Maruthi', permissions: ['use_card_receipts', 'view_all_card_receipts'] }} />);
    await settle();
    expect([...document.querySelectorAll('.ccr-tab')].map((t) => t.textContent)).not.toContain('Statements');
  });
});

describe('the Statements view rules', () => {
  it('labels a period', () => {
    expect(periodLabel('2026-09-29', '2026-10-29')).toBe('Sep 29 – Oct 29, 2026');
    expect(periodLabel('2026-11-01', '2026-11-07')).toBe('Nov 1–7, 2026');
    expect(periodLabel('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
    expect(periodLabel(null, '2026-01-01')).toBe('');
  });
  it('searches and filters lines, the tiles counting the search', () => {
    const v = visibleLines(LINES, { search: 'srini', status: 'all' });
    expect(v.rows.map((l) => l.reference)).toEqual(['r4']);
    const m = visibleLines(LINES, { search: '', status: 'missing' });
    expect(m.rows.map((l) => l.reference)).toEqual(['r1']);
    expect(m.counts.matched).toEqual({ count: 1, cents: 5040 });
  });
  it('offers active people after Leave it for now, saying whose card would be replaced', () => {
    expect(personOptions(VIEW.people).map((o) => o.label)).toEqual(['Leave it for now', 'Maruthi Ponugupati', 'Srini Manam']);
    expect(personOptions(VIEW.people)[1]!.description).toContain('MARU92069');
  });
});
