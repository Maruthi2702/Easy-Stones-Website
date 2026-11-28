import { useEffect, useState } from 'react';
import type { SpeechDriver } from './speechDriver';

/**
 * Does this device have a speech recognizer the assistant can use? False in a browser and in an app build from before the
 * Speech plugin (the call fails — treated as "no"), so the assistant's button simply never shows there.
 */
export function useSpeechAvailable(speech: SpeechDriver, enabled: boolean): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!enabled) { setAvailable(false); return undefined; }
    let live = true;
    speech.availability().then((a) => { if (live) setAvailable(Boolean(a?.available)); }).catch(() => { if (live) setAvailable(false); });
    return () => { live = false; };
  }, [speech, enabled]);
  return available;
}
