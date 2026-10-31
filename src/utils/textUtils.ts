/**
 * Utility functions for text formatting
 */

/**
 * Capitalizes the first letter of each word in a string (Title Case).
 * Preserves spaces so live typing is seamless.
 * Example: "marini mai" -> "Marini Mai"
 */
export const formatTitleCase = (str: unknown): string => {
  if (typeof str !== 'string' || !str) return '';
  return str
    .split(' ')
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : '')
    .join(' ');
};

/**
 * Turns a login username into something presentable, for accounts that have not
 * set a Display Name. Usernames are stored lower-case because they are
 * identifiers, so they read badly on screen.
 * Example: "3rd party - delivery" -> "3rd Party Delivery"
 *
 * The one copy: server.ts uses it too (via displayNameOf in salesReps.js),
 * so a name typed on screen and the server's `name` always agree.
 */
export const prettifyUsername = (username: unknown = ''): string =>
  String(username)
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
