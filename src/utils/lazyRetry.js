import { lazy } from 'react';

/**
 * React.lazy(), plus retries via a full page reload.
 *
 * A stale service worker or a deploy that shipped a new chunk hash between
 * page load and click can turn an ordinary lazy import into a permanent
 * "Failed to fetch dynamically imported module" (Safari: "'text/html' is not
 * a valid JavaScript MIME type" when the server answered with the app page) —
 * the browser remembers the failed module for the life of the page, so only a
 * reload helps. A reload picks up the current build's chunk map.
 *
 * Up to MAX_RELOADS reloads in a row, spaced out, so the page rides out a
 * deploy switchover (Render runs the old and new builds side by side for a
 * minute or two); after that it's a real failure and the error screen shows.
 * The count lives in sessionStorage and resets after QUIET_MS, so one bad
 * moment never leaves the tab unprotected later. (Until 2026-10-07 this was a
 * localStorage flag cleared only when that same import later succeeded — after
 * one hiccup it could stay set for days, and the next deploy went straight to
 * "Something went wrong".)
 *
 * Was App.jsx-only (one definition per page route); src/pages/SalesPage.jsx
 * needs the exact same behavior for its own tabs, so this is the one place
 * both import it from rather than each keeping its own copy.
 */
const KEY = 'lazy-chunk-reloads';
const MAX_RELOADS = 3;
const QUIET_MS = 2 * 60 * 1000;

const readState = () => {
  try {
    const s = JSON.parse(window.sessionStorage.getItem(KEY) || 'null');
    return s && Date.now() - s.at < QUIET_MS ? s : { at: 0, count: 0 };
  } catch {
    return { at: 0, count: 0 };
  }
};

export const lazyRetry = (componentImport) => lazy(async () => {
  try {
    return await componentImport();
  } catch (error) {
    const { count } = readState();
    if (count < MAX_RELOADS) {
      try { window.sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), count: count + 1 })); } catch { /* private mode */ }
      // 0s, then 3s, then 6s — later tries give the new build time to take over.
      setTimeout(() => window.location.reload(), count * 3000);
      // Keep Suspense on its loading state until the reload takes over,
      // instead of flashing the error screen first.
      return new Promise(() => {});
    }
    throw error;
  }
});
