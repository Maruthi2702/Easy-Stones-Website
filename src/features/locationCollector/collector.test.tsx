// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FLUSH_AT, MAX_QUEUE, STILL_EVERY_MS, batteryCrossed, heartbeatBody, needsStillPoint, dayIsOn, phaseFor, statusIsStale, shouldKeep, takeBatch, toRawPoint, trimQueue, untilText, type TrackingStatus } from './collectorRules';
import { clearQueue, loadQueue, mergeQueues, saveQueue } from './pointQueue';

const native = vi.hoisted(() => ({ isNative: true, platform: 'ios' }));
const api = vi.hoisted(() => ({ sendHeartbeat: vi.fn(async () => true), loadStatus: vi.fn(), sendPoints: vi.fn(), recordConsent: vi.fn(), loadOpenRequests: vi.fn(async () => []), sendRequestAnswer: vi.fn() }));
const bg = vi.hoisted(() => ({ startWakeups: vi.fn(async () => true), stopWakeups: vi.fn(async () => undefined), saveDurable: vi.fn(async () => undefined), loadDurable: vi.fn(async (): Promise<unknown[]> => []), clearDurable: vi.fn(async () => undefined), readDevice: vi.fn(async () => ({ permission: 'unknown', lowPower: false, batteryPct: 80, charging: false, appVersion: '1.0' })), startWatching: vi.fn(), openLocationSettings: vi.fn(), askAlways: vi.fn(async () => undefined), openBatterySettings: vi.fn(async () => undefined), currentPosition: vi.fn(async () => null), insideReactNativeApp: vi.fn(() => false), phoneCollects: vi.fn(async () => false), startPhoneCollecting: vi.fn(async () => ({ started: true, denied: false })), stopPhoneCollecting: vi.fn(async () => undefined), phoneDenied: vi.fn(async () => false) }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: { addListener: () => Promise.resolve({ remove: () => undefined }) } }));
const auth = vi.hoisted(() => ({ user: { id: 'u1', type: 'internal' } as { id: string; type: string } | null }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.isNative, getPlatform: () => native.platform }, registerPlugin: () => ({}) }));
vi.mock('@capacitor/app', () => ({ App: { addListener: () => Promise.resolve({ remove: () => undefined }) } }));
vi.mock('./collectorApi', () => api);
vi.mock('./backgroundLocation', () => bg);
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

import LocationCollector from './LocationCollector';

// Wed 2026-11-18, noon in Seattle (inside 7–6) and 7 PM (outside).
const NOON = new Date('2026-11-18T20:00:00Z');
const EVENING = new Date('2026-11-19T03:00:00Z');
const STATUS: TrackingStatus = { tracked: true, consented: true, branch: 'Seattle', windowNow: true, windowStart: 7, windowEnd: 18 };

