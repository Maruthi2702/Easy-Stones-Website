import { HINTS_MAX, type SpeechAvailability } from '../../../src/utils/assistantContract';
import { addResult, emptyHeard, heardText, type HeardState } from './heard';

/**
 * The voice assistant's listener, as plain TypeScript with every outside thing passed in (`Recognizer`, `Clock`): no React Native, no
 * WebView. It turns the recognizer's events into what the website needs — `partial` (everything heard so far, chunks joined by
 * `addResult` / `heardText`), `level` (0..1, throttled for the animation) and `error` — and answers `stop()` with the final text.
 * Same shape as collector/core.ts so it is tested with fake events (core.test.ts). The speech test uses it too.
 *
 * Hard rules it keeps: a report with no words never erases earlier words (the 2026-11-28 empty-closing-report bug); `stop()` never
 * answers empty when words were heard (it waits for the recognizer's last result / end, at most STOP_WAIT_MS); a forgotten mic stops by
 * itself (20 s of quiet after speech, 60 s in all) and keeps what it heard for the next `stop()`; a new `start()` aborts the old session
 * and waits for its end before the new one begins, so a late event of the old one can't land in the new one.
 */
export const STOP_WAIT_MS = 1500;
export const SILENCE_STOP_MS = 20_000;
export const TOTAL_STOP_MS = 60_000;
export const LEVEL_EVERY_MS = 66;          // about 15 a second
export const START_WAIT_MS = 3000;
export const ABORT_WAIT_MS = 500;
export const FATAL_SETTLE_MS = 1000;
export const DEFAULT_LANG = 'en-US';

export type PermissionState = { granted: boolean; canAskAgain: boolean; status: 'granted' | 'denied' | 'undetermined' };
export type RecognizerEvents = {
  start: null;
  result: { isFinal: boolean; results: { transcript: string }[] };
  volumechange: { value: number };
  error: { error: string; message: string };
  end: null;
};
export type RecognizerStart = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  addsPunctuation: boolean;
  requiresOnDeviceRecognition: boolean;
  contextualStrings?: string[];
  volumeChangeEventOptions: { enabled: boolean; intervalMillis: number };
};
export interface Recognizer {
  start(options: RecognizerStart): void;
  stop(): void;
  abort(): void;
  on<K extends keyof RecognizerEvents>(event: K, handler: (e: RecognizerEvents[K]) => void): () => void;
  getPermissions(): Promise<PermissionState>;
  requestPermissions(): Promise<PermissionState>;
  supportsOnDevice(): boolean;
  isAvailable(): boolean;
}
export interface Clock {
  now(): number;
  /** Runs `fn` once after `ms`; returns a function that cancels it. */
  after(fn: () => void, ms: number): () => void;
}

export type SpeechEvents = {
  partial: { text: string };
  level: { level: number };
  error: { code: string; message: string };
};
export type StartOptions = { hints: string[]; lang?: string; /** Prefer on-device recognition when the phone supports it (default true). */ onDevice?: boolean };

/** Hints for the recognizer: trimmed, no empties, no repeats (any case), at most HINTS_MAX. */
export function cleanHints(hints: unknown): string[] {
  if (!Array.isArray(hints)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hints) {
    if (typeof h !== 'string') continue;
    const t = h.replace(/\s+/g, ' ').trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= HINTS_MAX) break;
  }
  return out;
}

/** The recognizer's volume (-2..10, below 0 is inaudible) as 0..1. */
export const levelFor = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value / 10)) : 0);

const permissionName = (p: PermissionState): SpeechAvailability['permission'] => (p.granted ? 'granted' : p.status === 'denied' || !p.canAskAgain ? 'denied' : 'undetermined');

type Session = {
  heard: HeardState;
  lastSent: string;
  off: (() => void)[];
  timers: { silence?: () => void; total?: () => void };
  lastLevelAt: number;
  errored: boolean;
  /** Being thrown away (abort / replaced): still folds words in for a waiting stop(), but tells nobody. */
  discarded: boolean;
  /** stop was asked for (by the caller or by a timer) and its answer is on the way. */
  stopping: Promise<string> | null;
  /** Nothing more will arrive: `text` is final and `stop()` answers it at once. */
  finished: boolean;
  onEnd: (() => void)[];
};

