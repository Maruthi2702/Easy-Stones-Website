// In-Memory Data Cache Module for Instant 0ms Tab Navigation & Silent WebSocket Sync

// Keys are the fixed ones below plus per-page keys ("checkIns:<filters>"…).
const cacheStore: Record<string, unknown> & { lastUpdated: Record<string, number> } = {
  customers: null,
  customerStats: null,
  customerTotalPages: 1,
  customerTotalCount: 0,
  checkIns: null,
  checkInStats: null,
  checkInTotalPages: 1,
  checkInTotalCount: 0,
  lastUpdated: {}
};

/**
 * Retrieve cached data by key
 * @param {string} key 
 * @returns {any}
 */
export const getCachedData = <T = unknown>(key: string): T | null => {
  return cacheStore[key] !== undefined ? (cacheStore[key] as T) : null;
};

/**
 * Store data in memory cache
 * @param {string} key 
 * @param {any} value 
 */
export const setCachedData = (key: string, value: unknown): void => {
  cacheStore[key] = value;
  cacheStore.lastUpdated[key] = Date.now();
};

/**
 * Check if cached data exists and is fresher than maxAgeMs
 * @param {string} key 
 * @param {number} maxAgeMs - Default 2 minutes (120,000ms)
 * @returns {boolean}
 */
export const isCacheValid = (key: string, maxAgeMs = 120000): boolean => {
  if (cacheStore[key] === null || cacheStore[key] === undefined) return false;
  const last = cacheStore.lastUpdated[key] || 0;
  return (Date.now() - last) < maxAgeMs;
};

/**
 * Invalidate a specific cache key
 * @param {string} key 
 */
export const clearCacheKey = (key: string): void => {
  cacheStore[key] = null;
  delete cacheStore.lastUpdated[key];
};

/**
 * Invalidate all cache store entries
 */
export const clearAllCache = (): void => {
  Object.keys(cacheStore).forEach(k => {
    if (k === 'lastUpdated') cacheStore[k] = {};
    else cacheStore[k] = null;
  });
};

// Marks every entry whose key starts with `prefix` as out of date: it still
// paints instantly, but the next read refetches instead of trusting it for
// two minutes. For live updates — a new check-in makes every cached page of
// the log stale, not just the one on screen.
export const expireCacheKeys = (prefix: string): void => {
  Object.keys(cacheStore.lastUpdated).forEach(k => {
    if (k.startsWith(prefix)) cacheStore.lastUpdated[k] = 0;
  });
};
