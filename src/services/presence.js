/**
 * Who is signed in and using the app right now (Users & Roles → Online).
 *
 * Kept in the server's memory, one entry per open tab (a socket), because
 * "online" is only true while a tab is open. A person with three tabs is one
 * person. Their status is **active** when any tab has seen the mouse,
 * keyboard or touch in the last IDLE_AFTER_MS, else **idle**. The tab reports
 * activity itself (src/api/presence.js); the device comes from the browser's
 * own User-Agent header, never from anything the page claims.
 *
 * Single server only: with two instances each would hold half the list. If
 * that ever changes, this needs a shared store.
 */

export const IDLE_AFTER_MS = 10 * 60 * 1000;
// How often a person's `lastSeenAt` is written to the database while they
// are online — a disconnect always writes it.
export const SAVE_EVERY_MS = 5 * 60 * 1000;

/** 'phone', 'tablet' or 'desktop' from a User-Agent string. */
export const deviceFromUserAgent = (ua) => {
  const s = String(ua || '');
  if (/iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) return 'tablet';
  if (/iPhone|iPod|Android|Mobile|Windows Phone|BlackBerry/i.test(s)) return 'phone';
  return 'desktop';
};

export const createPresence = ({ idleAfterMs = IDLE_AFTER_MS, saveEveryMs = SAVE_EVERY_MS } = {}) => {
  const tabs = new Map();      // socket id → { userId, device, lastActiveAt }
  const lastSaved = new Map(); // userId → when lastSeenAt was last written

  const connect = (socketId, userId, device, now = Date.now()) => {
    tabs.set(socketId, { userId: String(userId), device: device || 'desktop', lastActiveAt: now });
  };

  const activity = (socketId, now = Date.now()) => {
    const tab = tabs.get(socketId);
    if (tab) tab.lastActiveAt = now;
    return !!tab;
  };

  /** Removes the tab. Returns { userId, lastActiveAt, offline } or null if unknown. */
  const disconnect = (socketId) => {
    const tab = tabs.get(socketId);
    if (!tab) return null;
    tabs.delete(socketId);
    const offline = ![...tabs.values()].some((t) => t.userId === tab.userId);
    if (offline) lastSaved.delete(tab.userId);
    return { userId: tab.userId, lastActiveAt: tab.lastActiveAt, offline };
  };

  /** True when this person's `lastSeenAt` is due to be written (and counts it as written). */
  const dueToSave = (userId, now = Date.now()) => {
    const key = String(userId);
    const last = lastSaved.get(key);
    if (last !== undefined && now - last < saveEveryMs) return false;
    lastSaved.set(key, now);
    return true;
  };

  /** One row per person online, most recently active first. */
  const snapshot = (now = Date.now()) => {
    const byUser = new Map();
    for (const tab of tabs.values()) {
      const row = byUser.get(tab.userId) || { userId: tab.userId, tabs: 0, lastActiveAt: 0, device: tab.device };
      row.tabs += 1;
      if (tab.lastActiveAt >= row.lastActiveAt) {
        row.lastActiveAt = tab.lastActiveAt;
        row.device = tab.device; // the device they used most recently
      }
      byUser.set(tab.userId, row);
    }
    return [...byUser.values()]
      .map((row) => ({ ...row, status: now - row.lastActiveAt < idleAfterMs ? 'active' : 'idle' }))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  };

  return { connect, activity, disconnect, dueToSave, snapshot };
};
