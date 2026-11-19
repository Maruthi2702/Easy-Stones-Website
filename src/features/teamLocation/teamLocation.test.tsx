// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamLocationPage from './TeamLocationPage';
import { liveCount, sortPeople, trailSummary } from './teamLocationView';
import type { TeamPerson } from './types';

const api = vi.hoisted(() => ({ loadTeam: vi.fn(), loadTrail: vi.fn() }));
vi.mock('./teamLocationApi', () => api);
vi.mock('./TeamMap', () => ({ default: ({ people, selectedId }: { people: unknown[]; selectedId: string }) => <div data-testid="map">{people.length} pins · {selectedId || 'none'}</div> }));

const person = (id: string, name: string, status: TeamPerson['status'], ago: string): TeamPerson => ({
  id, name, branch: 'Seattle', role: 'sales_rep', status, ago, consentedAt: id === 'k' ? null : '2026-11-19T17:00:00Z',
  lastSeen: status === 'none' ? null : { at: '2026-11-18T19:55:00Z', lat: 47.6, lng: -122.3, accuracyM: 10 }
});
const PEOPLE = [person('d', 'Dan Driver', 'earlier', '1 h ago'), person('r', 'Rita Rep', 'live', '2 min ago'), person('k', 'Kim Park', 'none', 'No location today')];
const viewer = { permissions: ['view_team_locations'], assignedLocations: ['Seattle'] };

beforeEach(() => { api.loadTeam.mockResolvedValue({ people: PEOPLE }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Team Location', () => {
  it('lists the team, live first, with a count', async () => {
    render(<TeamLocationPage currentUser={viewer} />);
    const names = await screen.findAllByRole('button', { pressed: false });
    expect(names.map((b) => b.querySelector('b')?.textContent).filter(Boolean)).toEqual(['Rita Rep', 'Dan Driver', 'Kim Park']);
    expect(screen.getByText(/1 live · 3 tracked on your team/)).toBeTruthy();
    expect(screen.getByTestId('map').textContent).toContain('3 pins');
    expect(screen.getAllByText('Hasn’t agreed to share location yet')).toHaveLength(1);
  });
  it('loads a person\'s day when picked and says what it holds', async () => {
    api.loadTrail.mockResolvedValue({
      person: { id: 'r', name: 'Rita Rep', branch: 'Seattle' }, day: '2026-11-18', miles: 11.4,
      points: [{ at: '2026-11-18T16:04:00Z', lat: 47.6, lng: -122.3, accuracyM: 5 }, { at: '2026-11-19T00:52:00Z', lat: 47.7, lng: -122.3, accuracyM: 5 }],
      first: '2026-11-18T16:04:00Z', last: '2026-11-19T00:52:00Z'
    });
    render(<TeamLocationPage currentUser={viewer} />);
    fireEvent.click((await screen.findByText('Rita Rep')).closest('button')!);
    await waitFor(() => expect(api.loadTrail).toHaveBeenCalledWith('r', ''));
    expect(await screen.findByText('2 points · 11.4 mi · 8:04 AM – 4:52 PM')).toBeTruthy();
  });
  it('shows the server\'s reason when the list fails', async () => {
    api.loadTeam.mockRejectedValue(new Error('You can’t see your team’s locations.'));
    render(<TeamLocationPage currentUser={viewer} />);
    expect((await screen.findByRole('alert')).textContent).toContain('can’t see your team');
  });
  it('says when no one on the team is tracked', async () => {
    api.loadTeam.mockResolvedValue({ people: [] });
    render(<TeamLocationPage currentUser={viewer} />);
    expect(await screen.findByText('No one is being tracked on your team')).toBeTruthy();
  });
  it('is closed without the switch and asks the server nothing', () => {
    render(<TeamLocationPage currentUser={{ permissions: [] }} />);
    expect(screen.getByText('You can’t see your team’s locations')).toBeTruthy();
    expect(api.loadTeam).not.toHaveBeenCalled();
  });
});

describe('view rules', () => {
  it('orders live, then earlier, then nobody seen; counts live', () => {
    expect(sortPeople(PEOPLE).map((p) => p.id)).toEqual(['r', 'd', 'k']);
    expect(liveCount(PEOPLE)).toBe(1);
  });
  it('words an empty day', () => expect(trailSummary('Kim', 'Seattle', 0, null, null, 0)).toBe('No location points for Kim on this day.'));
});
