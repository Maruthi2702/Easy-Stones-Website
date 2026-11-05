// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ChoosePasswordPage from './ChoosePasswordPage';
import SetPasswordPage from './SetPasswordPage';

const auth = vi.hoisted(() => ({ passwordSetup: { name: 'Alex', username: 'alex' }, user: null as { username: string; contactName?: string } | null, completeLogin: vi.fn(), logout: vi.fn(), checkAuth: vi.fn() }));
const token = vi.hoisted(() => vi.fn());
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api/authToken', () => ({ setAuthToken: token }));
const request = vi.fn<typeof fetch>();
beforeEach(() => { vi.clearAllMocks(); request.mockReset(); auth.user = null; sessionStorage.clear(); window.history.replaceState({}, '', '/set-password'); vi.stubGlobal('fetch', request); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function save(password = 'new-password-123', confirm = password) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: confirm } });
  fireEvent.submit(document.querySelector('form')!);
}

describe('Choose a first password', () => {
  it.each([['short', 'short', 'Choose at least'], ['valid-password', 'different-password', 'don’t match']])('rejects invalid passwords before contacting the server', (password, confirm, message) => {
    render(<ChoosePasswordPage />); save(password, confirm);
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(request).not.toHaveBeenCalled();
  });
  it('saves the password and completes the authenticated session', async () => {
    request.mockResolvedValue(Response.json({ success: true, token: 'new-token', user: { id: 'u1' } }));
    render(<ChoosePasswordPage />); save();
    await waitFor(() => expect(auth.completeLogin).toHaveBeenCalledWith({ id: 'u1' }));
    expect(token).toHaveBeenCalledWith('new-token');
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'include', method: 'POST', body: JSON.stringify({ newPassword: 'new-password-123' }) });
  });
  it('rechecks authentication if the setup session expires', async () => {
    request.mockResolvedValue(Response.json({ code: 'setup-expired' }, { status: 401 }));
    render(<ChoosePasswordPage />); save();
    await waitFor(() => expect(auth.checkAuth).toHaveBeenCalledWith({ silent: true }));
    expect(sessionStorage.getItem('auth_session_expired')).toBe('1');
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });
  it.each(['server', 'network'])('allows retry after a %s error', async kind => {
    if (kind === 'server') request.mockResolvedValue(Response.json({ message: 'Password rejected' }, { status: 400 }));
    else request.mockRejectedValue(new Error('offline'));
    render(<ChoosePasswordPage />); save();
    expect((await screen.findByRole('alert')).textContent).toContain(kind === 'server' ? 'Password rejected' : 'Could not save');
    expect((screen.getByRole('button', { name: 'Save and continue' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('prevents duplicate requests while saving and permits signing out', () => {
    request.mockReturnValue(new Promise(() => {}));
    render(<ChoosePasswordPage />); save(); save();
    expect(request).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
});

describe('Emailed password invitation', () => {
  it('rejects a missing token without requesting an invite', () => {
    render(<MemoryRouter><SetPasswordPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'This link has expired' })).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['invalid', 'network'])('reports an %s link', async kind => {
    window.history.replaceState({}, '', '/set-password?token=invite');
    if (kind === 'invalid') request.mockResolvedValue(Response.json({ valid: false }));
    else request.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><SetPasswordPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: kind === 'invalid' ? 'This link has expired' : 'Something went wrong' })).toBeTruthy();
  });
  it('warns about switching accounts, accepts the invite, and opens Sales', async () => {
    window.history.replaceState({}, '', '/set-password?token=invite%2Btoken');
    auth.user = { username: 'admin', contactName: 'Administrator' };
    request.mockResolvedValueOnce(Response.json({ valid: true, name: 'Alex', username: 'alex' }))
      .mockResolvedValueOnce(Response.json({ success: true, token: 'new-token', user: { id: 'u1' } }));
    render(<MemoryRouter initialEntries={['/set-password']}><Routes><Route path="/set-password" element={<SetPasswordPage />} /><Route path="/sales" element={<p>Sales workspace</p>} /></Routes></MemoryRouter>);
    expect((await screen.findByRole('status')).textContent).toContain('Saving signs you in as alex instead');
    expect(String(request.mock.calls[0][0])).toMatch(/invite\/invite%2Btoken$/);
    save();
    expect(await screen.findByText('Sales workspace')).toBeTruthy();
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ token: 'invite+token', newPassword: 'new-password-123' });
    expect(auth.completeLogin).toHaveBeenCalledWith({ id: 'u1' });
  });
  it('removes the form if the invite expires before saving', async () => {
    window.history.replaceState({}, '', '/set-password?token=invite');
    request.mockResolvedValueOnce(Response.json({ valid: true, name: 'Alex', username: 'alex' }))
      .mockResolvedValueOnce(Response.json({ code: 'invite-invalid' }, { status: 400 }));
    render(<MemoryRouter><SetPasswordPage /></MemoryRouter>);
    await screen.findByLabelText('New password'); save();
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });
});