describe('collector rules', () => {
  it('decides the phase', () => {
    const base = { status: STATUS, denied: false, now: NOON };
    expect(phaseFor(base)).toBe('running');
    expect(phaseFor({ ...base, now: EVENING })).toBe('waiting');
    expect(phaseFor({ ...base, status: { ...STATUS, consented: false } })).toBe('needs-consent');
    expect(phaseFor({ ...base, denied: true })).toBe('denied');
    expect(phaseFor({ ...base, status: { ...STATUS, tracked: false } })).toBe('off');
    expect(phaseFor({ ...base, status: null })).toBe('off');
  });
  it('turns a location into the server\'s point and refuses a broken one', () => {
    expect(toRawPoint({ latitude: 47.6, longitude: -122.3, accuracy: 12, speed: -1, time: 1_700_000_000_000 }, 'ab')).toEqual({
      id: '1700000000000-ab', at: '2023-11-14T22:13:20.000Z', lat: 47.6, lng: -122.3, accuracy: 12, speed: undefined
    });
    expect(toRawPoint({ latitude: NaN, longitude: 1, time: 1 }, 'x')).toBeNull();
    expect(toRawPoint({ latitude: 1, longitude: 1 }, 'x')).toBeNull();
  });
  it('keeps one point per 45 seconds', () => {
    expect(shouldKeep(null, 1000)).toBe(true);
    expect(shouldKeep(1000, 1000 + 44_000)).toBe(false);
    expect(shouldKeep(1000, 1000 + 45_000)).toBe(true);
  });
  it('trims stale points, caps the queue to the newest and takes batches in order', () => {
    const now = NOON.getTime();
    const pts = (n: number, start = now - 1000) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, at: new Date(start + i).toISOString() }));
    expect(trimQueue([{ id: 'old', at: new Date(now - 49 * 3600 * 1000).toISOString() }, ...pts(2)], now).map((p) => p.id)).toEqual(['p0', 'p1']);
    const big = trimQueue(pts(MAX_QUEUE + 5), now);
    expect(big).toHaveLength(MAX_QUEUE);
    expect(big[big.length - 1]!.id).toBe(`p${MAX_QUEUE + 4}`);
    const { batch, rest } = takeBatch(pts(250));
    expect([batch.length, rest.length]).toEqual([200, 50]);
  });
  it('says the end hour', () => { expect(untilText(18)).toBe('6 PM'); expect(untilText(12)).toBe('12 PM'); expect(untilText(0)).toBe('12 AM'); });
});

describe('the day, as the server says it', () => {
  const sat = new Date('2026-11-21T20:00:00Z'); // Saturday noon in Seattle
  const on = (over: Partial<TrackingStatus>) => ({ ...STATUS, day: '2026-11-21', dayOn: true, ...over });
  it('follows the server for its day: weekend work on, time off off', () => {
    expect(phaseFor({ status: on({}), denied: false, now: sat })).toBe('running');
    expect(phaseFor({ status: on({ dayOn: false, dayOffReason: 'weekend' }), denied: false, now: sat })).toBe('waiting');
    expect(phaseFor({ status: on({ day: '2026-11-18', dayOn: false, dayOffReason: 'timeOff' }), denied: false, now: NOON })).toBe('waiting');
  });
  it('falls back to the weekday rule when the answer is for an earlier day, and asks again', () => {
    const old = on({ day: '2026-11-20', dayOn: true });
    expect(dayIsOn(old, sat)).toBe(false);   // Saturday, and no answer for today yet
    expect(dayIsOn(old, new Date('2026-11-23T20:00:00Z'))).toBe(true); // Monday
    expect(statusIsStale(old, sat)).toBe(true);
    expect(statusIsStale(on({}), sat)).toBe(false);
    expect(statusIsStale(null, sat)).toBe(false);
    expect(statusIsStale(STATUS, sat)).toBe(false); // an old server with no day: nothing to compare
  });
  it('still stops at 6 PM on a day that is on', () => {
    expect(phaseFor({ status: on({}), denied: false, now: new Date('2026-11-22T02:30:00Z') })).toBe('waiting'); // Saturday 6:30 PM
  });
});

describe('unsent points on the phone', () => {
  beforeEach(() => localStorage.clear());
  it('are kept per person and cleared on demand', () => {
    saveQueue('u1', [{ id: 'a' }]);
    expect(loadQueue('u1')).toEqual([{ id: 'a' }]);
    expect(loadQueue('u2')).toEqual([]);
    clearQueue();
    expect(loadQueue('u1')).toEqual([]);
  });
});

