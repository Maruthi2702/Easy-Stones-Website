import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { SpeechController, type PermissionState, type Recognizer } from './core';

/** The real recognizer (expo-speech-recognition) behind the `Recognizer` port, and the one controller the app shares. */
const toState = (p: { granted: boolean; canAskAgain: boolean; status: string; restricted?: boolean }): PermissionState => ({
  granted: p.granted,
  canAskAgain: p.canAskAgain && !p.restricted,
  status: p.restricted ? 'denied' : p.status === 'granted' ? 'granted' : p.status === 'denied' ? 'denied' : 'undetermined'
});

export const expoRecognizer: Recognizer = {
  start: (o) => ExpoSpeechRecognitionModule.start(o),
  stop: () => ExpoSpeechRecognitionModule.stop(),
  abort: () => ExpoSpeechRecognitionModule.abort(),
  on: (event, handler) => {
    const sub = ExpoSpeechRecognitionModule.addListener(event, handler as never) as unknown as { remove(): void };
    return () => sub.remove();
  },
  getPermissions: async () => toState(await ExpoSpeechRecognitionModule.getPermissionsAsync()),
  requestPermissions: async () => toState(await ExpoSpeechRecognitionModule.requestPermissionsAsync()),
  supportsOnDevice: () => ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
  isAvailable: () => ExpoSpeechRecognitionModule.isRecognitionAvailable()
};

let shared: SpeechController | null = null;
/** One controller for the whole app: the assistant (through the bridge) and the speech test share the one microphone. */
export function speechController(): SpeechController {
  return (shared ??= new SpeechController(expoRecognizer, { now: () => Date.now(), after: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } }));
}
