/**
 * Utility functions for text formatting
 */

/**
 * Capitalizes the first letter of each word in a string (Title Case).
 * Preserves spaces so live typing is seamless.
 * Example: "marini mai" -> "Marini Mai"
 */
export const formatTitleCase = (str) => {
  if (typeof str !== 'string' || !str) return '';
  return str
    .split(' ')
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : '')
    .join(' ');
};
