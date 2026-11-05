// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import UserProfileTab from './UserProfileTab';

const request = vi.hoisted(() => vi.fn<typeof fetch>());
const token = vi.hoisted(() => vi.fn());
vi.mock('../../api/authFetch', () => ({ authFetch: request }));
vi.mock('../../api/authToken', () => ({ setAuthToken: token }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { username: 'alex', contactName: 'Alex Stone', assignedLocations: ['*'], role: 'sales_rep' } }) }));
beforeEach(() => { request.mockReset(); token.mockReset(); });
afterEach(cleanup);
function submit(current = 'old-password', password = 'new-password', confirm = password) {
  fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: confirm } });
  fireEvent.submit(document.querySelector('form')!);
}
describe('User profile', () => {
  it('shows account details and wildcard branch access', () => {
    render(<UserProfileTab />);
    expect(screen.getByText('Alex Stone')).toBeTruthy();
    expect(screen.getByText('All Locations')).toBeTruthy();
  });
  it.each([['', '', '', 'All password fields are required.'], ['old', 'new-password', 'different', 'New passwords do not match.'], ['old', 'short', 'short', 'New password must be at least 6 characters long.']])('validates password changes before calling the API', (current, password, confirm, error) => {
    render(<UserProfileTab />); submit(current, password, confirm);
    expect(screen.getByText(error)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  it('rotates the token and clears password fields after saving', async () => {
    request.mockResolvedValue(Response.json({ token: 'rotated-token' }));
    render(<UserProfileTab />); submit();
    expect(await screen.findByText('Password updated successfully!')).toBeTruthy();
    expect(token).toHaveBeenCalledWith('rotated-token');
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ currentPassword: 'old-password', newPassword: 'new-password' });
    expect((screen.getByLabelText('Current Password') as HTMLInputElement).value).toBe('');
  });
  it.each(['server', 'network'])('reports a %s error and permits retry', async kind => {
    if (kind === 'server') request.mockResolvedValue(Response.json({ message: 'Wrong current password' }, { status: 400 }));
    else request.mockRejectedValue(new Error('offline'));
    render(<UserProfileTab />); submit();
    await screen.findByText(kind === 'server' ? 'Wrong current password' : 'Connection error. Please try again.');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Update Password' }) as HTMLButtonElement).disabled).toBe(false));
    expect(token).not.toHaveBeenCalled();
  });
});