export class SpeechController {
  private readonly rec: Recognizer;
  private readonly clock: Clock;
  private session: Session | null = null;
  private gen = 0;
  private readonly listeners: { [K in keyof SpeechEvents]: Set<(d: SpeechEvents[K]) => void> } = { partial: new Set(), level: new Set(), error: new Set() };

  constructor(rec: Recognizer, clock: Clock) { this.rec = rec; this.clock = clock; }

  on<K extends keyof SpeechEvents>(event: K, fn: (d: SpeechEvents[K]) => void): () => void {
    const set = this.listeners[event] as Set<(d: SpeechEvents[K]) => void>;
    set.add(fn);
    return () => { set.delete(fn); };
  }

  private emit<K extends keyof SpeechEvents>(event: K, data: SpeechEvents[K]) {
    for (const fn of [...(this.listeners[event] as Set<(d: SpeechEvents[K]) => void>)]) { try { fn(data); } catch { /* a listener's slip must not stop the others */ } }
  }

  /** What is known without asking the person anything (the permission is only read, never requested). */
  async available(): Promise<SpeechAvailability> {
    let permission: SpeechAvailability['permission'] = 'undetermined';
    try { permission = permissionName(await this.rec.getPermissions()); } catch { /* unknown */ }
    let available = false; let onDevice = false;
    try { available = this.rec.isAvailable(); } catch { /* not available */ }
    try { onDevice = available && this.rec.supportsOnDevice(); } catch { /* unknown */ }
    return { available, onDevice, permission };
  }

