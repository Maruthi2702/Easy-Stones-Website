import {
  BATTERY_CHECK_MS, FLUSH_AT, FLUSH_EVERY_MS, HEARTBEAT_EVERY_MS, STATUS_EVERY_MS,
  batteryCrossed, heartbeatBody, needsStillPoint, phaseFor, shouldKeep, statusIsStale, takeBatch, toRawPoint, trimQueue,
  type DeviceState, type Phase, type PluginLocation, type TrackingStatus
} from '../../../src/features/locationCollector/collectorRules';
import type { RawPoint } from '../../../src/utils/locationTracking';

/**
 * The location collector, as plain TypeScript with every outside thing passed in (`Ports`): no React Native, no WebView, no DOM.
 * It is the website's collector (src/features/locationCollector/useLocationCollector.ts) with the same rules — the 7–6 window from
 * the server's status, one point per 45 s, a "still here" point after 5 quiet minutes, batches, a heartbeat every 5 minutes, a flush
 * when the battery falls to 15% / 5% — but event-driven: `onLocations` and `tick` are called by the background task, so
 * it runs with the page suspended or closed. Every duty is guarded by a timestamp, so calling `tick` often, or from two places, is safe.
 */
export type SendResult = 'sent' | 'consent' | 'off' | 'retry';
export type StatusAnswer = { kind: 'status'; status: TrackingStatus } | { kind: 'signed-out' };

export interface Ports {
  now(): number;
  rand(): string;
  /** Rejects on no signal. 'signed-out' when the server answered 401 (the session is gone). */
  loadStatus(): Promise<StatusAnswer>;
  sendPoints(points: RawPoint[]): Promise<SendResult>;
  sendHeartbeat(body: object): Promise<boolean>;
  readDevice(): Promise<DeviceState>;
  /** One fresh position, or null. */
  currentPosition(): Promise<{ lat: number; lng: number; accuracy: number | null } | null>;
  loadQueue(userId: string): Promise<RawPoint[]>;
  saveQueue(userId: string, points: RawPoint[]): Promise<void>;
  /** Start / stop the OS location updates. */
  setWatching(on: boolean): Promise<void>;
}

export class CollectorEngine {
  status: TrackingStatus | null = null;
  queue: RawPoint[] = [];
  denied = false;
  watching = false;
  /** The server said the session is gone: the owner should stop us. */
  signedOut = false;
  lastKept: number | null = null;
  lastSentAt = 0;
  private lastFlushAt = 0;
  private lastHeartbeatAt = 0;
  private lastDeviceAt = 0;
  private lastStatusAt = 0;
  private battery: number | null = null;
  private flushing = false;
  private ticking = false;

  private readonly ports: Ports;
  readonly userId: string;

  constructor(ports: Ports, userId: string) { this.ports = ports; this.userId = userId; }

  async init(): Promise<void> {
    this.queue = trimQueue(await this.ports.loadQueue(this.userId), this.ports.now());
  }

  phase(): Phase { return phaseFor({ status: this.status, denied: this.denied, now: new Date(this.ports.now()) }); }

  private async persist() { await this.ports.saveQueue(this.userId, this.queue); }

  /** Positions from the OS. Kept only while the phase is "running". */
  async onLocations(locations: PluginLocation[]): Promise<void> {
    if (this.phase() !== 'running') return;
    let added = false;
    for (const loc of locations) {
      const point = toRawPoint(loc, this.ports.rand());
      const at = Number(loc.time);
      if (!point || !shouldKeep(this.lastKept, at)) continue;
      this.lastKept = at;
      this.queue = trimQueue([...this.queue, point], this.ports.now());
      added = true;
    }
    if (added) await this.persist();
    if (this.queue.length >= FLUSH_AT) await this.flush();
  }

  /** Sends the queue in batches, oldest first. Stops on no signal; clears it when the server says this role isn't tracked. */
  async flush(): Promise<void> {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const { batch, rest } = takeBatch(this.queue);
        const result = await this.ports.sendPoints(batch);
        if (result === 'retry') break;
        if (result === 'consent') { this.lastStatusAt = 0; break; }
        this.queue = result === 'off' ? [] : rest;
        if (result === 'sent') this.lastSentAt = this.ports.now();
        await this.persist();
        if (result === 'off') { this.lastStatusAt = 0; break; }
      }
    } finally { this.flushing = false; this.lastFlushAt = this.ports.now(); }
  }

  private async refreshStatus(force = false): Promise<void> {
    const now = this.ports.now();
    if (!force && this.status && !statusIsStale(this.status, new Date(now)) && now - this.lastStatusAt < STATUS_EVERY_MS) return;
    try {
      const answer = await this.ports.loadStatus();
      if (answer.kind === 'signed-out') { this.signedOut = true; return; }
      this.status = answer.status;
      this.lastStatusAt = now;
    } catch { /* keep the last answer; tried again on the next tick */ }
  }

  /** What the phone says about itself: the same duties as the page (permission, heartbeat, battery crossing, "still here"). */
  async tick(): Promise<void> {
    if (this.ticking || this.signedOut) return;
    this.ticking = true;
    try {
      await this.refreshStatus();
      if (this.signedOut) return;
      const now = this.ports.now();
      let device: DeviceState | null = null;
      if (now - this.lastDeviceAt >= BATTERY_CHECK_MS) {
        this.lastDeviceAt = now;
        device = await this.ports.readDevice();
        this.denied = device.permission === 'denied';
      }
      const phase = this.phase();
      const wantWatching = phase === 'running';
      if (wantWatching !== this.watching) { await this.ports.setWatching(wantWatching); this.watching = wantWatching; }

      if (phase === 'running' || phase === 'denied') {
        const crossed = device ? batteryCrossed(this.battery, device.batteryPct, device.charging) : false;
        if (device) this.battery = device.batteryPct;
        if (crossed || now - this.lastHeartbeatAt >= HEARTBEAT_EVERY_MS) {
          this.lastHeartbeatAt = now;
          const d = device ?? await this.ports.readDevice();
          void this.ports.sendHeartbeat(heartbeatBody(d, this.queue.length, new Date(now)));
        }
        if (crossed) await this.flush();     // get everything off the phone while it still can
      }

      if (phase === 'running' && needsStillPoint(this.lastKept, now)) {
        const here = await this.ports.currentPosition();
        if (here) {
          const at = this.ports.now();
          const point = toRawPoint({ latitude: here.lat, longitude: here.lng, accuracy: here.accuracy, time: at }, this.ports.rand());
          if (point && needsStillPoint(this.lastKept, at)) {
            this.lastKept = at;
            this.queue = trimQueue([...this.queue, point], at);
            await this.persist();
          }
        }
      }

      // Send what is waiting: every 30 s while running, and once more after the window closes.
      if (this.queue.length && (phase === 'running' || phase === 'waiting' || phase === 'denied') && now - this.lastFlushAt >= FLUSH_EVERY_MS) await this.flush();
    } finally { this.ticking = false; }
  }

  /** Stop: put the OS updates out and make a last attempt to send. */
  async stop(): Promise<void> {
    if (this.watching) { await this.ports.setWatching(false); this.watching = false; }
    await this.flush();
  }
}

export { FLUSH_EVERY_MS };
