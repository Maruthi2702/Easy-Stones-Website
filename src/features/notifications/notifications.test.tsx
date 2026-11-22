// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SendNotificationPage from './SendNotificationPage';

const api = vi.hoisted(() => ({ loadPeople: vi.fn(), sendNotification: vi.fn() }));
vi.mock('./notificationsApi', () => api);

const PEOPLE = [
  { id: 'r', name: 'Rita Rep', role: 'sales_rep', branch: 'Seattle', phones: 1 },
  { id: 'n', name: 'New Rep', role: 'sales_rep', branch: 'Seattle', phones: 0 },
  { id: 'a', name: 'Atl Driver', role: 'driver', branch: 'Atlanta', phones: 2 }
];

beforeEach(() => { api.loadPeople.mockResolvedValue({ configured: true, people: PEOPLE }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Send Notification', () => {
  it('lists people by branch, greys out those with no phone and starts with Send locked', async () => {
    render(<SendNotificationPage />);
    expect(await screen.findByText('Rita Rep')).toBeTruthy();
    expect(screen.getByText(/2 of 3 people on your team have the app set up/)).toBeTruthy();
    expect(screen.getByText('No phone set up')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /New Rep/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Send/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the message to the ticked people and clears the form', async () => {
    api.sendNotification.mockResolvedValue({ asked: 1, reached: 1, noPhone: [], failed: 0, line: 'Sent to 1 person.' });
    render(<SendNotificationPage />);
    await screen.findByText('Rita Rep');
    fireEvent.click(screen.getByRole('checkbox', { name: /Rita Rep/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hi Maruthi' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(api.sendNotification).toHaveBeenCalledWith(['r'], 'Hi Maruthi'));
    expect(await screen.findByText('Sent to 1 person.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('');
  });

  it('ticking a branch ticks only people with a phone', async () => {
    render(<SendNotificationPage />);
    await screen.findByText('Rita Rep');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seattle' }));
    expect(screen.getByText('1 person ticked')).toBeTruthy();
  });

  it('shows the server’s refusal', async () => {
    api.sendNotification.mockRejectedValue(new Error('You can’t send notifications.'));
    render(<SendNotificationPage />);
    await screen.findByText('Rita Rep');
    fireEvent.click(screen.getByRole('checkbox', { name: /Rita Rep/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
