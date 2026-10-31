import { io, type Socket } from 'socket.io-client';
import { API_URL } from '../config/api';
import { getAuthToken, onAuthTokenChange } from './authToken';

/**
 * Tells the server this tab is open and in use, for Users & Roles' Online
 * badges (server side: src/services/presence.ts). One socket per tab, started
 * by <PresenceReporter/> while someone is signed in.
 *
 * The tab says who it is (its token) on every connect and whenever the
 * session changes, and "active" at most once a minute while the mouse,
 * keyboard or touch is being used in a visible tab. A tab left alone, or in
 * the background, stops reporting and the server marks it Idle.
 *
 * People who can open Users & Roles are also pushed the live list
 * (`presence_update`); subscribePresence hands it to a screen.
 */

export const ACTIVE_REPORT_EVERY_MS = 60 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'mousemove'];

let socket: Socket | null = null;
let stopAuthListener: (() => void) | null = null;
let lastReportedAt = 0;
// The newest list pushed by the server, or null. Its rows are
// src/services/presence.ts's; src/utils/userPresence.js reads them.
export type PresenceList = unknown;
type PresenceSubscriber = (list: PresenceList) => void;
let latest: PresenceList | null = null;
const subscribers = new Set<PresenceSubscriber>();

const hello = () => {
  if (!socket) return;
  const token = getAuthToken();
  if (!token) return;
  lastReportedAt = Date.now();
  socket.emit('presence_hello', { token });
};

const reportActive = () => {
  if (!socket?.connected || document.visibilityState === 'hidden') return;
  const now = Date.now();
  if (now - lastReportedAt < ACTIVE_REPORT_EVERY_MS) return;
  lastReportedAt = now;
  socket.emit('presence_active');
};

export function startPresence(): void {
  if (socket) return;
  socket = io(API_URL || window.location.origin, {
    transports: ['websocket', 'polling'],
    withCredentials: true
  });
  socket.on('connect', hello);
  socket.on('presence_update', (list: PresenceList) => {
    latest = list;
    subscribers.forEach((cb) => cb(list));
  });
  stopAuthListener = onAuthTokenChange(hello);
  ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reportActive, { passive: true }));
  document.addEventListener('visibilitychange', reportActive);
}

export function stopPresence(): void {
  if (!socket) return;
  ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reportActive));
  document.removeEventListener('visibilitychange', reportActive);
  stopAuthListener?.();
  stopAuthListener = null;
  socket.disconnect();
  socket = null;
  latest = null;
}

/** Called with the live list each time the server pushes one. Returns an unsubscribe function. */
export function subscribePresence(callback: PresenceSubscriber): () => void {
  subscribers.add(callback);
  if (latest) callback(latest);
  return () => { subscribers.delete(callback); };
}
