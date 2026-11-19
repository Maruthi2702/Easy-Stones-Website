// @vitest-environment jsdom
// The marks on rows (step 2): the chip's words and colours, the hook that asks the server which
// readings this person may see, and the access rule the server applies.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, renderHook } from '@testing-library/react';
import { canSeeVisitLocation } from '../../utils/visitAccess';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

const { default: LocationChip } = await import('./LocationChip');
const { useVisitLocations, clearVisitLocations } = await import('../../api/visitLocations');

const reading = (over = {}) => ({ lat: 1, lng: 1, accuracyM: 20, readAt: 'x', distanceM: 100, mark: 'onSite', device: 'phone', approximate: false, ...over });
beforeEach(() => { clearVisitLocations(); authFetch.mockReset(); });
afterEach(cleanup);

describe('LocationChip', () => {
  it('says what the server decided, in its colour', () => {
    const { container, rerender } = render(<LocationChip location={reading() as never} />);
    expect(screen.getByText('On site')).toBeTruthy();
    expect(container.querySelector('.loc-chip--ok')).toBeTruthy();
    rerender(<LocationChip location={reading({ mark: 'nearby', distanceM: 965, approximate: true }) as never} />);
    expect(screen.getByText('Nearby · 0.6 mi · approx.')).toBeTruthy();
    expect(container.querySelector('.loc-chip--warn')).toBeTruthy();
    rerender(<LocationChip location={reading({ mark: 'away', distanceM: 29000 }) as never} />);
    expect(screen.getByText('18 mi away')).toBeTruthy();
    expect(container.querySelector('.loc-chip--bad')).toBeTruthy();
    rerender(<LocationChip location={reading({ mark: 'recorded', distanceM: null }) as never} />);
    expect(screen.getByText('Location recorded')).toBeTruthy();
  });
  it('shows nothing when there is no reading to show', () => {
    const { container } = render(<LocationChip location={undefined} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('useVisitLocations', () => {
  it('asks once for ids it has not seen and returns what the server allowed', async () => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ locations: { a: reading() } }) });
    const { result, rerender } = renderHook(({ ids }) => useVisitLocations(ids), { initialProps: { ids: ['a', 'b'] } });
    await waitFor(() => expect(result.current.a).toMatchObject({ mark: 'onSite' }));
    expect(result.current.b).toBeUndefined();
    expect(JSON.parse(authFetch.mock.calls[0][1].body)).toEqual({ visitIds: ['a', 'b'] });
    rerender({ ids: ['a', 'b'] });
    expect(authFetch).toHaveBeenCalledTimes(1); // "b" has no reading: not asked again
  });
  it('shows no mark when the call fails', async () => {
    authFetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useVisitLocations(['a']));
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(result.current).toEqual({});
  });
  it('asks nothing when switched off', () => {
    renderHook(() => useVisitLocations(['a'], false));
    expect(authFetch).not.toHaveBeenCalled();
  });
});

describe('canSeeVisitLocation', () => {
  const rep = { id: 'u1', permissions: ['add_visits'] };
  const manager = { id: 'm1', permissions: ['view_branch_visits', 'see_visit_locations'] };
  it('you always see your own', () => expect(canSeeVisitLocation(rep, { createdBy: 'u1' }, new Set())).toBe(true));
  it("a manager with the switch sees their team's, not others'", () => {
    expect(canSeeVisitLocation(manager, { createdBy: 'u1' }, new Set(['u1']))).toBe(true);
    expect(canSeeVisitLocation(manager, { createdBy: 'u9' }, new Set(['u1']))).toBe(false);
    expect(canSeeVisitLocation(manager, { createdBy: 'u9' }, '*')).toBe(true);
  });
  it("without the switch nobody sees a teammate's", () => {
    expect(canSeeVisitLocation({ id: 'm1', permissions: ['view_branch_visits'] }, { createdBy: 'u1' }, new Set(['u1']))).toBe(false);
    expect(canSeeVisitLocation(null, { createdBy: 'u1' }, '*')).toBe(false);
    expect(canSeeVisitLocation(manager, { createdBy: '' }, '*')).toBe(true);
  });
});
