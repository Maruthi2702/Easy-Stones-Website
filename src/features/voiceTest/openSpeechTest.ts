import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Admin → Voice Test: asks the iPhone app to open its speech test screen (the app's bridge plugin `SpeechTest`, mobile/src/host).
 * The test uses the phone's own speech recognizer, so it exists only inside the app: a browser has nothing to open, and an app build
 * from before the test was added doesn't answer the plugin.
 */
export type OpenResult = 'opened' | 'not-in-app' | 'old-app';

const SpeechTest = registerPlugin<{ open: () => Promise<void> }>('SpeechTest');

export async function openSpeechTest(inApp: boolean = Capacitor.isNativePlatform()): Promise<OpenResult> {
  if (!inApp) return 'not-in-app';
  try { await SpeechTest.open(); return 'opened'; } catch { return 'old-app'; }
}

export const OPEN_MESSAGE: Record<Exclude<OpenResult, 'opened'>, string> = {
  'not-in-app': 'The speech test works only inside the Easy Surfaces app on an iPhone. Open this page there.',
  'old-app': 'This version of the app doesn’t have the speech test yet. Install the newest build and try again.'
};
