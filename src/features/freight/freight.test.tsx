// @vitest-environment jsdom
// 3rd-Party Freight render: the list grouped by carrier with the tab counts and
// the phone cards, what a selection offers (and why paying is blocked), the
// one-step Approve & pay form and its PAY- toast, a charge's panel and its
// history, an invoice and the carrier list, the empty and error states, and a
// view-only login. The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const ABC = { _id: 'k1', name: 'ABC Freight Inc', paymentTerms: 'per_delivery', active: true, aliases: ['ABC Trucking'] };
const WX = { _id: 'k2', name: 'Western Express', paymentTerms: 'per_invoice', active: true, aliases: [] };
const charge = (id: string, o: Record<string, unknown> = {}) => ({
  _id: id, version: 1, status: 'draft', source: 'schedule', location: 'Seattle', deliveryDate: '2026-10-20', carrierId: 'k1', carrier: ABC,
  soNumber: `SO-${id}`, customerName: 'Pacific Granite', bolNumber: `BOL-${id}`, amountCents: 45000, flags: [], openFlags: [], ...o
});
const flag = { _id: 'f1', detail: 'The delivery moved.' };
const charges = [
  charge('1'),
  charge('2', { amountCents: null, customerName: 'Stone River' }),
  charge('3', { flags: [flag], openFlags: [flag] }),
  charge('4', { carrierId: 'k2', carrier: WX, invoiceId: 'inv1' }),
  charge('5', { status: 'approved', amountCents: 20000 })
];
const summary = { draft: { count: 4, cents: 135000 }, approved: { count: 1, cents: 20000 }, paid: { count: 0, cents: 0 }, void: { count: 0, cents: 0 }, flagged: 1, missingPrice: 1, toApprove: 4 };
const fake = { empty: false, fail: false, posted: [] as string[] };
const list = (url: string) => {
  if (fake.fail) return { status: 500, body: { error: 'The accounting database didn’t answer.' } };
  const status = new URL(url, 'http://x').searchParams.get('status');
  const items = fake.empty ? [] : charges.filter((c) => (status === 'approved' ? c.status === 'approved' : status === 'all' ? true : c.status === 'draft'));
  return { body: { items, total: items.length, page: 1, limit: 50, summary: fake.empty ? { ...summary, draft: { count: 0, cents: 0 }, flagged: 0, missingPrice: 0, toApprove: 0 } : summary } };
};
const routes: [RegExp, (url: string) => { status?: number; body: unknown }][] = [
  [/freight-charges\/pay/, () => ({ body: { payment: { paymentId: 'PAY-20261025-0001', totalCents: 45000 } } })],
  [/freight-charges\/approve/, () => ({ body: { ok: true } })],
  [/freight-charges\/1(\?|$)/, () => ({ body: { ...charges[0], history: [{ _id: 'e1', txnId: 'TX-1', action: 'created', at: '2026-10-20T19:00:00Z', changes: [] }] } })],
  [/freight-charges\/4(\?|$)/, () => ({ body: { ...charges[3], invoice: { invoiceNumber: 'WX-55', status: 'draft' }, history: [] } })],
  [/freight-charges(\?|$)/, list],
  [/carrier-invoices\/inv1/, () => ({ body: { _id: 'inv1', invoiceNumber: 'WX-55', invoiceDate: '2026-10-21', status: 'draft', carrier: WX, carrierId: 'k2', totalCents: 45000, charges: [charges[3]], history: [] } })],
  [/carriers(\?|$)/, () => ({ body: [ABC, WX] })]
];
const answer = (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') fake.posted.push(String(url).replace(/^.*\/api\/accounting/, ''));
  const hit = routes.find(([re]) => re.test(String(url)));
  const r = hit ? hit[1](String(url)) : { body: [] };
  return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string, init?: RequestInit) => answer(u, init), resetSessionExpiredGuard() {} }));

const { FreightTab } = await import('./index');

const ALL = ['view_freight_charges', 'add_freight_charges', 'edit_freight_charges', 'approve_freight_charges', 'pay_freight_charges',
  'void_freight_charges', 'export_freight_charges', 'view_carriers', 'add_carriers', 'edit_carriers', 'deactivate_carriers'];
const userWith = (permissions: string[]) => ({ _id: 'u1', id: 'u1', name: 'Krish', role: 'admin', location: 'Seattle', assignedLocations: ['*'], permissions });
const LOCATIONS = [{ name: 'Seattle' }, { name: 'Spokane' }];
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLElement;
const tick = (n: number) => fireEvent.click(document.querySelectorAll('.fr-table .fr-row .fr-chk')[n]);
const show = async (perms = ALL) => { render(<FreightTab currentUser={userWith(perms)} locationsList={LOCATIONS} />); await settle(); };

beforeEach(() => { fake.empty = false; fake.fail = false; fake.posted = []; try { window.localStorage.clear(); } catch { /* */ } });
afterEach(() => cleanup());

