import { describe, expect, it } from 'vitest';
import { CollectorEngine, type Ports, type SendResult, type StatusAnswer } from './core';
import type { DeviceState, TrackingStatus } from '../../../src/features/locationCollector/collectorRules';
import type { RawPoint } from '../../../src/utils/locationTracking';

// Wednesday noon in Seattle, and the same evening after 6 PM.
const NOON = Date.parse('2026-11-18T20:00:00Z');
const EVENING = Date.parse('2026-11-19T03:00:00Z');
const STATUS: TrackingStatus = { tracked: true, consented: true, branch: 'Seattle', windowNow: true, windowStart: 7, windowEnd: 18 };
const DEVICE: DeviceState = { permission: 'always', lowPower: false, batteryPct: 80, charging: false, appVersion: '1.0' };

function setup(over: Partial<Ports> = {}, start = NOON) {
  const t = { now: start };
  const sent: RawPoint[][] = [];
  const heartbeats: object[] = [];
  const watching: boolean[] = [];
  let saved: RawPoint[] = [];
  let n = 0;
  const ports: Ports = {
    now: () => t.now,
    rand: () => `r${n++}`,
    loadStatus: async (): Promise<StatusAnswer> => ({ kind: 'status', status: STATUS }),
    sendPoints: async (points): Promise<SendResult> => { sent.push(points); return 'sent'; },
    sendHeartbeat: async (body) => { heartbeats.push(body); return true; },
    readDevice: async () => DEVICE,
    currentPosition: async () => ({ lat: 47.6, lng: -122.3, accuracy: 10 }),
    loadQueue: async () => saved,
    saveQueue: async (_id, points) => { saved = points; },
    setWatching: async (on) => { watching.push(on); },
    ...over
  };
  const engine = new CollectorEngine(ports, 'u1');
  return { t, sent, heartbeats, watching, engine, saved: () => saved };
}
const MIN = 60_000;
const total = (e: CollectorEngine, sent: RawPoint[][]) => sent.flat().length + e.queue.length;
const tenPoints = () => Array.from({ length: 10 }, (_, i) => loc(NOON + (i + 1) * MIN, 47.6 + i * 0.001));
const loc = (at: number, lat = 47.6) => ({ latitude: lat, longitude: -122.3, accuracy: 10, time: at });

