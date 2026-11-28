import { type Clock, type PermissionState, type Recognizer, type RecognizerEvents, type RecognizerStart } from './core';

/** Test doubles for the listener: a recognizer driven by hand and a clock advanced by hand (used by core.test.ts and the bridge test). */
export class FakeClock implements Clock {
  t = 1_000_000;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private n = 0;
  now() { return this.t; }
  after(fn: () => void, ms: number) { const id = ++this.n; this.timers.push({ at: this.t + ms, fn, id }); return () => { this.timers = this.timers.filter((x) => x.id !== id); }; }
  advance(ms: number) {
    const to = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= to).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = due.at; due.fn();
    }
    this.t = to;
  }
}
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));

export class FakeRecognizer implements Recognizer {
  handlers: Record<string, Set<(e: never) => void>> = {};
  started: RecognizerStart[] = [];
  calls: string[] = [];
  perm: PermissionState = { granted: true, canAskAgain: true, status: 'granted' };
  onDevice = true;
  available = true;
  /** What each call does by itself; tests turn these off to play the events by hand. */
  autoStart = true;
  autoEndOnStop = false;
  autoEndOnAbort = true;
  start(o: RecognizerStart) { this.calls.push('start'); this.started.push(o); if (this.autoStart) queueMicrotask(() => this.emit('start', null)); }
  stop() { this.calls.push('stop'); if (this.autoEndOnStop) queueMicrotask(() => this.emit('end', null)); }
  abort() { this.calls.push('abort'); if (this.autoEndOnAbort) queueMicrotask(() => this.emit('end', null)); }
  on<K extends keyof RecognizerEvents>(event: K, handler: (e: RecognizerEvents[K]) => void) {
    const set = (this.handlers[event] ??= new Set());
    const h = handler as (e: never) => void;
    set.add(h);
    return () => { set.delete(h); };
  }
  emit<K extends keyof RecognizerEvents>(event: K, data: RecognizerEvents[K]) { for (const h of [...(this.handlers[event] ?? [])]) (h as (e: RecognizerEvents[K]) => void)(data); }
  said(transcript: string, isFinal = false) { this.emit('result', { isFinal, results: [{ transcript }] }); }
  listeners() { return Object.values(this.handlers).reduce((n, s) => n + (s?.size ?? 0), 0); }
  async getPermissions() { return this.perm; }
  async requestPermissions() { if (this.perm.canAskAgain && this.willGrant) this.perm = { granted: true, canAskAgain: true, status: 'granted' }; else this.perm = { granted: false, canAskAgain: false, status: 'denied' }; return this.perm; }
  willGrant = true;
  supportsOnDevice() { return this.onDevice; }
  isAvailable() { return this.available; }
}

