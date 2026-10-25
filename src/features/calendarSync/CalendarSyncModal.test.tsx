// @vitest-environment jsdom
// Sync Calendar renders its three states and calls the right endpoints —
// a smoke test for the module moved out of SalesPage (MIGRATION_NOTES.md §4).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, renderHook, act } from '@testing-library/react';

vi.mock('../../api/authFetch', () => ({ authFetch: vi.fn() }));
const { authFetch } = await import('../../api/authFetch');
const { default: CalendarSyncModal } = await import('./CalendarSyncModal');
const { useCalendarSync } = await import('./useCalendarSync');

const json = (body: unknown, ok = true) => Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 400 }));
const fetchMock = vi.mocked(authFetch);

// The hook's state for a given server answer, with the modal open.
function setup(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string) => {
    const hit = Object.keys(routes).find((k) => url.includes(k));
    return json(hit ? routes[hit] : url.endsWith('/calendar/subscription') ? { path: '/api/calendar/feed/u1.ics?token=private-test-token' } : {});
  });
  const { result } = renderHook(() => useCalendarSync({ open: true }));
  return result;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('CalendarSyncModal', () => {
  it('offers to link both calendars when neither is connected, and shows the feed link', async () => {
    const sync = setup({ 'google/calendar/status': { connected: false, email: '' }, 'icloud/status': { connected: false } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    render(<CalendarSyncModal sync={sync.current} userId="u1" onClose={() => {}} />);
    expect(screen.getByText('🔗 Link Google Calendar')).toBeTruthy();
    expect(screen.getByText('🍏 Link iCloud Calendar')).toBeTruthy();
    const link = await screen.findByRole('textbox', { name: 'Private calendar subscription link' });
    expect((link as HTMLInputElement).value).toContain('/api/calendar/feed/u1.ics?token=private-test-token');
  });

  it('shows who is connected with Sync Now and Disconnect', async () => {
    const sync = setup({
      'google/calendar/status': { connected: true, email: 'rep@gmail.com' },
      'icloud/status': { connected: true, email: 'rep@icloud.com', calendarName: 'Work' }
    });
    await waitFor(() => expect(sync.current.icloud.status.connected).toBe(true));
    render(<CalendarSyncModal sync={sync.current} userId="u1" onClose={() => {}} />);
    expect(screen.getByText('Connected: rep@gmail.com')).toBeTruthy();
    expect(screen.getByText('Linked: rep@icloud.com')).toBeTruthy();
    expect(screen.getByText('Calendar: Work')).toBeTruthy();
    expect(screen.getAllByText('🔄 Sync Now')).toHaveLength(2);
  });

  it('asks for both iCloud fields before calling the server', async () => {
    const sync = setup({});
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => { await sync.current.icloud.findCalendars(); });
    expect(sync.current.icloud.error).toBe('Apple ID and App-Specific Password are required.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lists the iCloud calendars found, then links the chosen one and reloads the schedule', async () => {
    const onSynced = vi.fn();
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('icloud/connect')) {
        const body = JSON.parse(String(opts?.body));
        return body.calendarUrl
          ? json({ calendarName: 'Work' })
          : json({ calendars: [{ url: 'https://cal/1', name: 'Work' }, { url: 'https://cal/2', name: 'Home' }] });
      }
      return json({ connected: false });
    });
    const { result } = renderHook(() => useCalendarSync({ open: true, onSynced }));
    act(() => { result.current.icloud.setAppleId('rep@icloud.com'); result.current.icloud.setAppSpecificPassword('abcd-efgh'); });
    await act(async () => { await result.current.icloud.findCalendars(); });
    render(<CalendarSyncModal sync={result.current} userId="u1" onClose={() => {}} />);
    expect(screen.getByText('Link Selected Calendar')).toBeTruthy();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Work', 'Home']);

    await act(async () => { await result.current.icloud.linkCalendar(); });
    expect(result.current.icloud.status).toEqual({ connected: true, email: 'rep@icloud.com', calendarName: 'Work' });
    expect(result.current.icloud.appleId).toBe('');
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  it('closes from the ✕', async () => {
    const sync = setup({});
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const onClose = vi.fn();
    const { container } = render(<CalendarSyncModal sync={sync.current} userId="u1" onClose={onClose} />);
    fireEvent.click(container.querySelector('.close-btn') as Element);
    expect(onClose).toHaveBeenCalled();
  });
});