  async requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
    const p = await this.rec.requestPermissions();
    return { granted: p.granted, canAskAgain: p.canAskAgain };
  }

  /** Resolves once listening has begun (the recognizer's `start`, or after START_WAIT_MS). Rejects with `code: 'not-allowed'` without permission. */
  async start(options: StartOptions): Promise<void> {
    const gen = ++this.gen;
    const old = this.session;
    if (old) { this.session = null; await this.settle(old); }
    if (gen !== this.gen) return;                       // a newer start() took over while the old session was ending

    let perm = await this.rec.getPermissions();
    if (!perm.granted && perm.canAskAgain) perm = await this.rec.requestPermissions();
    if (gen !== this.gen) return;
    if (!perm.granted) throw Object.assign(new Error('Microphone or speech recognition is off for this app.'), { code: 'not-allowed' });

    const s: Session = { heard: emptyHeard, lastSent: '', off: [], timers: {}, lastLevelAt: 0, errored: false, discarded: false, stopping: null, finished: false, onEnd: [] };
    this.session = s;
    let began!: () => void;
    const beganP = new Promise<void>((r) => { began = r; });
    const cancelBegan = this.clock.after(began, START_WAIT_MS);

    s.off.push(this.rec.on('start', () => began()));
    s.off.push(this.rec.on('result', (e) => this.onResult(s, e)));
    s.off.push(this.rec.on('volumechange', (e) => this.onVolume(s, e.value)));
    s.off.push(this.rec.on('error', (e) => this.onError(s, e.error, e.message)));
    s.off.push(this.rec.on('end', () => this.onEnd(s)));
    s.timers.total = this.clock.after(() => this.autoStop(s, 'The microphone was on for a minute, so it stopped.'), TOTAL_STOP_MS);

    const supported = (() => { try { return this.rec.supportsOnDevice(); } catch { return false; } })();
    const hints = cleanHints(options.hints);
    try {
      this.rec.start({
        lang: options.lang || DEFAULT_LANG,
        interimResults: true,
        continuous: true,
        addsPunctuation: false,
        requiresOnDeviceRecognition: supported && options.onDevice !== false,
        contextualStrings: hints.length ? hints : undefined,
        volumeChangeEventOptions: { enabled: true, intervalMillis: LEVEL_EVERY_MS }
      });
    } catch (e) {
      cancelBegan();
      this.finish(s);
      this.session = null;
      throw e;
    }
    await beganP;
    cancelBegan();
  }

  /** Everything heard, the recognizer's chunks joined. Waits for its last result / end (at most STOP_WAIT_MS). Never empty if words were heard. */
  async stop(): Promise<{ text: string }> {
    const s = this.session;
    if (!s) return { text: '' };
    if (s.finished) return { text: heardText(s.heard) };
    return { text: await this.beginStop(s) };
  }

  /** Stops at once and drops the session; a `stop()` still waiting is answered with what was heard. */
  async abort(): Promise<void> {
    this.gen++;
    const s = this.session;
    this.session = null;
    if (s) await this.settle(s);
  }

  // ─── inside ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private beginStop(s: Session): Promise<string> {
    if (s.stopping) return s.stopping;
    s.stopping = new Promise<string>((resolve) => {
      let cancelCap = () => {};
      const done = () => { cancelCap(); const i = s.onEnd.indexOf(done); if (i >= 0) s.onEnd.splice(i, 1); this.finish(s); resolve(heardText(s.heard)); };
      s.onEnd.push(done);
      cancelCap = this.clock.after(() => { try { this.rec.abort(); } catch { /* already stopped */ } done(); }, STOP_WAIT_MS);
    });
    try { this.rec.stop(); } catch { /* the cap will finish it */ }
    return s.stopping;
  }

  /** abort() the recognizer and wait (briefly) for it to say it ended, so its late events are over before anything new starts. */
  private settle(s: Session): Promise<void> {
    if (s.finished) return Promise.resolve();
    s.discarded = true;
    return new Promise<void>((resolve) => {
      let cancel = () => {};
      const done = () => { cancel(); this.finish(s); resolve(); };
      s.onEnd.push(done);
      cancel = this.clock.after(done, ABORT_WAIT_MS);
      try { this.rec.abort(); } catch { done(); }
    });
  }

  /** The recognizer has nothing more to say: drop its listeners and timers; the heard text stays for `stop()`. */
  private finish(s: Session) {
    if (s.finished) return;
    s.finished = true;
    for (const off of s.off) off();
    s.off = [];
    s.timers.silence?.(); s.timers.total?.();
    s.timers = {};
    const waiting = s.onEnd; s.onEnd = [];
    for (const fn of waiting) fn();
  }

  private autoStop(s: Session, message: string) {
    if (s.finished || s.stopping || s.discarded) return;
    this.emit('error', { code: 'auto-stopped', message });
    void this.beginStop(s);
  }

  private onResult(s: Session, e: RecognizerEvents['result']) {
    if (s.finished) return;
    const next = addResult(s.heard, e.results?.[0]?.transcript, e.isFinal);
    if (next === s.heard) return;                          // an empty report (the closing one has no words): keep what was heard
    s.heard = next;
    const text = heardText(next);
    if (text !== s.lastSent && !s.discarded) { s.lastSent = text; this.emit('partial', { text }); }
    if (!s.stopping) {
      s.timers.silence?.();
      s.timers.silence = this.clock.after(() => this.autoStop(s, 'No speech for a while, so the microphone stopped.'), SILENCE_STOP_MS);
    }
  }

  private onVolume(s: Session, value: number) {
    if (s.finished || s.stopping || s.discarded) return;
    const now = this.clock.now();
    if (now - s.lastLevelAt < LEVEL_EVERY_MS) return;
    s.lastLevelAt = now;
    this.emit('level', { level: levelFor(value) });
  }

  private onError(s: Session, code: string, message: string) {
    if (s.finished || s.discarded || code === 'aborted') return;
    if (s.stopping && code === 'no-speech') return;       // the ordinary ending of a stop with nothing said
    s.errored = true;
    this.emit('error', { code, message });
    if (code !== 'no-speech') {
      // Anything but "no speech" ends the session; the recognizer normally says `end` next, but if it never does, finish anyway.
      s.timers.silence?.(); s.timers.silence = this.clock.after(() => this.finish(s), FATAL_SETTLE_MS);
    }
  }

  private onEnd(s: Session) {
    if (s.finished) return;
    const wasAsked = !!s.stopping || s.onEnd.length > 0;
    const quiet = s.errored;
    if (wasAsked) { const waiting = [...s.onEnd]; for (const fn of waiting) fn(); this.finish(s); return; }
    // The recognizer stopped by itself (iOS ends a session after a while): keep the words for stop(), and tell the screen.
    this.finish(s);
    if (!quiet && !s.discarded) this.emit('error', { code: 'ended', message: 'Listening stopped.' });
  }
}