describe('CollectorEngine', () => {
  it('turns the OS watcher on inside the window and keeps positions', async () => {
    const { engine, watching, sent } = setup();
    await engine.init(); await engine.tick();
    expect(engine.phase()).toBe('running');
    expect(watching).toEqual([true]);
    await engine.onLocations([loc(NOON + MIN)]);
    expect(total(engine, sent)).toBe(2);   // the "still here" point taken at start, and this one
  });

  it('keeps one point per 45 seconds', async () => {
    const { engine, sent } = setup();
    await engine.init(); await engine.tick();
    await engine.onLocations([loc(NOON + MIN), loc(NOON + MIN + 10_000), loc(NOON + MIN + 44_000), loc(NOON + MIN + 45_000)]);
    expect(total(engine, sent)).toBe(3);   // start, +60 s, +105 s
  });

  it('keeps nothing outside the 7–6 window and leaves the watcher off', async () => {
    const { engine, watching, sent } = setup({}, EVENING);
    await engine.init(); await engine.tick();
    expect(engine.phase()).toBe('waiting');
    expect(watching).toEqual([]);
    await engine.onLocations([loc(EVENING)]);
    expect(total(engine, sent)).toBe(0);
  });

  it('collects nothing until the person has agreed', async () => {
    const { engine, sent } = setup({ loadStatus: async () => ({ kind: 'status', status: { ...STATUS, consented: false } }) });
    await engine.init(); await engine.tick();
    expect(engine.phase()).toBe('needs-consent');
    await engine.onLocations([loc(NOON)]);
    expect(total(engine, sent)).toBe(0);
  });

  it('sends a batch once 10 points are waiting and empties the queue', async () => {
    const { engine, sent } = setup();
    await engine.init(); await engine.tick();
    sent.length = 0;
    await engine.onLocations(tenPoints());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(10);
    expect(engine.queue).toHaveLength(0);
  });

  it('keeps the queue when there is no signal and sends it later', async () => {
    let result: SendResult = 'retry';
    const { engine, t, saved } = setup({ sendPoints: async () => result });
    await engine.init(); await engine.tick();
    await engine.onLocations(tenPoints());
    expect(engine.queue).toHaveLength(11);  // 10 plus the one taken at start
    expect(saved()).toHaveLength(11);
    result = 'sent'; t.now += 40_000;
    await engine.tick();
    expect(engine.queue).toHaveLength(0);
  });

  it('clears the queue when the server says this role is not tracked', async () => {
    const { engine } = setup({ sendPoints: async () => 'off' });
    await engine.init(); await engine.tick();
    await engine.onLocations(tenPoints());
    expect(engine.queue).toHaveLength(0);
  });

  it('keeps points when the server has no consent on file', async () => {
    const { engine } = setup({ sendPoints: async () => 'consent' });
    await engine.init(); await engine.tick();
    await engine.onLocations(tenPoints());
    expect(engine.queue).toHaveLength(11);
  });

  it('adds a "still here" position after five quiet minutes', async () => {
    const { engine, t, sent } = setup();
    await engine.init(); await engine.tick();
    expect(total(engine, sent)).toBe(1);
    t.now = NOON + 5 * MIN + 1;
    await engine.tick();
    expect(total(engine, sent)).toBe(2);
  });

  it('sends a heartbeat every five minutes with how many points are queued', async () => {
    const { engine, heartbeats, t } = setup();
    await engine.init(); await engine.tick();
    expect(heartbeats).toHaveLength(1);
    t.now += 60_000; await engine.tick();
    expect(heartbeats).toHaveLength(1);
    t.now += 5 * 60_000; await engine.tick();
    expect(heartbeats).toHaveLength(2);
  });

  it('flushes at once when the battery falls to 15%', async () => {
    let pct = 40;
    const { engine, sent, t } = setup({ readDevice: async () => ({ ...DEVICE, batteryPct: pct }) });
    await engine.init(); await engine.tick();
    await engine.onLocations([loc(NOON + 60_000), loc(NOON + 120_000)]);
    pct = 15; t.now += 61_000;
    await engine.tick();
    expect(sent.length).toBeGreaterThan(0);
    expect(engine.queue).toHaveLength(0);
  });

  it('reports denied when the permission is gone and stops the watcher', async () => {
    let permission: DeviceState['permission'] = 'always';
    const { engine, watching, t } = setup({ readDevice: async () => ({ ...DEVICE, permission }) });
    await engine.init(); await engine.tick();
    permission = 'denied'; t.now += 61_000;
    await engine.tick();
    expect(engine.phase()).toBe('denied');
    expect(watching).toEqual([true, false]);
  });

  it('marks itself signed out on a 401 from status', async () => {
    const { engine } = setup({ loadStatus: async () => ({ kind: 'signed-out' }) });
    await engine.init(); await engine.tick();
    expect(engine.signedOut).toBe(true);
  });

  it('drops queued points older than the server accepts when it starts', async () => {
    const old = { id: 'old', at: new Date(NOON - 49 * 3600_000).toISOString() };
    const fresh = { id: 'new', at: new Date(NOON - 1000).toISOString() };
    const { engine } = setup({ loadQueue: async () => [old, fresh] });
    await engine.init();
    expect(engine.queue.map((p) => p.id)).toEqual(['new']);
  });

  it('stop() turns the watcher off and makes a last send', async () => {
    const { engine, watching, sent } = setup();
    await engine.init(); await engine.tick();
    await engine.onLocations([loc(NOON)]);
    await engine.stop();
    expect(watching).toEqual([true, false]);
    expect(sent).toHaveLength(1);
  });
});
