import { onAuthTokenChange } from './authToken';

/**
 * Inventory Analysis answers, remembered for the session. The tab is unmounted
 * whenever someone switches to another CRM tab, and used to fetch everything
 * again — behind a loading screen — every time they came back. Inventory only
 * changes when someone imports an SPS export, and the server announces that
 * ('inventory_analysis_update', heard in SalesPage.jsx), so an answer is good
 * until then:
 *   - clearInventoryCache() runs on every import, ours or anyone else's;
 *   - a sign-out or a different person signing in clears it too, since what
 *     an answer contains (cost figures) depends on who asked;
 *   - INVENTORY_CACHE_TTL is the backstop for an announcement that never came.
 * Keyed by the full request URL, so each filter/page/view combination is its
 * own entry.
 */
const INVENTORY_CACHE_TTL = 10 * 60 * 1000;
const INVENTORY_CACHE_MAX = 200;
const store = new Map(); // url → { data, at }

export function peekInventory(url) {
  const entry = store.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= INVENTORY_CACHE_TTL) {
    store.delete(url);
    return undefined;
  }
  return entry.data;
}

export function rememberInventory(url, data) {
  store.delete(url); // re-insert, so the oldest entries are dropped first
  store.set(url, { data, at: Date.now() });
  while (store.size > INVENTORY_CACHE_MAX) store.delete(store.keys().next().value);
}

export function clearInventoryCache() {
  store.clear();
}

onAuthTokenChange(() => clearInventoryCache());
