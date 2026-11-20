/**
 * Universal links for the iOS app (2026-11-19). The server publishes the
 * association file Apple reads (`/.well-known/apple-app-site-association`), the
 * app turns a tapped link into an in-app route — both from this one list, so
 * they can't disagree. A link outside the list opens in Safari as usual.
 */
export const IOS_TEAM_ID = 'F82RKW6P64';
export const IOS_BUNDLE_ID = 'app.easysurfaces';

/** Paths that open in the app. `/x/*` also matches `/x` itself. Never /api. */
export const APP_LINK_PATHS = ['/login', '/set-password', '/supplier/*', '/sales/*', '/checkin'] as const;

const matches = (pattern: string, path: string): boolean =>
  pattern.endsWith('/*') ? path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1)) : path === pattern;

/** What Apple fetches. `/x/*` in the file matches `/x/…` but not `/x`, so the bare path is listed too. */
export function appSiteAssociation() {
  const components = APP_LINK_PATHS.flatMap(p => (p.endsWith('/*') ? [{ '/': p.slice(0, -2) }, { '/': p }] : [{ '/': p }]));
  return { applinks: { details: [{ appIDs: [`${IOS_TEAM_ID}.${IOS_BUNDLE_ID}`], components }] } };
}

/** The in-app route (path + query + hash) for a tapped link, or null when it isn't ours to open. */
export function pathForLink(url: string, hosts: string[]): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !hosts.includes(u.host)) return null;
  return APP_LINK_PATHS.some(p => matches(p, u.pathname)) ? `${u.pathname}${u.search}${u.hash}` : null;
}
