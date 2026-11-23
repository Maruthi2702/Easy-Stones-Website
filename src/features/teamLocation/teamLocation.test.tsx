// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamLocationPage from './TeamLocationPage';
import { accessLine, attentionCount, deviceLine, deviceRows, filterAccess, filterPeople, gapText, liveCount, permissionLabel, sortPeople, trailSummary } from './teamLocationView';
import type { TeamPerson } from './types';

const api = vi.hoisted(() => ({ loadAccessLog: vi.fn(), loadTeam: vi.fn(), loadTrail: vi.fn(), askLocate: vi.fn(), loadLocate: vi.fn(), loadLocateLog: vi.fn(), sendReminder: vi.fn() }));
vi.mock('./teamLocationApi', () => api);
vi.mock('./TeamMap', () => ({ default: ({ people, selectedId }: { people: unknown[]; selectedId: string }) => <div data-testid="map">{people.length} pins · {selectedId || 'none'}</div> }));

const person = (id: string, name: string, status: TeamPerson['status'], ago: string): TeamPerson => ({
  id, name, branch: 'Seattle', role: 'sales_rep', status, ago, consentedAt: id === 'k' ? null : '2026-11-19T17:00:00Z',
  lastSeen: status === 'none' ? null : { at: '2026-11-18T19:55:00Z', lat: 47.6, lng: -122.3, accuracyM: 10 }
});
const PEOPLE = [person('d', 'Dan Driver', 'earlier', '1 h ago'), person('r', 'Rita Rep', 'live', '2 min ago'), person('k', 'Kim Park', 'none', 'No location today')];
const viewer = { permissions: ['view_team_locations'], assignedLocations: ['Seattle'] };