describe('LocationCollector in the app', () => {
  let onLocation: (l: { latitude: number; longitude: number; accuracy: number; time: number }) => void = () => undefined;
  const stop = vi.fn(async () => undefined);
  beforeEach(() => {
    localStorage.clear(); native.isNative = true; native.platform = 'ios'; auth.user = { id: 'u1', type: 'internal' };
    vi.useFakeTimers({ toFake: ['Date'], now: NOON }); // only the clock: waitFor polls with setInterval
    api.loadStatus.mockResolvedValue(STATUS); api.sendPoints.mockResolvedValue('sent'); api.recordConsent.mockResolvedValue(undefined);
    bg.startWatching.mockImplementation(async (cb) => { onLocation = cb; return stop; });
    bg.loadDurable.mockResolvedValue([]);
    bg.insideReactNativeApp.mockReturnValue(false); bg.phoneCollects.mockResolvedValue(false); bg.phoneDenied.mockResolvedValue(false);
    bg.startPhoneCollecting.mockResolvedValue({ started: true, denied: false });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it('asks for consent first and starts nothing before it', async () => {
    api.loadStatus.mockResolvedValue({ ...STATUS, consented: false });
    render(<LocationCollector />);
    expect(await screen.findByText('Share your location during work hours')).toBeTruthy();
    expect(screen.getByText(/to record your visits and show your manager where you are on the job/)).toBeTruthy();
    expect(screen.getByText(/A manager may also request your location outside work hours/)).toBeTruthy();
    expect(bg.startWatching).not.toHaveBeenCalled();
  });
  it('saves Allow on the server and starts only when the server says it has it', async () => {
    api.loadStatus.mockResolvedValueOnce({ ...STATUS, consented: false }).mockResolvedValue(STATUS);
    render(<LocationCollector />);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(api.recordConsent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(bg.startWatching).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Share your location during work hours')).toBeNull();
  });
  it('on Android: discloses use when the app is closed, then asks for "Allow all the time" after Allow, and not on iPhone', async () => {
    native.platform = 'android';
    api.loadStatus.mockResolvedValueOnce({ ...STATUS, consented: false }).mockResolvedValue(STATUS);
    render(<LocationCollector />);
    expect(await screen.findByText(/including when the app is closed or not in use/)).toBeTruthy();
    expect(screen.getByText(/Choose “Allow all the time”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open battery settings' }));
    expect(bg.openBatterySettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(bg.askAlways).toHaveBeenCalledTimes(1));
    cleanup();
    native.platform = 'ios'; bg.askAlways.mockClear();
    api.loadStatus.mockResolvedValueOnce({ ...STATUS, consented: false }).mockResolvedValue(STATUS);
    render(<LocationCollector />);
    expect(await screen.findByText(/including when the app is in the background/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(bg.startWatching).toHaveBeenCalled());
    expect(bg.askAlways).not.toHaveBeenCalled();
  });
  it('stays on the consent screen with the reason when Allow can\'t be saved', async () => {
    api.loadStatus.mockResolvedValue({ ...STATUS, consented: false });
    api.recordConsent.mockRejectedValue(new Error('Couldn’t reach the server. Check your connection and try again.'));
    render(<LocationCollector />);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t reach the server');
    expect(bg.startWatching).not.toHaveBeenCalled();
  });
  it('asks iOS to wake the app on a move once tracked and agreed, and not before consent', async () => {
    api.loadStatus.mockResolvedValueOnce({ ...STATUS, consented: false }).mockResolvedValue(STATUS);
    render(<LocationCollector />);
    await screen.findByRole('button', { name: 'Allow' });
    await waitFor(() => expect(bg.stopWakeups).toHaveBeenCalled());
    expect(bg.startWakeups).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(bg.startWakeups).toHaveBeenCalled());
  });
  it('writes the queue to the native file as well, and joins that file back in after a restart', async () => {
    bg.loadDurable.mockResolvedValue([{ id: 'from-file', at: '2026-11-18T19:00:00.000Z', lat: 47.6, lng: -122.3 }]);
    render(<LocationCollector />);
    await waitFor(() => expect(bg.loadDurable).toHaveBeenCalled());
    await waitFor(() => expect(bg.loadDurable).toHaveBeenCalledWith('u1'));
    // the file's point is now in the queue (saved back to both copies) and goes out with the next batch
    await waitFor(() => expect(bg.saveDurable).toHaveBeenCalledWith('u1', expect.arrayContaining([expect.objectContaining({ id: 'from-file' })])));
    expect(loadQueue('u1').map((p) => p.id)).toContain('from-file');
  });
  it('after consent, watches, shows no pin and sends points in a batch', async () => {
    render(<LocationCollector />);
    expect(screen.queryByText(/Location on until/)).toBeNull();
    await waitFor(() => expect(bg.startWatching).toHaveBeenCalledTimes(1));
    for (let i = 0; i < FLUSH_AT; i++) act(() => onLocation({ latitude: 47.6 + i / 1000, longitude: -122.3, accuracy: 10, time: NOON.getTime() - 1000 + i * 60_000 - 20 * 60_000 }));
    await waitFor(() => expect(api.sendPoints).toHaveBeenCalledTimes(1));
    expect(api.sendPoints.mock.calls[0]![0]).toHaveLength(FLUSH_AT);
    expect(loadQueue('u1')).toEqual([]);
  });
  describe('inside the React Native app (the phone collects)', () => {
    it('never collects or sends in the page, asks the phone to collect, ', async () => {
      bg.insideReactNativeApp.mockReturnValue(true); bg.phoneCollects.mockResolvedValue(true);
      render(<LocationCollector />);
      await waitFor(() => expect(bg.startPhoneCollecting).toHaveBeenCalledWith('u1'));
      expect(bg.startWatching).not.toHaveBeenCalled();
      expect(bg.startWakeups).not.toHaveBeenCalled();
      expect(api.sendPoints).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 50));
      expect(api.sendHeartbeat).not.toHaveBeenCalled();
    });
    it('shows "off" and stops the phone when the person is not tracked', async () => {
      bg.insideReactNativeApp.mockReturnValue(true); bg.phoneCollects.mockResolvedValue(true);
      api.loadStatus.mockResolvedValue({ ...STATUS, tracked: false });
      render(<LocationCollector />);
      await waitFor(() => expect(bg.stopPhoneCollecting).toHaveBeenCalled());
      expect(bg.startPhoneCollecting).not.toHaveBeenCalled();
    });
    it('draws no "location is off" banner of its own: the React Native app shows it natively', async () => {
      bg.insideReactNativeApp.mockReturnValue(true); bg.phoneCollects.mockResolvedValue(true);
      bg.startPhoneCollecting.mockResolvedValueOnce({ started: false, denied: true });
      render(<LocationCollector />);
      await waitFor(() => expect(bg.startPhoneCollecting).toHaveBeenCalled());
      expect(screen.queryByText(/Location is off for Easy Surfaces/)).toBeNull();
    });
    it('draws no consent screen of its own: the phone asks, with the same wording', async () => {
      bg.insideReactNativeApp.mockReturnValue(true); bg.phoneCollects.mockResolvedValue(true);
      api.loadStatus.mockResolvedValue({ ...STATUS, consented: false });
      render(<LocationCollector />);
      await waitFor(() => expect(bg.stopPhoneCollecting).toHaveBeenCalled());
      expect(screen.queryByText('Share your location during work hours')).toBeNull();
    });
    it('falls back to collecting in the page on a build whose phone cannot collect', async () => {
      bg.insideReactNativeApp.mockReturnValue(true); bg.phoneCollects.mockResolvedValue(false);
      render(<LocationCollector />);
      await waitFor(() => expect(bg.startWatching).toHaveBeenCalledTimes(1));
      expect(bg.startPhoneCollecting).not.toHaveBeenCalled();
    });
    it('collects nothing in the page while it is still asking the phone', async () => {
      bg.insideReactNativeApp.mockReturnValue(true);
      let answer: (v: boolean) => void = () => undefined;
      bg.phoneCollects.mockReturnValue(new Promise<boolean>((r) => { answer = r; }));
      render(<LocationCollector />);
      await waitFor(() => expect(bg.phoneCollects).toHaveBeenCalled());
      expect(bg.startWatching).not.toHaveBeenCalled();
      answer(true);
      await waitFor(() => expect(bg.startPhoneCollecting).toHaveBeenCalled());
      expect(bg.startWatching).not.toHaveBeenCalled();
    });
  });
  it('keeps points when there is no signal', async () => {
    api.sendPoints.mockResolvedValue('retry');
    render(<LocationCollector />);
    await waitFor(() => expect(bg.startWatching).toHaveBeenCalled());
    for (let i = 0; i < 20; i++) act(() => onLocation({ latitude: 47.6, longitude: -122.3 + i / 1000, accuracy: 10, time: NOON.getTime() - 60_000 * (30 - i) }));
    await waitFor(() => expect(api.sendPoints).toHaveBeenCalled());
    expect(loadQueue('u1').length).toBe(20);
  });
  it('does nothing for someone who is not tracked, on the web, or for a non-staff login', async () => {
    api.loadStatus.mockResolvedValue({ ...STATUS, tracked: false });
    const { container } = render(<LocationCollector />);
    await waitFor(() => expect(api.loadStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    cleanup(); vi.clearAllMocks(); native.isNative = false;
    render(<LocationCollector />);
    expect(api.loadStatus).not.toHaveBeenCalled();
    cleanup(); native.isNative = true; auth.user = { id: 's1', type: 'supplier' };
    render(<LocationCollector />);
    expect(api.loadStatus).not.toHaveBeenCalled();
  });
  it('offers Settings when iOS location is off', async () => {
    bg.startWatching.mockImplementation(async (_cb, onDenied) => { onDenied(); return stop; });
    render(<LocationCollector />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));
    expect(bg.openLocationSettings).toHaveBeenCalled();
  });
});


describe('completeness-first rules (2026-11-22)', () => {
  it('sends a "still here" position once none was kept for 5 minutes, and at the start of a run', () => {
    expect(needsStillPoint(null, 1000)).toBe(true);
    expect(needsStillPoint(1000, 1000 + STILL_EVERY_MS - 1)).toBe(false);
    expect(needsStillPoint(1000, 1000 + STILL_EVERY_MS)).toBe(true);
  });
  it('notices the battery falling to 15% or 5%, only when not charging', () => {
    expect(batteryCrossed(40, 15, false)).toBe(true);
    expect(batteryCrossed(16, 14, false)).toBe(true);
    expect(batteryCrossed(15, 10, false)).toBe(false);     // already under 15
    expect(batteryCrossed(10, 5, false)).toBe(true);
    expect(batteryCrossed(6, 3, false)).toBe(true);
    expect(batteryCrossed(40, 10, true)).toBe(false);      // charging
    expect(batteryCrossed(40, null, false)).toBe(false);   // the phone couldn't say
    expect(batteryCrossed(null, 12, false)).toBe(true);    // first read is already low
  });
  it('builds the heartbeat body', () => {
    expect(heartbeatBody({ permission: 'unknown', lowPower: false, batteryPct: 7, charging: false, appVersion: '1.0+2' }, 12, new Date('2026-11-18T20:00:00Z')))
      .toEqual({ permission: 'unknown', lowPower: false, batteryPct: 7, charging: false, appVersion: '1.0+2', queued: 12, at: '2026-11-18T20:00:00.000Z' });
  });
});


describe('durable queue and wake-ups (native plugin, 2026-11-22)', () => {
  it('joins the two copies of the unsent points, each point once, oldest first', () => {
    const a = [{ id: '2', at: '2026-11-18T20:02:00Z' }, { id: '1', at: '2026-11-18T20:01:00Z' }];
    const b = [{ id: '3', at: '2026-11-18T20:03:00Z' }, { id: '1', at: '2026-11-18T20:01:00Z' }, { nope: true } as never];
    expect(mergeQueues(a, b).map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(mergeQueues([], [])).toEqual([]);
  });
});
