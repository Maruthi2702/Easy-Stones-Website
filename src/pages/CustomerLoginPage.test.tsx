// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CustomerLoginPage from './CustomerLoginPage';

const auth = vi.hoisted(() => ({ completeLogin: vi.fn(), startPasswordSetup: vi.fn(), user: null as { type: string } | null, passwordSetup: null as object | null }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
const request = vi.fn<typeof fetch>();
beforeEach(() => { vi.clearAllMocks(); request.mockReset(); auth.user = null; auth.passwordSetup = null; localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/login'); vi.stubGlobal('fetch', request); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function enter(email = 'alex@example.com', password = 'secret123') {
  fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}
const submit = () => fireEvent.submit(document.querySelector('form')!);

describe('Customer and staff portal login', () => {
  it('validates each field and focuses the one needing attention', () => {
    render(<MemoryRouter><CustomerLoginPage /></MemoryRouter>); submit();
    expect(screen.getByRole('alert').textContent).toContain('Enter the email address or username');
    expect(document.activeElement).toBe(screen.getByLabelText('Email or username'));
    enter('alex', ''); submit();
    expect(screen.getByRole('alert').textContent).toBe('Enter your password.');
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
    expect(request).not.toHaveBeenCalled();
  });
  it('posts credentials with cookies and completes login', async () => {
    request.mockResolvedValue(Response.json({ user: { id: 'c1', type: 'customer' } }));
    render(<MemoryRouter><CustomerLoginPage /></MemoryRouter>); enter(); submit();
    await waitFor(() => expect(auth.completeLogin).toHaveBeenCalledWith({ id: 'c1', type: 'customer' }));
    expect(String(request.mock.calls[0][0])).toMatch(/\/api\/customer\/login$/);
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'include', method: 'POST', body: JSON.stringify({ email: 'alex@example.com', password: 'secret123' }) });
  });
  it('keeps failed credentials editable and clears the error when typing', async () => {
    request.mockResolvedValue(Response.json({ message: 'Check your credentials' }, { status: 401 }));
    render(<MemoryRouter><CustomerLoginPage /></MemoryRouter>); enter(); submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Check your credentials');
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
    enter('alex', 'replacement');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });
  it('signs a supplier in with their email, to their own portal, after the staff check says no', async () => {
    request.mockImplementation(async url => String(url).endsWith('/api/customer/login')
      ? Response.json({ message: 'Invalid email or password' }, { status: 401 })
      : Response.json({ me: { name: 'Li' } }));
    render(<MemoryRouter initialEntries={['/login']}><Routes><Route path="/login" element={<CustomerLoginPage />} /><Route path="/supplier" element={<p>Supplier portal</p>} /></Routes></MemoryRouter>);
    enter('li@supplier.com', 'right'); submit();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(String(request.mock.calls[1][0])).toMatch(/\/api\/supplier-portal\/sign-in$/);
    expect(request.mock.calls[1][1]).toMatchObject({ credentials: 'include', body: JSON.stringify({ email: 'li@supplier.com', password: 'right' }) });
    expect(await screen.findByText('Supplier portal')).toBeTruthy();
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });
  it('shows a supplier login\'s own reason when it is locked', async () => {
    request.mockImplementation(async url => String(url).endsWith('/api/customer/login')
      ? Response.json({ message: 'Invalid email or password' }, { status: 401 })
      : Response.json({ message: 'Too many tries. Try again in 15 minutes.' }, { status: 423 }));
    render(<MemoryRouter><CustomerLoginPage /></MemoryRouter>); enter('li@supplier.com', 'x'); submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Too many tries');
  });
  it('does not ask the supplier portal about a username with no @', async () => {
    request.mockResolvedValue(Response.json({ message: 'Invalid email or password' }, { status: 401 }));
    render(<MemoryRouter><CustomerLoginPage /></MemoryRouter>); enter('alex', 'secret123'); submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email or password');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('explains a network failure', async () => {
    request.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><CustomerLoginPage /></MemoryRouter>); enter(); submit();
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't reach the server");
  });
  it('starts temporary-password setup and reports a failed setup session', async () => {
    request.mockResolvedValue(Response.json({ setup: true }, { status: 403 }));
    auth.startPasswordSetup.mockResolvedValue(false);
    render(<MemoryRouter><CustomerLoginPage /></MemoryRouter>); enter(); submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t finish signing in');
    expect(auth.startPasswordSetup).toHaveBeenCalledTimes(1);
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });
  it('shows an expired-session notice and consumes the flag', () => {
    sessionStorage.setItem('auth_session_expired', '1');
    render(<MemoryRouter><CustomerLoginPage /></MemoryRouter>);
    expect(screen.getByRole('alert').textContent).toContain('Your session expired');
    expect(sessionStorage.getItem('auth_session_expired')).toBeNull();
  });
  it.each([['internal', '/sales'], ['customer', '/'], ['setup', '/sales']])('routes a %s session to %s', async (type, target) => {
    if (type === 'setup') auth.passwordSetup = { username: 'alex' };
    else auth.user = { type };
    render(<MemoryRouter initialEntries={['/login']}><Routes><Route path="/login" element={<CustomerLoginPage />} /><Route path={target} element={<p>Destination</p>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Destination')).toBeTruthy();
  });
  it('remembers theme selection', () => {
    render(<MemoryRouter><CustomerLoginPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(localStorage.getItem('checkin_theme')).toBe('dark');
    expect(document.body.classList.contains('light-theme-active')).toBe(false);
  });
});
