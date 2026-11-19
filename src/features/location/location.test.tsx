// @vitest-environment jsdom
// Every new visit and resource needs a location (owner, 2026-11-19): the hook's
// states, the form's locked Save and "turn on location" screen, the reading
// travelling with the save, and the app-open sheet.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, renderHook } from '@testing-library/react';
import { stubGeolocation } from './testing/geolocation';

vi.mock('../../api/authFetch', () => ({ authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ types: [] }) })) }));

const { useLocationReading } = await import('./useLocationReading');
const { default: LocationGate } = await import('./LocationGate');
const { default: ResourceForm } = await import('../resources/form/ResourceForm');
const { clearTypeLists } = await import('../../api/typeLists');

beforeEach(() => { clearTypeLists(); window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(cleanup);

describe('useLocationReading', () => {
  it('becomes ready with a reading the server can use', async () => {
    stubGeolocation();
    const { result } = renderHook(() => useLocationReading(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.reading).toMatchObject({ lat: 47.6062, lng: -122.3321, accuracyM: 20 });
  });
  it('is blocked when the browser refuses, and again ready after "Check again" once allowed', async () => {
    const geo = stubGeolocation({ error: 1, permission: 'prompt' });
    const { result } = renderHook(() => useLocationReading(true));
    await waitFor(() => expect(result.current.status).toBe('blocked'));
    stubGeolocation();
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(geo.getCurrentPosition).toHaveBeenCalled();
  });
  it('is blocked up front when the browser already says denied, and never asks', async () => {
    const geo = stubGeolocation({ permission: 'denied' });
    const { result } = renderHook(() => useLocationReading(true));
    await waitFor(() => expect(result.current.status).toBe('blocked'));
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });
  it('asks for nothing when not enabled (an edit)', () => {
    const geo = stubGeolocation();
    const { result } = renderHook(() => useLocationReading(false));
    expect(result.current.status).toBe('ready');
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });
});

const values = { customerId: 'c1', customer: 'Sam Homes', resourceType: 'Tower', qty: '1', date: '2026-11-19', status: 'Active', description: '', notes: '' };
const form = (over = {}) => (
  <ResourceForm isEdit={false} values={values as never} initial={values as never} onChange={() => {}} attachments={[]} initialAttachmentCount={0}
    onUpload={() => {}} onRemoveAttachment={() => {}} customerOptions={[{ value: 'c1', label: 'Sam Homes' }]} saving={false} onSave={vi.fn()} onClose={() => {}} {...over} />
);

describe('Add resource needs a location', () => {
  it('locks Add resource while it looks, then saves with the reading', async () => {
    stubGeolocation();
    const onSave = vi.fn();
    render(form({ onSave }));
    await screen.findByText('Location found');
    const button = screen.getByRole('button', { name: 'Add resource' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].loggedFrom).toMatchObject({ lat: 47.6062, device: 'computer' });
  });
  it('says "approximate" for a rough reading but still lets it save', async () => {
    stubGeolocation({ accuracy: 900 });
    render(form());
    expect(await screen.findByText('Location found · approximate')).toBeTruthy();
  });
  it('replaces the form with the steps to turn location on when it is refused', async () => {
    stubGeolocation({ error: 1, permission: 'prompt' });
    render(form());
    expect(await screen.findByText('Turn on location to add resources')).toBeTruthy();
    expect(screen.queryByText('Resource type')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add resource' }).hasAttribute('disabled')).toBe(true);
  });
  it('an edit asks for nothing', async () => {
    const geo = stubGeolocation({ error: 1 });
    render(form({ isEdit: true, resourceId: 'r1' }));
    expect(screen.queryByText('Turn on location to add resources')).toBeNull();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe('the app-open sheet', () => {
  it('opens when the browser has not been asked, and a tap asks it', async () => {
    const geo = stubGeolocation({ permission: 'prompt' });
    render(<LocationGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on location' }));
    await waitFor(() => expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('stays away once location is allowed, and after "Not now" for the session', async () => {
    stubGeolocation({ permission: 'granted' });
    const first = render(<LocationGate />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();
    stubGeolocation({ permission: 'prompt' });
    render(<LocationGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    cleanup();
    render(<LocationGate />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
