import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { answerOpenRequests } from './answerRequests';
import { loadOpenRequests, sendRequestAnswer } from './collectorApi';
import { currentPosition } from './backgroundLocation';

/** How often an open ask is looked for while the app is in front. */
export const ASK_CHECK_MS = 60 * 1000;
/** How long "Location sent to …" shows. */
export const SENT_NOTICE_MS = 8 * 1000;

/**
 * Answers an admin's "Locate now" ask (src/utils/locationRequests.ts) when this phone's app is
 * in front: at start, when it comes back to the front, when the ask's push arrives and every
 * minute. Needs a tracked person who agreed to the wording (`enabled`). Returns a notice to show
 * for a few seconds after a position was sent, so the person always sees that it happened.
 */
export default function useLocateRequests(enabled: boolean): string {
  const [notice, setNotice] = useState('');
  const done = useRef(new Set<string>());
  const running = useRef(false);

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const names = await answerOpenRequests({ load: loadOpenRequests, position: currentPosition, send: sendRequestAnswer, done: done.current });
      if (names.length) setNotice(`Location sent to ${names.join(', ')}`);
    } finally { running.current = false; }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    void check();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, ASK_CHECK_MS);
    const resume = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) void check(); });
    const push = PushNotifications.addListener('pushNotificationReceived', () => { void check(); });
    return () => { clearInterval(timer); void resume.then((h) => h.remove()); void push.then((h) => h.remove()); };
  }, [enabled, check]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), SENT_NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  return notice;
}
