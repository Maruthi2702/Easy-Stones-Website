import { isSpinning } from './assistantMachine';
import AssistantSheet from './AssistantSheet';
import { defaultSpeech } from './speechDriver';
import type { SpeechDriver } from './speechDriver';
import { useAssistant } from './useAssistant';
import type { AssistantHost } from './useAssistant';
import { useSpeechAvailable } from './useSpeechAvailable';
import VoiceAssistantButton from './VoiceAssistantButton';
import type { VoicePlacement } from './VoiceAssistantButton';

export type VoiceAssistantProps = {
  /** The page says yes: the login holds Voice assistant and can add visits, and this is a page that shows the button. */
  enabled: boolean;
  placement: VoicePlacement;
  host: AssistantHost;
  /** For tests; the app's Speech plugin otherwise. */
  speech?: SpeechDriver;
};

function Assistant({ placement, host, speech }: { placement: VoicePlacement; host: AssistantHost; speech: SpeechDriver }) {
  const a = useAssistant(host, speech);
  return (
    <>
      <VoiceAssistantButton placement={placement} spinning={isSpinning(a.state)} hidden={a.state.phase !== 'idle'} onClick={() => void a.open()} />
      <AssistantSheet a={a} />
    </>
  );
}

/**
 * Log a visit by talking (plan: docs/VOICE_ASSISTANT_PLAN.md). Renders nothing — not even the hooks that load customers and
 * visit types — unless the person holds the switch AND this device has a speech recognizer (the iPhone app with the Speech
 * plugin), so a browser and an old app build look exactly as they did before.
 */
export default function VoiceAssistant({ enabled, placement, host, speech = defaultSpeech }: VoiceAssistantProps) {
  const available = useSpeechAvailable(speech, enabled);
  if (!enabled || !available) return null;
  return <Assistant placement={placement} host={host} speech={speech} />;
}
