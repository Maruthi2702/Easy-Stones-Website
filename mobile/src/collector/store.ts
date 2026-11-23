import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RawPoint } from '../../../src/utils/locationTracking';

/**
 * What the collector keeps on the phone, in AsyncStorage (on disk, outlives the app being killed):
 * which person it collects for (and that they want it on), and that person's unsent points. Keyed by person: a shared phone never
 * sends one person's trail under another's login.
 */
const ENABLED_KEY = 'easysurfaces.collector.enabled';
const QUEUE_KEY = 'easysurfaces.collector.queue';

export async function loadEnabled(): Promise<string | null> {
  try { return (JSON.parse((await AsyncStorage.getItem(ENABLED_KEY)) || 'null') as { userId?: string } | null)?.userId || null; } catch { return null; }
}
export async function saveEnabled(userId: string | null): Promise<void> {
  try { if (userId) await AsyncStorage.setItem(ENABLED_KEY, JSON.stringify({ userId })); else await AsyncStorage.removeItem(ENABLED_KEY); } catch { /* storage unavailable */ }
}

export async function loadQueue(userId: string): Promise<RawPoint[]> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || 'null') as { userId?: string; points?: RawPoint[] } | null;
    return raw?.userId === userId && Array.isArray(raw.points) ? raw.points : [];
  } catch { return []; }
}
export async function saveQueue(userId: string, points: RawPoint[]): Promise<void> {
  try { if (points.length) await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify({ userId, points })); else await AsyncStorage.removeItem(QUEUE_KEY); } catch { /* the points stay in memory */ }
}
