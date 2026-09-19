import { lazy } from 'react';

/**
 * React.lazy(), plus one retry via a full page reload.
 *
 * A stale service worker or a deploy that shipped a new chunk hash between
 * page load and click can turn an ordinary lazy import into a permanent
 * "Failed to fetch dynamically imported module" — the browser has no reason
 * to look again on its own. One automatic reload picks up the current
 * build's chunk map; the localStorage flag stops that from looping forever
 * if the failure is real rather than stale-cache, so a genuinely broken
 * chunk still surfaces as an error instead of reloading in place forever.
 *
 * Was App.jsx-only (one definition per page route); src/pages/SalesPage.jsx
 * needs the exact same behavior for its own tabs, so this is the one place
 * both import it from rather than each keeping its own copy.
 */
export const lazyRetry = (componentImport) => lazy(async () => {
  const pageHasAlreadyBeenForceRefreshed = JSON.parse(
    window.localStorage.getItem('page-has-been-force-refreshed') || 'false'
  );

  try {
    const component = await componentImport();
    window.localStorage.setItem('page-has-been-force-refreshed', 'false');
    return component;
  } catch (error) {
    if (!pageHasAlreadyBeenForceRefreshed) {
      window.localStorage.setItem('page-has-been-force-refreshed', 'true');
      return window.location.reload();
    }
    throw error;
  }
});
