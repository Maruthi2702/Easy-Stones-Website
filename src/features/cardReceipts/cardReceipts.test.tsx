// @vitest-environment jsdom
// Credit Card Receipts page render: accounting's month (tiles, list, a tile
// filtering it), the approver's Waiting for me with a lost receipt that can't
// be approved without a comment, a cardholder adding a receipt, and a login
// with no card. The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const CATEGORIES = [
  { _id: 'k1', name: 'travel_lunch', label: 'Travel Lunch', order: 0, active: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } },
  { _id: 'k2', name: 'customer_lunch', label: 'Customer Lunch', order: 1, active: true, fields: { customer: true, attendees: true, purpose: false, recurring: false } },
  { _id: 'k3', name: 'fuel', label: 'Fuel', order: 2, active: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } }
];
const exp = (id: string, o: Record<string, unknown> = {}) => ({
  id, userId: 'u1', holderName: 'Maruthi Ponugupati', cardId: 'c1', cardLabel: 'MARU92069', location: 'Seattle', date: '2026-10-03',
  merchant: "McDonald's", cents: 1432, subtotalCents: 1297, taxCents: 135, tipCents: null, category: 'travel_lunch', customerId: '', customerName: '',
  attendees: [], purpose: '', note: '', recurring: false, receiptUrl: 'https://res.cloudinary.com/x/r.webp', lostReason: '', status: 'approved',
  approval: null, sentBack: null, voided: null, createdAt: '2026-10-03T17:21:00Z', updatedAt: '2026-10-03T17:21:00Z', history: [], mine: true, canDecide: false, ...o
});
const EXPENSES = [
  exp('a'),
  exp('b', { merchant: 'JINYA Ramen Bar', cents: 11579, category: 'customer_lunch', customerId: 'cu1', customerName: 'Cascade Countertops', attendees: ['Maruthi Ponugupati', 'J. Alvarez'], status: 'waiting', date: '2026-10-09' }),
  exp('c', { merchant: 'Kashish Cuisine of India', cents: 5729, category: 'customer_lunch', status: 'draft' }),
  exp('d', { userId: 'u2', holderName: 'Dana Whitfield', cardLabel: 'DANA41008', location: 'Kent', merchant: 'Staples', cents: 8642, category: '', status: 'sent_back', mine: false, sentBack: { by: 'x', byName: 'Dee', at: '2026-10-07T00:00:00Z', comment: 'Pick a category' } })
];
const WAITING = [exp('w1', { userId: 'u2', holderName: 'Dana Whitfield', cardLabel: 'DANA41008', merchant: 'CHEVRON', cents: 12500, category: 'fuel', receiptUrl: '', lostReason: 'The pump didn’t print one', status: 'waiting', mine: false, canDecide: true })];
const fake = { card: true as boolean, posted: [] as { url: string; body: Record<string, unknown> }[] };
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
const answer = (url: string, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body || '{}'));
    fake.posted.push({ url: u, body });
    if (/\/approve$/.test(u)) return ok({ expense: { ...WAITING[0], status: 'approved', canDecide: false } });
    return ok({ expense: exp(body.id || 'new', { merchant: body.merchant, cents: Math.round(Number(body.total) * 100), date: body.date, status: body.category ? 'waiting' : 'draft' }) });
  }
  if (/\/me$/.test(u)) return ok({ user: { id: 'u1', name: 'Maruthi Ponugupati', location: 'Seattle' }, card: fake.card ? { _id: 'c1', userId: 'u1', label: 'MARU92069', issuer: 'amex', lastDigits: '92069', active: true } : null, categories: CATEGORIES, approverRoles: ['manager'], today: '2026-10-20' });
  if (/scope=waiting/.test(u)) return ok({ expenses: WAITING });
  if (/scope=all/.test(u)) return ok({ expenses: EXPENSES });
  if (/scope=mine/.test(u)) return ok({ expenses: EXPENSES.filter((e) => e.mine) });
  if (/customers\/dropdown/.test(u)) return ok([]);
  return ok({});
};
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string, init?: RequestInit) => answer(u, init), resetSessionExpiredGuard() {} }));

const { default: CardReceiptsPage } = await import('./CardReceiptsPage');

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const show = async (permissions: string[]) => { render(<CardReceiptsPage currentUser={{ _id: 'u1', displayName: 'Maruthi Ponugupati', permissions }} />); await settle(); };
const text = () => document.body.textContent || '';

beforeEach(() => { fake.card = true; fake.posted = []; Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

describe('the Credit Card Receipts page', () => {
  it('shows accounting the month with tiles, and a tile filters the list', async () => {
    await show(['view_all_card_receipts', 'export_card_receipts']);
    expect(text()).toContain('October 2026 · All cardholders');
    expect(document.querySelector('.ccr-tile.is-total .ccr-tile-v')?.textContent).toBe('$273.82');
    expect(screen.getByText('Staples')).toBeTruthy();
    expect(text()).toContain('“Pick a category” · Dee');
    fireEvent.click(screen.getByRole('button', { name: /Draft/ }));
    expect(screen.queryByText('Staples')).toBeNull();
    expect(screen.getByText('Kashish Cuisine of India')).toBeTruthy();
    expect(screen.queryByLabelText('Add receipt')).toBeNull();
  });

  it('lets an approver open a lost receipt and approve it only with a comment', async () => {
    await show(['use_card_receipts', 'approve_card_receipts']);
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    expect(screen.getByText('CHEVRON')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Open CHEVRON/));
    expect(text()).toContain('“The pump didn’t print one”');
    const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(document.getElementById('ccr-comment')!, { target: { value: 'Burlington delivery run. OK.' } });
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await settle();
    expect(fake.posted.at(-1)).toMatchObject({ body: { comment: 'Burlington delivery run. OK.' } });
    expect(fake.posted.at(-1)!.url).toMatch(/w1\/approve$/);
  });

  it('lets a cardholder add a receipt with the round +', async () => {
    await show(['use_card_receipts']);
    expect(screen.queryByRole('tab')).toBeNull();
    fireEvent.click(screen.getByLabelText('Add receipt'));
    fireEvent.change(document.getElementById('ccr-merchant')!, { target: { value: 'SP PARK' } });
    fireEvent.change(document.getElementById('ccr-total')!, { target: { value: '12.85' } });
    expect(text()).toContain('Saves as a draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await settle();
    expect(fake.posted.at(-1)!.body).toMatchObject({ merchant: 'SP PARK', total: '12.85', date: '2026-10-20' });
    expect(text()).toContain('Saved as a draft');
  });

  it('tells someone with no card to ask accounting, and offers no +', async () => {
    fake.card = false;
    await show(['use_card_receipts']);
    expect(text()).toContain('You don’t have a company card set up yet');
    expect(screen.queryByLabelText('Add receipt')).toBeNull();
  });
});
