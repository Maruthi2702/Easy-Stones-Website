// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LoginPage from './LoginPage';

const auth = vi.hoisted(() => ({ completeLogin: vi.fn(), startPasswordSetup: vi.fn(), user: null as { type: string } | null, passwordSetup: null as object | null }));
const token = vi.hoisted(() => vi.fn());
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api/authToken', () => ({ setAuthToken: token }));
const request = vi.fn<typeof fetch>();
beforeEach(() => { vi.clearAllMocks(); auth.user = null; auth.passwordSetup = null; localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/admin/login'); vi.stubGlobal('fetch', request); });
afterEach(() => { cleanup(); request.mockReset(); vi.unstubAllGlobals(); });
function signIn() {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alex' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
}

describe('Staff login', () => {
  it('completes sign-in with a normalized staff profile and memory token', async () => {
    request.mockResolvedValue(Response.json({ success: true, token: 'session-token', admin: { id: 'u1', username: 'alex' } }));
    render(<MemoryRouter><LoginPage /></MemoryRouter>); signIn();
    await waitFor(() => expect(auth.completeLogin).toHaveBeenCalledWith({ id: 'u1', username: 'alex', type: 'internal', contactName: 'alex' }));
    expect(token).toHaveBeenCalledWith('session-token');
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'include', method: 'POST', body: JSON.stringify({ username: 'alex', password: 'secret123' }) });
  });
  it('opens password setup for a temporary password', async () => {
    request.mockResolvedValue(Response.json({ code: 'must-change-password', setup: true }, { status: 403 }));
    auth.startPasswordSetup.mockResolvedValue(true);
    render(<MemoryRouter><LoginPage /></MemoryRouter>); signIn();
    await waitFor(() => expect(auth.startPasswordSetup).toHaveBeenCalledTimes(1));
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });
  it.each(['credentials', 'network'])('reports %s failures and allows retry', async kind => {
    if (kind === 'credentials') request.mockResolvedValue(Response.json({ success: false, message: 'Wrong credentials' }, { status: 401 }));
    else request.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><LoginPage /></MemoryRouter>); signIn();
    await screen.findByText(kind === 'credentials' ? 'Wrong credentials' : 'Login failed. Please try again.');
    expect((screen.getByRole('button', { name: 'Login' }) as HTMLButtonElement).disabled).toBe(false);
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });
  it('explains an expired session once', () => {
    sessionStorage.setItem('auth_session_expired', '1');
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.getByText('Your session expired. Please log in again.')).toBeTruthy();
    expect(sessionStorage.getItem('auth_session_expired')).toBeNull();
  });
  it('follows the redirect when another tab signs in', async () => {
    window.history.replaceState({}, '', '/admin/login?redirect=%2Fcheckin');
    auth.user = { type: 'internal' };
    render(<MemoryRouter><Routes><Route path="/" element={<LoginPage />} /><Route path="/checkin" element={<p>Staff check-in</p>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Staff check-in')).toBeTruthy();
  });
});
