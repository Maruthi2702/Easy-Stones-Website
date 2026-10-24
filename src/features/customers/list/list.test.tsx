// @vitest-environment jsdom
// The Customers list renders: rows with ⚠ flags and the pager, the empty
// state, filters, the drawer, selection with the bulk bar and its Delete
// confirmation, and phone rows. The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const USER = {
  _id: 'u1', id: 'u1', name: 'Krish', role: 'admin', assignedLocations: ['*'], location: 'Seattle',
  permissions: ['view_customers', 'view_customer_profile', 'add_customers', 'manage_customers', 'delete_customers', 'export_customers', 'import_customers', 'add_visits']
};
const row = (i: number, o: Record<string, unknown> = {}) => ({
  _id: `c${i}`, company: `Company ${i}`, contactName: `Person ${i}`, phone: '2065550100', email: `p${i}@x.com`, status: 'Onboarded',
  customerType: 'Fabricator', level: 'Level - 2', location: 'Seattle', address: { street: `${i} Main`, city: 'Seattle', state: 'WA' }, ...o
});
let list: Record<string, unknown>[] = [];
const answer = (url: string) => {
  const u = String(url);
  const body = u.includes('/api/customers/list') ? { partners: list, totalCount: list.length ? 312 : 0, totalPages: list.length ? 7 : 1 }
    : u.includes('/api/customers/cities') ? ['Seattle', 'Tacoma']
      : u.includes('/api/customers/view-counts') ? { incomplete: 4 }
        : u.includes('/api/salesreps') ? { data: [{ _id: 'u1', name: 'Krish', role: 'admin' }, { _id: 'u2', name: 'Rita', role: 'sales_rep', location: 'Spokane' }] }
          : u.includes('/api/admin/locations') ? [{ name: 'Seattle' }, { name: 'Spokane' }]
            : u.includes('/api/customers/c1') ? { ...row(1), visits: [{ _id: 'v1', date: '2026-10-01', purpose: 'Quick Note', notes: 'Dropped samples' }] }
              : [];
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: USER, loading: false }) }));
vi.mock('../../../api/authFetch', () => ({ authFetch: (u: string) => answer(u) }));

const { default: PartnersSheet } = await import('./PartnersSheet');
const { CustomerDrawer } = await import('../index');
const { clearListCache } = await import('./listOptions');

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const open = async () => { render(<PartnersSheet isSidebarOpen />); await settle(); };
const sheetButton = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLElement;

beforeEach(() => {
  clearListCache();
  setWidth(1280);
  window.history.replaceState({}, '', '/sales?tab=customers');
  list = Array.from({ length: 12 }, (_, i) => row(i + 1));
  list[2] = row(3, { phone: '', email: '' });
});
afterEach(() => cleanup());

describe('Customers list', () => {
  it('lists customers with their flags and the pager', async () => {
    await open();
    expect(screen.getAllByText('Company 12').length).toBeGreaterThan(0);
    expect(document.querySelector('.cl-flag')?.getAttribute('aria-label')).toBe('Incomplete: No phone, No email');
    expect(document.body.textContent).toContain('of 312');
    expect(window.location.search).toContain('p=1');
  });
  it('shows the empty state', async () => {
    list = [];
    await open();
    expect(document.querySelector('.cl-empty h3')?.textContent).toMatch(/^No (fabricators yet|customers match these filters)$/);
    expect(screen.getAllByText('Add customer').length).toBeGreaterThan(0);
  });
  it('opens the rep filter grouped by branch', async () => {
    await open();
    fireEvent.click(sheetButton('Sales rep'));
    expect(screen.getByText('Krish (you)')).toBeTruthy();
    expect(document.querySelector('.cl-pop-grp')?.textContent).toBeTruthy();
  });
  it('opens a row in the drawer', async () => {
    await open();
    fireEvent.click(document.querySelectorAll('.cl-table tbody tr')[0]);
    await settle();
    expect(screen.getByText('Dropped samples')).toBeTruthy();
    expect(document.querySelector('.cl-pager-pos')?.textContent).toContain('1');
  });
  it('selects rows, then asks for the count before deleting more than ten', async () => {
    await open();
    fireEvent.click(document.querySelector('.cl-table thead input[type="checkbox"]') as Element);
    expect(screen.getByText('12 selected')).toBeTruthy();
    fireEvent.click(document.querySelector('.cl-bb.danger') as Element);
    expect(screen.getByText('Type 12 to confirm')).toBeTruthy();
  });
  it('shows three-line rows on a phone', async () => {
    setWidth(375);
    await open();
    expect(document.querySelectorAll('.cl-li-main').length).toBe(12);
    expect((document.querySelector('.cl-search input') as HTMLInputElement).placeholder).toBe('Search customers');
  });
});

describe('Customer drawer (shared with the Route Planner and the visit card)', () => {
  it('opens on its own with a screen\'s own section', async () => {
    render(<CustomerDrawer customer={row(1)} onClose={() => {}} onOpenProfile={() => {}} onEdit={() => {}} onDelete={() => {}}
      onStatusChange={async () => true} mapSection={<div>Map actions</div>} className="rpv2-host" />);
    await settle();
    expect(screen.getByText('Map actions')).toBeTruthy();
    expect(document.querySelector('.cl-pager')).toBeNull();
    expect(document.querySelector('.cl-drawer.rpv2-host')).toBeTruthy();
  });
});
