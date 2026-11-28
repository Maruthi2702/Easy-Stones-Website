import type { PluginImpl } from '../protocol';
import { requestSpeechTest } from '../../speechTest/openRequest';

/** The website's Admin → Voice Test button: opens the app's speech test screen. Only builds with this file answer it. */
export const SpeechTest: PluginImpl = {
  calls: { open: () => { requestSpeechTest(); return {}; } },
  callbacks: {},
  events: {}
};