describe('3rd-Party Freight list', () => {
  it('groups the charges by carrier, with the tab counts, the tiles and the phone cards', async () => {
    await show();
    expect(screen.getByRole('heading', { name: '3rd-Party Freight' })).toBeTruthy();
    expect([...document.querySelectorAll('.fr-tab')].map((t) => t.textContent)).toEqual(['To approve41 to review', 'Approved1', 'Paid0', 'All5']);
    expect([...document.querySelectorAll('.fr-table .fr-grp-name')].map((g) => g.textContent?.split(' ')[0])).toEqual(['ABC', 'Western']);
    expect(document.querySelector('.fr-tiles')?.textContent).toContain('1 missing a price');
    expect(document.querySelectorAll('.fr-ccard').length).toBe(4);
    expect(screen.getAllByText('No price').length).toBe(2);
  });

  it('a selection offers Approve and Approve & pay, or says why paying is blocked', async () => {
    await show();
    tick(0);
    expect(document.querySelector('.fr-bar')?.textContent).toContain('1 selected · $450.00');
    expect(button('Approve')).toBeTruthy();
    expect(button('Approve & pay')).toBeTruthy();
    tick(1);
    expect(document.querySelector('.fr-bar-note')?.textContent).toBe('Add the missing price first.');
    fireEvent.click(button('Clear'));
    tick(2);
    expect(document.querySelector('.fr-bar-note')?.textContent).toContain('Mark the flagged charge reviewed');
  });

  it('without the pay permission there is no pay button; without approve, paying a waiting charge is blocked', async () => {
    await show(ALL.filter((p) => p !== 'pay_freight_charges'));
    tick(0);
    expect(button('Approve')).toBeTruthy();
    expect(button('Approve & pay')).toBeFalsy();
    cleanup();
    await show(ALL.filter((p) => p !== 'approve_freight_charges'));
    tick(0);
    expect(button('Approve')).toBeFalsy();
    expect(document.querySelector('.fr-bar-note')?.textContent).toContain('Approve them first');
  });

  it('Approve & pay opens the one-step form, and paying shows the PAY- id', async () => {
    await show();
    tick(0);
    fireEvent.click(button('Approve & pay'));
    expect(screen.getByText(/Paying approves it too/)).toBeTruthy();
    fireEvent.click(document.querySelector('.fm-btn-primary') as HTMLElement);
    await settle();
    expect(fake.posted).toEqual(['/freight-charges/pay']);
    expect(document.querySelector('.fr-toast')?.textContent).toContain('Paid 1 charge · $450.00 · PAY-20261025-0001');
    expect(document.querySelector('.fr-bar')).toBeNull();
  });

  it('Approve posts the ticked charges and says so', async () => {
    await show();
    tick(0);
    fireEvent.click(button('Approve'));
    await settle();
    expect(fake.posted).toEqual(['/freight-charges/approve']);
    expect(document.querySelector('.fr-toast')?.textContent).toContain('Approved 1 charge');
  });

  it('opens a charge in its panel, with its history and actions', async () => {
    await show();
    fireEvent.click(document.querySelectorAll('.fr-table .fr-row')[0]);
    await settle();
    expect(document.querySelector('.fr-drawer')?.getAttribute('aria-label')).toBe('Charge SO# SO-1');
    expect(screen.getByText('TX-1')).toBeTruthy();
    expect([...document.querySelectorAll('.fr-drawer-foot .fr-btn')].map((b) => b.textContent)).toEqual(['Edit', 'Approve', 'Approve & pay', 'Void']);
    fireEvent.click(button('Edit'));
    expect(screen.getByText('Edit charge')).toBeTruthy();
  });

  it('opens a carrier invoice from a charge on it', async () => {
    await show();
    fireEvent.click(document.querySelectorAll('.fr-table .fr-row')[3]);
    await settle();
    expect(document.querySelector('.fr-drawer')?.getAttribute('aria-label')).toBe('Charge SO# SO-4');
    expect(button('Void')).toBeFalsy();
    fireEvent.click(button('Open invoice #WX-55'));
    await settle();
    expect(document.querySelector('.fr-drawer')?.getAttribute('aria-label')).toBe('Invoice WX-55');
    expect(screen.getByText('Matches.')).toBeTruthy();
    expect([...document.querySelectorAll('.fr-drawer-foot .fr-btn')].map((b) => b.textContent)).toEqual(['Edit', 'Approve', 'Approve & pay', 'Void']);
  });

  it('More › Carriers lists the carriers; Add charge opens the form', async () => {
    await show();
    fireEvent.click(document.querySelector('.fr-more .fr-icon-btn') as HTMLElement);
    expect([...document.querySelectorAll('.fr-menu button')].map((b) => b.textContent)).toEqual(['Carriers', 'Enter carrier invoice', 'Export to Excel']);
    fireEvent.click(button('Carriers'));
    await settle();
    expect(screen.getByText('ABC Trucking')).toBeTruthy();
    expect(document.querySelector('.fr-menu')).toBeNull();
    fireEvent.click(screen.getByLabelText('Close', { selector: '.fr-drawer button' }));
    fireEvent.click(document.querySelector('.fr-add') as HTMLElement);
    expect(screen.getByText('Add a charge')).toBeTruthy();
  });

  it('shows the tab’s empty state once every branch is picked, and "No charges match" on the home branch', async () => {
    fake.empty = true;
    await show();
    expect(document.querySelector('.fr-empty h3')?.textContent).toBe('No charges match');
    fireEvent.click(document.querySelector('.fr-head .lf-btn') as HTMLElement);
    fireEvent.click(document.querySelector('.lf-clear') as HTMLElement);
    await settle();
    expect(document.querySelector('.fr-empty h3')?.textContent).toBe('Nothing waiting');
  });

  it('shows the server’s error with Retry', async () => {
    fake.fail = true;
    await show();
    expect(screen.getByRole('alert').textContent).toContain('The accounting database didn’t answer.');
    expect(button('Retry')).toBeTruthy();
  });

  it('a view-only login has no Add charge and only Carriers in the menu', async () => {
    await show(['view_freight_charges']);
    expect(document.querySelector('.fr-add')).toBeNull();
    fireEvent.click(document.querySelector('.fr-more .fr-icon-btn') as HTMLElement);
    expect([...document.querySelectorAll('.fr-menu button')].map((b) => b.textContent)).toEqual(['Carriers']);
    expect(document.querySelectorAll('.fr-table .fr-row').length).toBe(4);
  });
});
