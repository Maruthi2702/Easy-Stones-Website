/**
 * Users & Roles' Online column: turns the server's live list (see
 * src/services/presence.js) and a user's saved `lastSeenAt` / `lastLoginAt`
 * into the badge a row shows.
 *
 *   active   — a tab is open and in use
 *   idle     — a tab is open, nobody has touched it for ~10 minutes
 *   offline  — no tab open; "Last seen 2 h ago"
 *   never    — has never signed in
 */

export const DEVICE_LABELS: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', desktop: 'Computer' };

/** One live entry from the server (src/services/presence.js). */
export type PresenceRow = { userId: string; status: 'active' | 'idle'; device?: string; tabs: number; lastActiveAt?: string | number };
export type OnlineStatus = { kind: 'active' | 'idle' | 'offline' | 'never'; label: string; detail: string; device: string | null | undefined };
type SeenUser = { _id: unknown; lastSeenAt?: string; lastLoginAt?: string };

/** { userId → live row } from the server's list. */
export const presenceById = (list: unknown): Map<string, PresenceRow> => {
  const map = new Map<string, PresenceRow>();
  for (const row of (Array.isArray(list) ? list : []) as PresenceRow[]) map.set(String(row.userId), row);
  return map;
};

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else the date. */
export const agoLabel = (when: string | number | Date | undefined, now = Date.now()): string => {
  const t = new Date(when as string).getTime();
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(t).toLocaleDateString();
};

export const onlineStatusOf = (user: SeenUser, live: Map<string, PresenceRow> | null | undefined, now = Date.now()): OnlineStatus => {
  const row = live?.get(String(user._id));
  if (row) {
    const device = DEVICE_LABELS[row.device || ''] || '';
    const tabs = row.tabs > 1 ? ` · ${row.tabs} tabs` : '';
    return row.status === 'active'
      ? { kind: 'active', label: 'Online', detail: `Active now${device ? ` · ${device}` : ''}${tabs}`, device: row.device }
      : { kind: 'idle', label: 'Idle', detail: `Idle — last used ${agoLabel(row.lastActiveAt, now)}${device ? ` · ${device}` : ''}${tabs}`, device: row.device };
  }
  const seen = user.lastSeenAt || user.lastLoginAt;
  if (!seen) return { kind: 'never', label: 'Never signed in', detail: 'Has not signed in yet', device: null };
  const ago = agoLabel(seen, now);
  return { kind: 'offline', label: `Last seen ${ago}`, detail: `Last seen ${new Date(seen).toLocaleString()}`, device: null };
};

/** How many of these users have a tab open (active or idle). */
export const countOnline = (users: SeenUser[], live: Map<string, PresenceRow> | null | undefined): number => users.filter((u) => live?.has(String(u._id))).length;
