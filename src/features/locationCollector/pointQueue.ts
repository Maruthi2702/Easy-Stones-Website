import type { RawPoint } from '../../utils/locationTracking';

/**
 * Points not yet sent, kept on the phone (localStorage) so a dead spot or a
 * closed app loses nothing. Keyed by person: a shared phone never sends one
 * person's trail under another's login.
 */
const KEY = 'es.locationQueue.v1';

export function loadQueue(userId: string): RawPoint[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as { userId?: string; points?: RawPoint[] } | null;
    return raw?.userId === userId && Array.isArray(raw.points) ? raw.points : [];
  } catch { return []; }
}
export function saveQueue(userId: string, points: RawPoint[]): void {
  try { localStorage.setItem(KEY, JSON.stringify({ userId, points })); } catch { /* storage full or blocked: the points stay in memory */ }
}
export function clearQueue(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/**
 * Two copies of the unsent points exist (localStorage, and a file written by the native plugin); after a restart they are
 * joined, each point once by its id, oldest first. Neither alone is trusted: iOS can clear the web storage, and the file is
 * only there on newer app builds.
 */
export function mergeQueues(...lists: RawPoint[][]): RawPoint[] {
  const byId = new Map<string, RawPoint>();
  for (const list of lists) for (const p of list) if (typeof p?.id === 'string' && !byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
