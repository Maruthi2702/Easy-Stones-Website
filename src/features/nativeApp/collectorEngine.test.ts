import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectorEngine, type Ports } from '../../../mobile/src/collector/core';
import { FLUSH_AT, HEARTBEAT_EVERY_MS, STILL_EVERY_MS, type DeviceState, type TrackingStatus } from '../locationCollector/collectorRules';
import type { RawPoint } from '../../utils/locationTracking';

/**
 * The React Native collector's engine (mobile/src/collector/core.ts), run against fake ports and a fake clock: the same rules as the page's
 * collector, with no page. Wed 2026-11-18, noon in Seattle (inside 7–6); 7 PM is outside.
 */
const NOON = new Date('2026-11-18T20:00:00Z').getTime();
const EVENING = new Date('2026-11-19T03:00:00Z').getTime();
const STATUS: TrackingStatus = { tracked: true, consented: true, branch: 'Seattle', windowNow: true, windowStart: 7, windowEnd: 18 };
const DEVICE: DeviceState = { permission: 'always', lowPower: false, batteryPct: 80, charging: false, appVersion: '1' };

let clock = NOON; let n = 0;
let saved: RawPoint[] = [];
const ports = {
  now: vi.fn(() => clock), rand: vi.fn(() => `r${++n}`),
  loadStatus: vi.fn(async () => ({ kind: 'status' as const, status: STATUS })),
  sendPoints: vi.fn(async (_p: RawPoint[]) => 'sent' as 'sent' | 'consent' | 'off' | 'retry'),
  sendHeartbeat: vi.fn(async (_body: unknown) => true),
  readDevice: vi.fn(async () => DEVICE),
  currentPosition: vi.fn(async () => ({ lat: 47.6, lng: -122.3, accuracy: 9 as number | null })),
  loadQueue: vi.fn(async () => [] as RawPoint[]),
  saveQueue: vi.fn(async (_u: string, p: RawPoint[]) => { saved = p; }),
  setWatching: vi.fn(async () => undefined)
};
/** The OS's i-th position, a minute apart, each after the "still here" point the first tick may have added. */
const loc = (i: number) => ({ latitude: 47.6 + i / 10000, longitude: -122.3, accuracy: 10, time: NOON + (i + 1) * 60_000 });
const make = async () => { const e = new CollectorEngine(ports as unknown as Ports, 'u1'); await e.init(); return e; };

beforeEach(() => {
  clock = NOON; n = 0; saved = [];
  vi.clearAllMocks();
  ports.loadStatus.mockResolvedValue({ kind: 'status', status: STATUS });
  ports.sendPoints.mockResolvedValue('sent');
  ports.readDevice.mockResolvedValue(DEVICE);
  ports.loadQueue.mockResolvedValue([]);
  ports.currentPosition.mockResolvedValue(null as never);   // no "still here" reading unless a test wants one
});

