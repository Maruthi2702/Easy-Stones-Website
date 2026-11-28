import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SpeechAvailability, SpeechPlugin } from '../../utils/assistantContract.ts';

/**
 * The website's side of the phone's `Speech` plugin (mobile/src/host/handlers/speech.ts; the contract is `SpeechPlugin` in
 * src/utils/assistantContract.ts). Screens use `speechAvailability()` to decide whether to show the mic at all and `listen()` to talk;
 * neither touches Capacitor. A browser and an older app build have no plugin, which shows up as "not available", never as an error.
 */
const NO_SPEECH: SpeechAvailability = { available: false, onDevice: false, permission: 'undetermined' };
const CALL_WAIT_MS = 4000;

let plugin: SpeechPlugin | null = null;
/** The plugin proxy. Calling it in a browser or an old build rejects; prefer `speechAvailability()` / `listen()`. */
export function getSpeech(): SpeechPlugin {
  return (plugin ??= registerPlugin<SpeechPlugin>('Speech'));
}

/** Whether the mic can be offered. Never throws: a browser, a web view with no native side, an old build, or a slow answer all say "not available". */
export async function speechAvailability(): Promise<SpeechAvailability> {
  try {
    if (!Capacitor.isNativePlatform()) return NO_SPEECH;
    const answer = await Promise.race([
      getSpeech().available(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), CALL_WAIT_MS))
    ]);
    if (!answer || typeof answer.available !== 'boolean') return NO_SPEECH;
    return { available: answer.available, onDevice: !!answer.onDevice, permission: answer.permission === 'granted' || answer.permission === 'denied' ? answer.permission : 'undetermined' };
  } catch {
    return NO_SPEECH;
  }
}

export interface Listening {
  /** Stops and resolves with everything heard (never empty if words were heard). Listeners are removed. */
  stop(): Promise<string>;
  /** Stops without an answer. Listeners are removed. */
  abort(): Promise<void>;
  /** Everything heard so far, whenever it changes. Each returns a function that stops listening to that event. */
  onPartial(fn: (text: string) => void): () => void;
  /** 0..1, about 15 times a second. */
  onLevel(fn: (level: number) => void): () => void;
  /** `code`: 'not-allowed', 'no-speech', 'network', 'auto-stopped' (20 s of quiet or 60 s in all; call `stop()` for the words), 'ended' (the phone ended it; same), …. */
  onError(fn: (code: string, message: string) => void): () => void;
}

/**
 * Starts listening (the permission prompt, if it hasn't been answered, appears here) and resolves once it has begun. Rejects when it can't:
 * the error's `code` is 'not-allowed' without permission. `hints` are the words the recognizer should expect.
 */
export async function listen(hints: string[], options: { lang?: string } = {}): Promise<Listening> {
  const speech = getSpeech();
  const partial = new Set<(t: string) => void>();
  const level = new Set<(l: number) => void>();
  const error = new Set<(c: string, m: string) => void>();
  const handles = await Promise.all([
    speech.addListener('partial', (d: { text?: string }) => { const t = String(d?.text ?? ''); for (const fn of [...partial]) fn(t); }),
    speech.addListener('level', (d: { level?: number }) => { const l = Number(d?.level) || 0; for (const fn of [...level]) fn(l); }),
    speech.addListener('error', (d: { code?: string; message?: string }) => { for (const fn of [...error]) fn(String(d?.code ?? 'error'), String(d?.message ?? '')); })
  ]);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.all(handles.map((h) => h.remove().catch(() => undefined)));
  };
  try {
    await speech.start({ hints, lang: options.lang });
  } catch (e) {
    await close();
    throw e;
  }
  const subscribe = <T>(set: Set<T>) => (fn: T) => { set.add(fn); return () => { set.delete(fn); }; };
  return {
    stop: async () => {
      try { return (await speech.stop()).text ?? ''; } finally { await close(); }
    },
    abort: async () => {
      try { await speech.abort(); } finally { await close(); }
    },
    onPartial: subscribe(partial),
    onLevel: subscribe(level),
    onError: subscribe(error)
  };
}
