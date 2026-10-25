// @vitest-environment jsdom
// Users & Roles renders: the Users list with its Online column, locked and
// inactive badges and row menus; team access (no roles, Unlock/Deactivate
// only); Add / Edit user; Roles & Permissions with a page card's dialog;
// Locations with the no-address banner and the Location form; Side Nav Order.
// The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const HOUR = 3600 * 1000;
const ADMIN = { _id: 'u1', id: 'u1', username: 'krish', role: 'admin', assignedLocations: ['*'], location: 'Seattle', permissions: ['manage_users'] };
const auth = { user: ADMIN as Record<string, unknown> };
const users = [
  { _id: 'u1', username: 'krish', displayName: 'Krish', email: 'k@es.com', role: 'admin', assignedLocations: ['*'], location: 'Seattle', isActive: true },
  { _id: 'u2', username: 'rita', displayName: 'Rita', email: 'rita@es.com', role: 'sales_rep', assignedLocations: ['Seattle'], location: 'Seattle', isActive: true },
  { _id: 'u3', username: 'old', displayName: 'Old Driver', role: 'driver', assignedLocations: ['Seattle'], isActive: false, deactivatedAt: '2026-09-01T12:00:00.000Z' },
  { _id: 'u4', username: 'lee', displayName: 'Lee', email: 'lee@es.com', role: 'sales_rep', assignedLocations: ['Seattle'], isActive: true, loginAttempts: 5, lockUntil: new Date(Date.now() + 2 * HOUR).toISOString() }
];
const roles = [
  { _id: 'r1', name: 'admin', displayName: 'Admin', isSystem: true, permissions: ['manage_users'] },
  { _id: 'r2', name: 'sales_rep', displayName: 'Sales Rep', isSystem: true, permissions: ['view_dashboard'] },
  { _id: 'r3', name: 'manager', displayName: 'Manager', isSystem: false, permissions: ['manage_team_users'], manageableRoles: ['sales_rep'] }
];
const locations = [
  { _id: 'l1', name: 'Seattle', fullName: 'Easy Stones - Seattle', shortCode: 'SEA', primaryContact: { name: 'Rita', address: { street: '1 Main St', city: 'Seattle', state: 'WA', zipCode: '98101' } } },
  { _id: 'l2', name: 'Spokane', rdc: 'Seattle' }
];
const calls: string[] = [];
const answer = (url: string) => {
  const u = String(url);
  calls.push(u);
  const body = u.includes('/api/admin/users/presence') ? [{ userId: 'u2', status: 'active', device: 'phone', tabs: 1 }]
    : u.includes('/api/admin/users') ? users
      : u.includes('/api/admin/roles') ? roles
        : [];
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string) => answer(u) }));
vi.mock('../../api/presence', () => ({ subscribePresence: () => () => {} }));
globalThis.fetch = ((u: string) => answer(u)) as typeof fetch;

const { default: UsersRolesTab } = await import('./UsersRolesTab');
const { default: NavOrderTab } = await import('./navOrder/NavOrderTab');

const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const open = async (section: string) => { render(<UsersRolesTab section={section} locations={locations} fetchLocations={() => {}} />); await settle(); };
const rowMenu = (n: number) => fireEvent.click(document.querySelectorAll('.users-table tbody .row-menu-btn')[n]);
const menuLabels = () => [...document.querySelectorAll('.row-menu-item')].map((b) => b.textContent?.trim());

beforeEach(() => { auth.user = ADMIN; calls.length = 0; });
afterEach(() => cleanup());

describe('Users & Roles', () => {
  it('lists people with who is online, locked and inactive', async () => {
    await open('users');
    expect(screen.getByText('Online now (1)')).toBeTruthy();
    expect(document.querySelector('.online-status.active')?.textContent).toContain('Online');
    expect(screen.getByText('Inactive')).toBeTruthy();
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getAllByText('Sales Rep').length).toBeGreaterThan(0);
    fireEvent.click(document.querySelector('.online-filter-btn') as Element);
    expect(document.querySelectorAll('.users-table tbody tr').length).toBe(1);
  });
  it("offers each row's actions, Unlock only when locked", async () => {
    await open('users');
    rowMenu(3);
    expect(menuLabels()).toEqual(['Edit', 'Unlock account', 'Deactivate', 'Delete']);
    cleanup(); await open('users');
    rowMenu(2);
    expect(menuLabels()).toContain('Reactivate');
  });
  it('opens Edit user with the lock and Unlock now', async () => {
    await open('users');
    rowMenu(3);
    fireEvent.click([...document.querySelectorAll('.row-menu-item')].find((b) => b.textContent?.includes('Edit')) as Element);
    expect(document.body.textContent).toContain('Edit user');
    expect(screen.getByText('Unlock now')).toBeTruthy();
  });
  it('opens Add user', async () => {
    await open('users');
    fireEvent.click(document.querySelector('.add-user-btn') as Element);
    expect(screen.getByText('Add a user')).toBeTruthy();
  });
  it('team access reads only its people and may unlock / deactivate', async () => {
    auth.user = { ...ADMIN, role: 'manager', permissions: ['manage_team_users'] };
    await open('users');
    expect(calls.some((u) => u.includes('/api/admin/roles'))).toBe(false);
    rowMenu(3);
    expect(menuLabels()).toEqual(['Unlock account', 'Deactivate']);
    expect(document.querySelector('.add-user-btn')).toBeNull();
  });
  it('edits a role: Sales Rep first, a card opens its switches, team roles show', async () => {
    await open('roles');
    expect(screen.getByText('Sales Rep Access Permissions')).toBeTruthy();
    fireEvent.click([...document.querySelectorAll('.page-perm-card')].find((c) => c.textContent?.includes('Users & Roles')) as Element);
    expect(screen.getAllByText('Turn all on').length).toBeGreaterThan(0);
    cleanup(); await open('roles');
    fireEvent.click(document.querySelectorAll('.role-list-item')[2]);
    expect(screen.getByText('People Manager can manage')).toBeTruthy();
    fireEvent.click(document.querySelector('.add-role-btn') as Element);
    expect(screen.getByText('Create Custom Role')).toBeTruthy();
  });
  it('lists locations, flags one with no address, opens the form', async () => {
    await open('locations');
    expect(screen.getByText('Spokane has no address yet.', { exact: false })).toBeTruthy();
    expect(screen.getByText('RDC: Easy Stones - Seattle')).toBeTruthy();
    fireEvent.click(document.querySelectorAll('.action-icon-btn')[0]);
    expect(document.body.textContent).toContain('Edit location');
  });
  it('shows "Access Restricted" when the list is refused', async () => {
    const real = globalThis.fetch;
    vi.spyOn(Response.prototype, 'ok', 'get').mockReturnValue(false);
    await open('users');
    expect(screen.getByText('Access Restricted')).toBeTruthy();
    vi.restoreAllMocks();
    globalThis.fetch = real;
  });
});

describe('Side Nav Order', () => {
  it('moves a section and saves the new order', async () => {
    const onSave = vi.fn(async () => {});
    render(<NavOrderTab order={null} onSave={onSave} />);
    expect(document.querySelector('.nvo-title')?.textContent).toBe('Side Nav Order');
    fireEvent.click(document.querySelectorAll('.nvo-arrow')[1]);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByText('Save order'));
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saved for everyone')).toBeTruthy();
  });
});
