import { useCallback, useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { answerOpenRequests } from './answerRequests';
import { loadOpenRequests, sendRequestAnswer } from './collectorApi';
import { currentPosition } from './backgroundLocation';

/** How often an open ask is looked for while the app is in front. */
export const ASK_CHECK_MS = 60 * 1000;

/**
 * Answers an admin's "Locate now" ask (src/utils/locationRequests.ts) when this phone's app is
 * in front: at start, when it comes back to the front, and every minute. Needs a tracked person
 * who agreed to the wording (`enabled`). The person is NOT notified (owner's call, 2026-11-22;
 * consent wording v3 says so) — it is answered silently and nothing is shown on screen.
 */
export default function useLocateRequests(enabled: boolean): void {
  const done = useRef(new Set<string>());
  const running = useRef(false);

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      await answerOpenRequests({ load: loadOpenRequests, position: currentPosition, send: sendRequestAnswer, done: done.current });
    } finally { running.current = false; }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    void check();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, ASK_CHECK_MS);
    const resume = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) void check(); });
    return () => { clearInterval(timer); void resume.then((h) => h.remove()); };
  }, [enabled, check]);
}