beforeEach(() => {
  api.loadTeam.mockResolvedValue({ people: PEOPLE });
  api.loadTrail.mockResolvedValue({ person: { id: 'r', name: 'Rita Rep', branch: 'Seattle' }, day: '2026-11-18', miles: 0, points: [], first: null, last: null });
  api.loadLocateLog.mockResolvedValue({ requests: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** Pick someone the way a person does: type their name in the search, then press their row. */
const pickPerson = async (name: string) => {
  fireEvent.change(await screen.findByLabelText('Search people'), { target: { value: name } });
  fireEvent.click((await screen.findByText(name)).closest('button')!);
};

describe('Team Location', () => {
  it('opens on the map with everyone as a pin and a count in the title', async () => {
    render(<TeamLocationPage currentUser={viewer} />);
    expect(await screen.findByText(/1 live · 3 tracked on your team/)).toBeTruthy();
    expect(screen.getByTestId('map').textContent).toContain('3 pins');
    expect(screen.getByText('Tap a pin to see where someone went.')).toBeTruthy();
    expect(screen.queryByText('Rita Rep')).toBeNull();                       // no long list: the map is the page
  });
  it('finds a person by searching, and says who hasn’t agreed', async () => {
    render(<TeamLocationPage currentUser={viewer} />);
    fireEvent.change(await screen.findByLabelText('Search people'), { target: { value: 'kim' } });
    const row = (await screen.findByText('Kim Park')).closest('button')!;
    expect(row.textContent).toContain('Not agreed');
    expect(screen.queryByText('Rita Rep')).toBeNull();
    expect(screen.getByTestId('map').textContent).toContain('1 pins');       // the map follows the search
  });
  it('loads a person\'s day when picked and says what it holds', async () => {
    api.loadTrail.mockResolvedValue({
      person: { id: 'r', name: 'Rita Rep', branch: 'Seattle' }, day: '2026-11-18', miles: 11.4,
      points: [{ at: '2026-11-18T16:04:00Z', lat: 47.6, lng: -122.3, accuracyM: 5 }, { at: '2026-11-19T00:52:00Z', lat: 47.7, lng: -122.3, accuracyM: 5 }],
      first: '2026-11-18T16:04:00Z', last: '2026-11-19T00:52:00Z'
    });
    render(<TeamLocationPage currentUser={viewer} />);
    await pickPerson('Rita Rep');
    await waitFor(() => expect(api.loadTrail).toHaveBeenCalledWith('r', ''));
    expect(await screen.findByText('2 points · 11.4 mi · 8:04 AM – 4:52 PM')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByText('2 points · 11.4 mi · 8:04 AM – 4:52 PM')).toBeNull());
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

describe('Locate now', () => {
  const locator = { permissions: ['view_team_locations', 'locate_on_request'], assignedLocations: ['Seattle'] };
  const asked = { id: 'q1', userId: 'r', status: 'pending', requestedAt: '2026-11-20T03:00:00Z', requestedByName: 'Ada', reason: 'Truck not back', answeredAt: null, lat: null, lng: null, accuracyM: null };
  const pick = pickPerson;

  it('is not offered without the switch', async () => {
    render(<TeamLocationPage currentUser={viewer} />);
    await pick('Rita Rep');
    expect(screen.queryByText('Locate now')).toBeNull();
    expect(api.loadLocateLog).not.toHaveBeenCalled();
  });
  it('is greyed out for someone who hasn’t agreed to the wording', async () => {
    render(<TeamLocationPage currentUser={locator} />);
    await pick('Kim Park');
    expect((screen.getByText('Locate now').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('needs a reason, then asks and shows it waiting', async () => {
    api.askLocate.mockResolvedValue({ request: asked });
    render(<TeamLocationPage currentUser={locator} />);
    await pick('Rita Rep');
    fireEvent.click(screen.getByText('Locate now'));
    fireEvent.click(await screen.findByText('Ask for location'));
    expect(api.askLocate).not.toHaveBeenCalled();                              // no reason yet
    fireEvent.change(screen.getByLabelText(/Why do you need it/), { target: { value: 'Truck not back' } });
    fireEvent.click(screen.getByText('Ask for location'));
    await waitFor(() => expect(api.askLocate).toHaveBeenCalledWith('r', 'Truck not back'));
    expect(await screen.findByText(/Waiting for an answer/)).toBeTruthy();
  });
  it('shows the server’s reason when it refuses', async () => {
    api.askLocate.mockRejectedValue(new Error('Rita Rep’s phone was already asked and hasn’t answered yet.'));
    render(<TeamLocationPage currentUser={locator} />);
    await pick('Rita Rep');
    fireEvent.click(screen.getByText('Locate now'));
    fireEvent.change(await screen.findByLabelText(/Why do you need it/), { target: { value: 'Truck not back' } });
    fireEvent.click(screen.getByText('Ask for location'));
    expect(await screen.findByText(/already asked/)).toBeTruthy();
  });
  it('lists the person’s earlier asks', async () => {
    api.loadLocateLog.mockResolvedValue({ requests: [{ ...asked, status: 'answered', answeredAt: '2026-11-20T03:01:00Z' }] });
    render(<TeamLocationPage currentUser={locator} />);
    await pick('Rita Rep');
    fireEvent.click(await screen.findByRole('tab', { name: 'Requests' }));
    expect(await screen.findByText('Location requests (1)')).toBeTruthy();
    expect(screen.getByText(/Truck not back/)).toBeTruthy();
  });
});

describe('location v2 screen', () => {
  const quietKim: TeamPerson = { ...person('k', 'Kim Park', 'none', 'No location today'), consentedAt: '2026-11-19T17:00:00Z',
    quiet: { code: 'battery-dying', text: 'Battery 3% at 1:30 PM — the phone has probably died' },
    device: { permission: 'always', lowPower: true, batteryPct: 3, charging: false, queued: 40, appVersion: '1', reportedAt: '2026-11-18T21:30:00Z' } };
  const withQuiet = [PEOPLE[0]!, PEOPLE[1]!, quietKim];

  it('says why a quiet person is quiet, and shows their battery', async () => {
    api.loadTeam.mockResolvedValue({ people: withQuiet });
    render(<TeamLocationPage currentUser={viewer} />);
    fireEvent.change(await screen.findByLabelText('Search people'), { target: { value: 'kim' } });
    expect(await screen.findByText(/the phone has probably died/)).toBeTruthy();
    expect(screen.getByText('Battery 3% · Low Power Mode · 40 waiting to send')).toBeTruthy();
    fireEvent.click(screen.getByText('Kim Park').closest('button')!);
    fireEvent.click(await screen.findByRole('tab', { name: 'Phone' }));
    expect(await screen.findByText('Location permission')).toBeTruthy();
    expect(screen.getByText('Always')).toBeTruthy();
  });
  it('narrows the people with the Filters button', async () => {
    api.loadTeam.mockResolvedValue({ people: withQuiet });
    render(<TeamLocationPage currentUser={viewer} />);
    await screen.findByText(/3 tracked on your team/);
    fireEvent.click(screen.getByLabelText('Filters'));
    fireEvent.click(screen.getByText('Needs a look'));
    expect(await screen.findByText('Kim Park')).toBeTruthy();
    expect(screen.queryByText('Rita Rep')).toBeNull();
    expect(screen.getByTestId('map').textContent).toContain('1 pins');
    fireEvent.click(screen.getByText('Everyone'));
    expect(screen.getByTestId('map').textContent).toContain('3 pins');
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'zzz' } });
    expect(screen.getByText('No one matches')).toBeTruthy();
  });
  it('lists the gaps in a picked person\'s day', async () => {
    api.loadTrail.mockResolvedValue({
      person: { id: 'r', name: 'Rita Rep', branch: 'Seattle' }, day: '2026-11-18', miles: 1, first: '2026-11-18T16:00:00Z', last: '2026-11-18T19:00:00Z',
      points: [{ at: '2026-11-18T16:00:00Z', lat: 47.6, lng: -122.3, accuracyM: 5 }],
      gaps: [{ from: '2026-11-18T17:00:00Z', to: '2026-11-18T18:30:00Z', minutes: 90 }]
    });
    render(<TeamLocationPage currentUser={viewer} />);
    await pickPerson('Rita Rep');
    expect(await screen.findByText(/No data for 1 stretch/)).toBeTruthy();
    expect(screen.getByText('No data 9:00 AM – 10:30 AM (90 min)')).toBeTruthy();
  });
  it('has no Access log tab without the switch, and shows it with it', async () => {
    api.loadAccessLog.mockResolvedValue({ entries: [{ id: 'l1', viewerId: 'm', viewerName: 'Mo Manager', subjectId: 'r', subjectName: 'Rita Rep', kind: 'trail', day: '2026-11-18', at: '2026-11-18T19:00:00Z' }] });
    const { unmount } = render(<TeamLocationPage currentUser={viewer} />);
    await screen.findByText(/tracked on your team/);
    expect(screen.queryByText('Access log')).toBeNull();
    unmount();
    render(<TeamLocationPage currentUser={{ ...viewer, permissions: ['view_team_locations', 'view_location_audit'] }} />);
    fireEvent.click(await screen.findByText('Access log'));
    expect(await screen.findByText('Mo Manager viewed the trail of Rita Rep · 2026-11-18')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search the access log'), { target: { value: 'nobody' } });
    expect(screen.getByText('Nothing logged yet')).toBeTruthy();
  });
  it('opens straight on the access log for someone with only that switch, and never loads the map', async () => {
    api.loadAccessLog.mockResolvedValue({ entries: [] });
    render(<TeamLocationPage currentUser={{ permissions: ['view_location_audit'] }} />);
    expect(await screen.findByText('Nothing logged yet')).toBeTruthy();
    expect(api.loadTeam).not.toHaveBeenCalled();
  });
});

describe('location v2 view rules', () => {
  const q: TeamPerson = { ...person('x', 'Xi Quiet', 'none', '—'), quiet: { code: 'silent', text: 'x' } };
  it('filters by name, branch or role and by attention', () => {
    expect(filterPeople([...PEOPLE, q], 'sales rep', false)).toHaveLength(4);
    expect(filterPeople([...PEOPLE, q], 'seattle', true).map((p) => p.id)).toEqual(['x']);
    expect(attentionCount([...PEOPLE, q])).toBe(1);
  });
  it('words the device line, the gap and the access line', () => {
    expect(deviceLine(PEOPLE[0]!)).toBe('');
    expect(deviceLine({ ...PEOPLE[0]!, device: { permission: 'always', lowPower: false, batteryPct: 80, charging: true, queued: 0, appVersion: '', reportedAt: '' } })).toBe('Battery 80% (charging)');
    expect(gapText({ from: '2026-11-18T17:00:00Z', to: '2026-11-18T18:30:00Z', minutes: 90 }, 'Seattle')).toBe('No data 9:00 AM – 10:30 AM (90 min)');
    expect(accessLine({ id: '1', viewerId: 'm', viewerName: 'Mo', subjectId: 'r', subjectName: 'Rita', kind: 'locate', day: '', at: '' })).toBe('Mo asked for the location of Rita');
    expect(filterAccess([{ id: '1', viewerId: 'm', viewerName: 'Mo', subjectId: 'r', subjectName: 'Rita', kind: 'live', day: '', at: '' }], 'rit')).toHaveLength(1);
  });
});

import { filterCounts, groupPeople, statusLabel } from './teamLocationView';
describe('list helpers', () => {
  const P = (o: Record<string, unknown>) => ({ id: String(o.name), role: 'sales_rep', branch: 'Seattle', lastSeen: null, status: 'none', ago: 'No Location Today', consentedAt: '2026-11-20', ...o }) as never;
  const team = [P({ name: 'A', status: 'live' }), P({ name: 'B', status: 'earlier', ago: '2 h ago' }), P({ name: 'C', consentedAt: null }), P({ name: 'D', status: 'live', quiet: { code: 'x', text: 'Battery low' } })];
  it('puts each person in one section', () => {
    expect(groupPeople(team).map((g) => `${g.title}:${g.people.map((p) => p.name).join('')}`)).toEqual(['Needs a look:D', 'Live now:A', 'Seen earlier today:B', 'Hasn’t agreed yet:C']);
  });
  it('counts and filters', () => {
    expect(filterCounts(team)).toEqual({ all: 4, live: 2, attention: 1, unagreed: 1 });
    expect(filterPeople(team, '', 'unagreed').map((p) => p.name)).toEqual(['C']);
    expect(filterPeople(team, '', true).map((p) => p.name)).toEqual(['D']);
  });
  it('gives one short status word', () => {
    expect(team.map(statusLabel)).toEqual(['Live', '2 h ago', 'Not agreed', 'Live']);
  });
});

describe('phone rows', () => {
  it('words the permission and the Phone tab rows', () => {
    expect(permissionLabel('when-in-use')).toBe('While Using');
    expect(permissionLabel(undefined)).toBe('Not reported');
    const p = { ...person('r', 'Rita', 'live', ''), device: { permission: 'when-in-use', lowPower: true, batteryPct: 9, charging: false, queued: 25, appVersion: '2', reportedAt: '' } };
    expect(deviceRows(p).map((r) => `${r.label}:${r.value}:${r.tone}`)).toEqual([
      'Battery:9%:warn', 'Location permission:While Using:warn', 'Low Power Mode:On:warn', 'Waiting to send:25:warn', 'App version:2:plain'
    ]);
    expect(deviceRows(person('r', 'Rita', 'live', ''))).toEqual([]);
  });
});

describe('reminders and stops', () => {
  const sender = { permissions: ['view_team_locations', 'send_notifications'], assignedLocations: ['Seattle'] };
  const dyingKim: TeamPerson = { ...person('k', 'Kim Park', 'none', 'No location today'), consentedAt: '2026-11-19T17:00:00Z',
    quiet: { code: 'when-in-use', text: 'Location is set to “While Using”' },
    device: { permission: 'when-in-use', lowPower: false, batteryPct: 80, charging: false, queued: 0, appVersion: '1', reportedAt: '2026-11-18T21:30:00Z' } };

  it('offers a reminder for why they are quiet, to someone who may send notifications, and sends it', async () => {
    api.loadTeam.mockResolvedValue({ people: [PEOPLE[1]!, dyingKim] });
    api.sendReminder.mockResolvedValue({ line: 'Sent to 1 person.', reached: 1 });
    render(<TeamLocationPage currentUser={sender} />);
    await pickPerson('Kim Park');
    fireEvent.click(await screen.findByRole('tab', { name: 'Phone' }));
    fireEvent.click(await screen.findByText('Remind to set Always'));
    await waitFor(() => expect(api.sendReminder).toHaveBeenCalledWith('k', expect.stringContaining('“Always”')));
    expect(await screen.findByText('Sent to 1 person.')).toBeTruthy();
    expect((screen.getByText('Reminder sent').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('offers no reminder without the notification switch', async () => {
    api.loadTeam.mockResolvedValue({ people: [PEOPLE[1]!, dyingKim] });
    render(<TeamLocationPage currentUser={viewer} />);
    await pickPerson('Kim Park');
    fireEvent.click(await screen.findByRole('tab', { name: 'Phone' }));
    expect(screen.queryByText('Remind to set Always')).toBeNull();
  });
  it('lists where the person stopped', async () => {
    const pts = [0, 5, 10, 15].map((m) => ({ at: new Date(Date.UTC(2026, 10, 18, 17, m)).toISOString(), lat: 47.6, lng: -122.3, accuracyM: 5 }));
    api.loadTrail.mockResolvedValue({ person: { id: 'r', name: 'Rita Rep', branch: 'Seattle' }, day: '2026-11-18', miles: 0, points: pts, first: pts[0]!.at, last: pts[3]!.at });
    render(<TeamLocationPage currentUser={viewer} />);
    await pickPerson('Rita Rep');
    expect(await screen.findByText('Stops (1)')).toBeTruthy();
    expect(screen.getByText(/Stopped 15 min/)).toBeTruthy();
  });
});
