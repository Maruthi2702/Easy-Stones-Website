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