describe('CollectorEngine', () => {
  it('keeps points while running, saves them, and sends a batch at FLUSH_AT', async () => {
    const e = await make(); await e.tick();
    await e.onLocations(Array.from({ length: FLUSH_AT - 1 }, (_, i) => loc(i)));
    expect(e.queue).toHaveLength(FLUSH_AT - 1); expect(saved).toHaveLength(FLUSH_AT - 1);
    expect(ports.sendPoints).not.toHaveBeenCalled();
    await e.onLocations([loc(FLUSH_AT)]);
    expect(ports.sendPoints).toHaveBeenCalledTimes(1);
    expect(ports.sendPoints.mock.calls[0]![0]).toHaveLength(FLUSH_AT);
    expect(e.queue).toEqual([]); expect(saved).toEqual([]);
  });

  it('keeps one point per 45 seconds', async () => {
    const e = await make(); await e.tick();
    await e.onLocations([{ latitude: 47.6, longitude: -122.3, accuracy: 5, time: NOON - 100_000 }, { latitude: 47.6, longitude: -122.3, accuracy: 5, time: NOON - 90_000 }, { latitude: 47.6, longitude: -122.3, accuracy: 5, time: NOON - 40_000 }]);
    expect(e.queue).toHaveLength(2);
  });

  it('collects nothing outside the window, before consent, when not tracked, or without a status', async () => {
    let e = await make(); await e.onLocations([loc(1)]); expect(e.queue).toEqual([]);   // no status yet
    clock = EVENING; await e.tick(); await e.onLocations([loc(2)]); expect(e.queue).toEqual([]);
    clock = NOON; ports.loadStatus.mockResolvedValue({ kind: 'status', status: { ...STATUS, consented: false } });
    e = await make(); await e.tick(); await e.onLocations([loc(3)]); expect(e.queue).toEqual([]);
    ports.loadStatus.mockResolvedValue({ kind: 'status', status: { ...STATUS, tracked: false } });
    e = await make(); await e.tick(); await e.onLocations([loc(4)]); expect(e.queue).toEqual([]);
  });

  it('turns the OS updates on at the start of the window and off when it ends', async () => {
    const e = await make(); await e.tick();
    expect(ports.setWatching).toHaveBeenLastCalledWith(true); expect(e.watching).toBe(true);
    clock = EVENING; await e.tick();
    expect(ports.setWatching).toHaveBeenLastCalledWith(false); expect(e.watching).toBe(false);
  });

  it('sends a heartbeat on start and every 5 minutes, with what is waiting', async () => {
    const e = await make(); await e.tick();
    expect(ports.sendHeartbeat).toHaveBeenCalledTimes(1);
    expect(ports.sendHeartbeat.mock.calls[0]![0]).toMatchObject({ permission: 'always', batteryPct: 80, queued: 0 });
    clock += 60_000; await e.tick(); expect(ports.sendHeartbeat).toHaveBeenCalledTimes(1);
    clock += HEARTBEAT_EVERY_MS; await e.tick(); expect(ports.sendHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('flushes and reports at once when the battery falls to 15%', async () => {
    const e = await make(); await e.tick();
    await e.onLocations([loc(1), loc(2)]);
    clock += 61_000; ports.readDevice.mockResolvedValue({ ...DEVICE, batteryPct: 14 });
    await e.tick();
    expect(ports.sendPoints).toHaveBeenCalledTimes(1);
    expect(ports.sendHeartbeat).toHaveBeenCalledTimes(2);
    expect(ports.sendHeartbeat.mock.calls[1]![0]).toMatchObject({ batteryPct: 14 });
  });

  it('adds a "still here" point after 5 quiet minutes', async () => {
    ports.sendPoints.mockResolvedValue('retry');                       // keep what is added, to count it
    ports.currentPosition.mockResolvedValue({ lat: 47.6, lng: -122.3, accuracy: 9 });
    const e = await make(); await e.tick();
    expect(e.queue).toHaveLength(1);                                   // none kept yet this run
    clock += 60_000; await e.tick(); expect(e.queue).toHaveLength(1);  // too soon
    clock += STILL_EVERY_MS; await e.tick(); expect(e.queue).toHaveLength(2);
    ports.currentPosition.mockResolvedValue(null as never);            // no fix: nothing added, no crash
    clock += STILL_EVERY_MS; await e.tick(); expect(e.queue).toHaveLength(2);
  });

  it('keeps the queue on no signal and on missing consent, clears it when the role is not tracked', async () => {
    const e = await make(); await e.tick();
    ports.sendPoints.mockResolvedValue('retry'); await e.onLocations(Array.from({ length: FLUSH_AT }, (_, i) => loc(i)));
    expect(e.queue).toHaveLength(FLUSH_AT);
    ports.sendPoints.mockResolvedValue('consent'); await e.flush(); expect(e.queue).toHaveLength(FLUSH_AT);
    ports.sendPoints.mockResolvedValue('off'); await e.flush(); expect(e.queue).toEqual([]); expect(saved).toEqual([]);
  });

  it('sends the oldest batch of 200 first and carries on', async () => {
    ports.loadQueue.mockResolvedValue(Array.from({ length: 250 }, (_, i) => ({ id: `p${i}`, at: new Date(NOON - 3_000_000 + i * 1000).toISOString(), lat: 47.6, lng: -122.3 })));
    const e = await make(); await e.flush();
    expect(ports.sendPoints.mock.calls.map((c) => c[0].length)).toEqual([200, 50]);
  });

  it('drops points the server would refuse as stale when it loads them', async () => {
    ports.loadQueue.mockResolvedValue([{ id: 'old', at: new Date(NOON - 49 * 3600_000).toISOString(), lat: 1, lng: 1 }, { id: 'new', at: new Date(NOON - 1000).toISOString(), lat: 1, lng: 1 }]);
    expect((await make()).queue.map((p) => p.id)).toEqual(['new']);
  });

  it('stops collecting and says so when the phone refused location, but still reports', async () => {
    const e = await make(); await e.tick();
    clock += 61_000; ports.readDevice.mockResolvedValue({ ...DEVICE, permission: 'denied' });
    await e.tick();
    expect(e.phase()).toBe('denied'); expect(e.denied).toBe(true);
    expect(ports.setWatching).toHaveBeenLastCalledWith(false);
    clock += HEARTBEAT_EVERY_MS; ports.readDevice.mockResolvedValue({ ...DEVICE, permission: 'denied' }); await e.tick();
    expect(ports.sendHeartbeat.mock.calls.at(-1)![0]).toMatchObject({ permission: 'denied' });
  });

  it('asks for a fresh status every 5 minutes and survives no signal', async () => {
    const e = await make(); await e.tick(); expect(ports.loadStatus).toHaveBeenCalledTimes(1);
    clock += 60_000; await e.tick(); expect(ports.loadStatus).toHaveBeenCalledTimes(1);
    clock += 5 * 60_000; ports.loadStatus.mockRejectedValueOnce(new Error('offline')); await e.tick();
    expect(ports.loadStatus).toHaveBeenCalledTimes(2); expect(e.phase()).toBe('running');   // kept the last answer
  });

  it('notices a signed-out session and stops doing anything', async () => {
    const e = await make(); await e.tick();
    clock += 5 * 60_000; ports.loadStatus.mockResolvedValue({ kind: 'signed-out' } as never); await e.tick();
    expect(e.signedOut).toBe(true);
    ports.sendHeartbeat.mockClear(); clock += HEARTBEAT_EVERY_MS; await e.tick(); expect(ports.sendHeartbeat).not.toHaveBeenCalled();
  });

  it('on stop(): puts the OS updates out and makes a last send', async () => {
    const e = await make(); await e.tick(); await e.onLocations([loc(1)]);
    ports.sendPoints.mockClear(); await e.stop();
    expect(ports.setWatching).toHaveBeenLastCalledWith(false);
    expect(ports.sendPoints).toHaveBeenCalledTimes(1);
  });

  it('never runs two ticks or two flushes at once', async () => {
    const e = await make(); await e.tick();
    ports.loadStatus.mockClear(); clock += 5 * 60_000;
    await Promise.all([e.tick(), e.tick(), e.tick()]);
    expect(ports.loadStatus).toHaveBeenCalledTimes(1);
  });
});
