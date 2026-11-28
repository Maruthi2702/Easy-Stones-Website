/**
 * The website's Admin → Voice Test page asks the app to open the speech test (bridge plugin `SpeechTest.open`). The plugin and the
 * screen live in different places, so this tiny hand-off connects them: App.tsx listens, the plugin asks.
 */
const listeners = new Set<() => void>();

export const onOpenSpeechTest = (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const requestSpeechTest = (): void => { for (const fn of [...listeners]) fn(); };
