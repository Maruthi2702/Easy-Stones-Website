import type { SpeechAvailability } from '../../utils/assistantContract';
import { getSpeech, listen, speechAvailability } from './speechPlugin';

/**
 * What the assistant needs from the phone's speech recognizer, in one small interface so the hook can be tested with a fake.
 * The real one is the app's `Speech` bridge plugin (src/features/voiceAssistant/speechPlugin.ts, built with the app in mobile/).
 * In a browser, or an app build from before the plugin, `availability()` says not available and the button never shows.
 */
export interface ListeningHandle {
  /** Stops and resolves with everything heard (the recognizer's chunks joined). */
  stop(): Promise<{ text: string }>;
  abort(): Promise<void>;
  /** Each returns an unsubscribe. */
  onPartial(cb: (text: string) => void): () => void;
  onLevel(cb: (level: number) => void): () => void;
  onError(cb: (e: { code: string; message: string }) => void): () => void;
}

export interface SpeechDriver {
  availability(): Promise<SpeechAvailability>;
  requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  listen(options: { hints: string[]; lang?: string }): Promise<ListeningHandle>;
}

const OFF: SpeechAvailability = { available: false, onDevice: false, permission: 'undetermined' };

export const defaultSpeech: SpeechDriver = {
  async availability() {
    try { return await speechAvailability(); } catch { return OFF; }
  },
  async requestPermission() {
    try { return (await getSpeech()?.requestPermission()) ?? { granted: false, canAskAgain: false }; } catch { return { granted: false, canAskAgain: false }; }
  },
  async listen(options) {
    // speechPlugin.listen(hints, { lang }) resolves a handle whose stop() gives the words as a string; the assistant wants { text }.
    const handle = await listen(options.hints, { lang: options.lang });
    return {
      stop: async () => ({ text: await handle.stop() }),
      abort: () => handle.abort(),
      onPartial: handle.onPartial,
      onLevel: handle.onLevel,
      onError: (cb) => handle.onError((code, message) => cb({ code, message }))
    };
  }
};
