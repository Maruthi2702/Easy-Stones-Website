import { API_URL } from '../config/api';
import { io } from 'socket.io-client';

/**
 * The sales planner's data layer.
 *
 * Two things were wrong with fetching straight from the component. The planner
 * is unmounted whenever the dashboard switches to another tab, so coming back
 * threw away everything it had and repainted skeletons over a week the user had
 * already been looking at. And once it was on screen it never learned anything
 * new — a stop added from a phone, a second browser, or a Google Calendar sync
 * stayed invisible until a manual reload.
 *
 * So the schedule lives here instead, outside React: cached per fetched range,
 * kept current by the same `schedule_update` broadcast the server sends on every
 * write. Mounting reads the cache synchronously — the week is on screen in the
 * first frame — and revalidates behind it. Nothing waits on a spinner for data
 * it already has.
 */

const cache = {
  ranges: new Map(),   // 'start|end' -> schedule items, newest known copy
  inflight: new Map(), // 'start|end' -> in-flight fetch, so N callers make 1 request
  activeKey: null,     // the range on screen — the only one worth revalidating
  activeRange: null,
  listeners: new Set(),
  socket: null,
  userId: null,
  lastRevalidate: 0,
  revalidateTimer: null
};

const rangeKey = (start, end) => `${start}|${end}`;

/** Same contents means the same array, so React can skip the re-render. */
const sameItems = (a, b) => a && b && JSON.stringify(a) === JSON.stringify(b);

/**
 * A schedule belongs to one user, but the broadcast reaches everyone connected.
 * Filter it down to ours — falling back to "assume it's relevant" while the
 * current user is still unknown, since a wasted refetch is cheaper than a stop
 * that never appears.
 */
const isForCurrentUser = (payload) =>
  !payload?.userId || !cache.userId || String(payload.userId) === cache.userId;

export function setPlannerUser(userId) {
  cache.userId = userId ? String(userId) : null;
}

/** What we can paint right now, before any network call. */
export function getCachedPlannerRange(start, end) {
  return cache.ranges.get(rangeKey(start, end)) || null;
}

function notify(key) {
  const items = cache.ranges.get(key) || [];
  cache.listeners.forEach(cb => {
    try {
      cb(key, items);
    } catch (err) {
      console.warn('[planner] listener error:', err);
    }
  });
}

