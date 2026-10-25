// @vitest-environment jsdom
// The side nav renders: the desktop rail with its fly-out (Home's empty pins,
// a section with the pin tip, closing it), the account menu, pinned pages with
// Default, and the drawer on tablets.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: { _id: 'u1', id: 'u1', name: 'Krish Patel', role: 'admin', assignedLocations: ['*'], permissions: ['view_dashboard', 'view_customers'] } as Record<string, unknown>, logout: async () => {} }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../api/authFetch', () => ({ authFetch: () => Promise.resolve(new Response('[]', { status: 200 })) }));

const { default: CustomerSidebar } = await import('./CustomerSidebar');
const base = {
  crmTab: 'dashboard', handleCrmTabChange: vi.fn(), isSidebarOpen: true, isMobile: false, setIsSidebarOpen: vi.fn(),
  theme: 'dark', toggleTheme: vi.fn(), pinnedTabs: [] as string[], onTogglePin: vi.fn(), onMakeDefault: vi.fn(), navOrder: null
};
const open = (p: Partial<typeof base> = {}) => render(<MemoryRouter><CustomerSidebar {...base} {...p} /></MemoryRouter>);
const sections = () => document.querySelectorAll('.side-nav-section');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Side nav', () => {
  it('shows the rail with the panel closed on desktop', () => {
    open();
    expect(document.querySelector('.side-nav')?.className).toContain('panel-hidden');
    expect(sections().length).toBeGreaterThan(1);
    expect(screen.getByLabelText('Account menu').textContent).toBe('KP');
  });
  it('opens Home with no pins, then a section with the pin tip, and closes it', () => {
    open();
    fireEvent.click(sections()[0]);
    expect(screen.getByText(/Pin the pages you use most/)).toBeTruthy();
    fireEvent.click(sections()[1]);
    expect(screen.getByText('Got it')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close menu panel'));
    expect(document.querySelector('.side-nav-panel')).toBeNull();
  });
  it('goes to a page and pins one', () => {
    open();
    fireEvent.click(sections()[1]);
    fireEvent.click(document.querySelector('.side-nav-panel .side-nav-link') as Element);
    expect(base.handleCrmTabChange).toHaveBeenCalledTimes(1);
    fireEvent.click(sections()[1]);
    fireEvent.click(document.querySelector('.side-nav-panel .side-nav-row-action') as Element);
    expect(base.onTogglePin).toHaveBeenCalledTimes(1);
  });
  it('opens the account menu', () => {
    open();
    fireEvent.click(screen.getByLabelText('Account menu'));
    expect(screen.getByText('My Profile')).toBeTruthy();
    fireEvent.click(screen.getByText('Light theme'));
    expect(base.toggleTheme).toHaveBeenCalled();
  });
  it('lists pins with the first as Default', () => {
    open({ crmTab: 'customers', pinnedTabs: ['customers', 'dashboard'] });
    fireEvent.click(sections()[0]);
    expect(screen.getByText('Default')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Make Dashboard your default page'));
    expect(base.onMakeDefault).toHaveBeenCalledWith('dashboard');
  });
  it('is a drawer on tablets, closed by its button', () => {
    open({ isMobile: true });
    expect(document.querySelector('.side-nav-panel')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(base.setIsSidebarOpen).toHaveBeenCalledWith(false);
  });
});
