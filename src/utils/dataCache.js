// In-Memory Data Cache Module for Instant 0ms Tab Navigation & Silent WebSocket Sync

const cacheStore = {
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
export const getCachedData = (key) => {
  return cacheStore[key] !== undefined ? cacheStore[key] : null;
};

/**
 * Store data in memory cache
 * @param {string} key 
 * @param {any} value 
 */
export const setCachedData = (key, value) => {
  cacheStore[key] = value;
  cacheStore.lastUpdated[key] = Date.now();
};

/**
 * Check if cached data exists and is fresher than maxAgeMs
 * @param {string} key 
 * @param {number} maxAgeMs - Default 2 minutes (120,000ms)
 * @returns {boolean}
 */
export const isCacheValid = (key, maxAgeMs = 120000) => {
  if (cacheStore[key] === null || cacheStore[key] === undefined) return false;
  const last = cacheStore.lastUpdated[key] || 0;
  return (Date.now() - last) < maxAgeMs;
};

/**
 * Invalidate a specific cache key
 * @param {string} key 
 */
export const clearCacheKey = (key) => {
  cacheStore[key] = null;
  delete cacheStore.lastUpdated[key];
};

/**
 * Invalidate all cache store entries
 */
export const clearAllCache = () => {
  Object.keys(cacheStore).forEach(k => {
    if (k === 'lastUpdated') cacheStore[k] = {};
    else cacheStore[k] = null;
  });
};