async function fetchRange(start, end) {
  const res = await fetch(
    `${API_URL}/api/schedule?start=${start}T00:00:00.000&end=${end}T23:59:59.999`,
    { credentials: 'include' }
  );
  if (!res.ok) throw new Error('Could not load the schedule.');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch a range and store it. Concurrent callers for the same range share one
 * request — the mount effect and a socket event landing together should not
 * make the same call twice.
 */
function loadRange(start, end) {
  const key = rangeKey(start, end);
  const existing = cache.inflight.get(key);
  if (existing) return existing;

  const request = fetchRange(start, end)
    .then(items => {
      const previous = cache.ranges.get(key);
      if (sameItems(previous, items)) return previous;
      cache.ranges.set(key, items);
      notify(key);
      return items;
    })
    .finally(() => {
      cache.inflight.delete(key);
    });

  cache.inflight.set(key, request);
  return request;
}

/**
 * Load the range the planner is showing. Returns fresh items; callers that
 * already painted from the cache can ignore the result and let the subscription
 * deliver the difference.
 */
export function loadPlannerRange(start, end) {
  cache.activeKey = rangeKey(start, end);
  cache.activeRange = { start, end };
  cache.lastRevalidate = Date.now();
  return loadRange(start, end);
}

/**
 * Change one item everywhere it is cached and tell the listeners at once.
 *
 * This exists for the drag-to-reschedule move, which has to look immediate:
 * waiting on the round trip would leave the card sitting on its old day under a
 * cursor that has already let go of it. Writing through the cache rather than
 * into component state means the move also survives the unmount when another
 * tab is opened, and that the refetch which follows the write comes back
 * matching what is already on screen — so `sameItems` skips the re-render
 * instead of repainting the week.
 *
 * Returns the undo, for when the write turns out to have failed.
 */
export function patchPlannerItem(id, patch) {
  const fields = Object.keys(patch);
  let restore = null;

  for (const [key, items] of cache.ranges) {
    let changed = false;
    const next = items.map(item => {
      if (String(item._id) !== String(id)) return item;
      changed = true;
      // Captured from the first range that has it — the same item in a second
      // cached range is the same item, so one copy of the old values is enough.
      if (!restore) restore = Object.fromEntries(fields.map(f => [f, item[f]]));
      return { ...item, ...patch };
    });
    if (!changed) continue;
    cache.ranges.set(key, next);
    notify(key);
  }

  // Nothing was cached under this id, so nothing moved and there is nothing to
  // put back. The caller still gets an undo it can call unconditionally.
  if (!restore) return () => {};
  return () => patchPlannerItem(id, restore);
}

/**
 * Re-check the visible range. Silent by design: failures leave the cached week
 * on screen rather than replacing it with an error, because this fires on
 * timers and window focus, where the user did not ask for anything.
 */
function revalidateActive({ force = false } = {}) {
  if (!cache.activeRange) return;
  // Nobody is watching, or the tab is in the background — the next mount or the
  // next visibilitychange will catch up.
  if (!force && (cache.listeners.size === 0 || document.hidden)) return;

  cache.lastRevalidate = Date.now();
  loadRange(cache.activeRange.start, cache.activeRange.end).catch(() => {});
}

/**
 * Bursts are normal — a calendar sync can rewrite a dozen items in a second,
 * and each one arrives as its own broadcast. Coalesce them into one refetch.
 */
function scheduleRevalidate(delay = 250) {
  if (cache.revalidateTimer) return;
  cache.revalidateTimer = setTimeout(() => {
    cache.revalidateTimer = null;
    revalidateActive({ force: true });
  }, delay);
}

/** Focus and visibility are the safety net for whatever the socket missed. */
const REFOCUS_MIN_GAP = 2000;

function onRefocus() {
  if (document.hidden) return;
  if (Date.now() - cache.lastRevalidate < REFOCUS_MIN_GAP) return;
  revalidateActive();
}

// Polling only covers the window where the socket is down; the socket carries
// updates the rest of the time. It is stopped as soon as one connects.
let pollIntervalId = null;

function startPolling() {
  if (pollIntervalId) return;
  pollIntervalId = setInterval(() => revalidateActive(), 20000);
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

function initSocket() {
  if (cache.socket) return;
  try {
    cache.socket = io(API_URL || window.location.origin, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    // Assume disconnected until proven otherwise, so a socket that never
    // connects at all still leaves the planner updating.
    startPolling();

    cache.socket.on('connect', () => {
      stopPolling();
      // Anything written while we were offline is invisible to us; catch up.
      revalidateActive({ force: true });
    });

    cache.socket.on('disconnect', startPolling);

    cache.socket.on('schedule_update', (payload) => {
      if (!isForCurrentUser(payload)) return;
      scheduleRevalidate();
    });

    window.addEventListener('focus', onRefocus);
    document.addEventListener('visibilitychange', onRefocus);
  } catch (err) {
    console.warn('[planner] socket init error:', err);
    startPolling();
  }
}

/**
 * Subscribe to updates for any cached range. The callback receives the range
 * key so a subscriber showing one week can ignore changes to another.
 */
export function subscribePlannerSchedule(callback) {
  initSocket();
  cache.listeners.add(callback);
  return () => {
    cache.listeners.delete(callback);
  };
}

/** After our own write — the response is already committed, so ask again now. */
export function refreshPlannerSchedule() {
  revalidateActive({ force: true });
}

export { rangeKey as plannerRangeKey };
