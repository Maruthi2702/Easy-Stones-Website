// @vitest-environment jsdom
// Payments page render: the day's tiles and list (a return in red, a voided
// entry hidden until asked), a tile filtering the list with its shown total,
// the search count, the locked day (note, no ⋯, + disabled), a view-only
// login, and adding a Return through the form. The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const pay = (id: string, o: Record<string, unknown> = {}) => ({
  id, location: 'Seattle', date: '2026-10-30', customerId: 'c1', customerName: 'Cascade Countertops', method: 'check', cents: 485000,
  invoice: 'INV-20418', reference: '10233', note: '', enteredBy: 'Dee', createdAt: '2026-10-30T16:12:00Z', updatedBy: 'Dee',
  updatedAt: '2026-10-30T16:12:00Z', voided: null, history: [{ at: '2026-10-30T16:12:00Z', by: 'Dee', action: 'added', changes: '' }], ...o
});
const PAYMENTS = [
  pay('a'),
  pay('b', { customerName: 'Harbor Kitchen & Bath', method: 'card', cents: 127550, reference: '4421', invoice: 'INV-20431' }),
  pay('c', { customerName: 'Rainier Granite Fabrication', method: 'return', cents: -200000, invoice: 'INV-20356', reference: 'R-0912', note: '2 slabs returned' }),
  pay('d', { customerName: 'Harbor Kitchen & Bath', method: 'card', cents: 125750, voided: { at: '2026-10-30T16:14:00Z', by: 'Dee', reason: 'Typed the wrong amount' } })
];
const fake = { submitted: false, posted: [] as Record<string, unknown>[] };
const answer = (url: string, init?: RequestInit) => {
  const u = String(url);
  let body: unknown = {};
  if (/\/locations/.test(u)) body = { locations: ['Seattle', 'Spokane'] };
  else if (init?.method === 'POST') {
    const sent = JSON.parse(String(init.body));
    fake.posted.push(sent);
    body = { payment: pay(sent.id, { customerId: sent.customerId, customerName: sent.customerName, method: sent.method, cents: -Math.round(Number(sent.amount) * 100), date: sent.date }) };
  } else if (/customers\/dropdown/.test(u)) body = [{ _id: 'c9', company: 'Olympic Remodeling', city: 'Bremerton' }];
  else if (/payments-received\?/.test(u)) body = { payments: PAYMENTS, day: { submitted: fake.submitted, submittedBy: 'Maya', submittedAt: '2026-10-31T01:12:00Z', autoSubmitted: false }, today: '2026-10-30' };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string, init?: RequestInit) => answer(u, init), resetSessionExpiredGuard() {} }));

const { default: PaymentsPage } = await import('./PaymentsPage');

const ALL = ['view_payments', 'add_payments', 'edit_payments', 'void_payments'];
const userWith = (permissions: string[]) => ({ _id: 'u1', name: 'Krish', location: 'Seattle', assignedLocations: ['Seattle', 'Spokane'], permissions });
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const show = async (perms = ALL) => { render(<PaymentsPage currentUser={userWith(perms)} />); await settle(); };
const text = () => document.body.textContent || '';

beforeEach(() => { fake.submitted = false; fake.posted = []; Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

describe('the Payments page', () => {
  it('shows the day\'s tiles and list, nets the return and hides the voided entry', async () => {
    await show();
    expect(screen.getByRole('heading', { name: 'Payments' })).toBeTruthy();
    expect(text()).toContain('Seattle · Home');
    expect(document.querySelectorAll('.pay-table tbody tr')).toHaveLength(3);
    expect(text()).toContain('−$2,000.00');
    // 4,850.00 + 1,275.50 − 2,000.00
    expect(document.querySelector('.pay-tile.is-total .pay-tile-v')?.textContent).toBe('$4,125.50');
    expect(text()).toContain('•••• 4421');
    expect(text()).not.toContain('Typed the wrong amount');
  });

  it('filters by a tile and totals what is listed', async () => {
    await show();
    const card = [...document.querySelectorAll('.pay-tile')].find((b) => b.textContent?.startsWith('Credit Card')) as HTMLElement;
    fireEvent.click(card);
    expect(document.querySelectorAll('.pay-table tbody tr')).toHaveLength(1);
    expect(document.querySelector('tr.pay-shown')?.textContent).toContain('Credit Card · 1 entry');
    expect(document.querySelector('tr.pay-shown')?.textContent).toContain('$1,275.50');
  });

  it('counts search matches', async () => {
    await show();
    fireEvent.change(screen.getByLabelText('Search payments'), { target: { value: 'harbor' } });
    expect(text()).toContain('1 of 3');
  });

  it('locks a submitted day: a note, no row actions, the + off', async () => {
    fake.submitted = true;
    await show();
    expect(text()).toContain('was submitted by Maya');
    expect(document.querySelectorAll('.pay-table [aria-haspopup="menu"]')).toHaveLength(0);
    expect((screen.getByLabelText('Add payment') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a view-only login no + and no row actions', async () => {
    await show(['view_payments']);
    expect(screen.queryByLabelText('Add payment')).toBeNull();
    expect(document.querySelectorAll('.pay-table [aria-haspopup="menu"]')).toHaveLength(0);
  });

  it('asks for every required field, then saves a Return as negative', async () => {
    await show();
    fireEvent.click(screen.getByLabelText('Add payment'));
    await settle();
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Save payment') as HTMLElement);
    await settle();
    expect(text()).toContain('3 fields need attention');
    fireEvent.click(document.getElementById('pay-company') as HTMLElement);
    await settle();
    fireEvent.click([...document.querySelectorAll('.fm-opt')].find((b) => b.textContent?.includes('Olympic Remodeling')) as HTMLElement);
    fireEvent.click(document.getElementById('pay-method') as HTMLElement);
    fireEvent.click([...document.querySelectorAll('.fm-opt')].find((b) => b.textContent?.includes('Return')) as HTMLElement);
    expect(document.querySelector('.pay-money.is-return span')?.textContent).toBe('−$');
    fireEvent.change(document.getElementById('pay-amount') as HTMLElement, { target: { value: '1000' } });
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Save payment') as HTMLElement);
    await settle();
    expect(fake.posted[0]).toMatchObject({ location: 'Seattle', customerId: 'c9', customerName: 'Olympic Remodeling', method: 'return', amount: '1000' });
    expect(text()).toContain('Return saved as −$1,000.00');
  });
});
