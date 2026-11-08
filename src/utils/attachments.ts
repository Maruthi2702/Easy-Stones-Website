/**
 * Whether a visit/resource attachment is a PDF rather than an image.
 *
 * An attachment is either an inline data URL (how the browser holds a freshly
 * picked file, and how PDFs used to be stored) or a hosted URL. Visit screens
 * only recognised the first, so a hosted PDF would have rendered as a broken
 * <img>. A hosted PDF is recognised by its path ending in .pdf — PDFs are
 * stored as files named *.pdf for exactly this (processBase64Image in server.ts).
 */
export const isPdfSource = (src: unknown): boolean => {
  if (typeof src !== 'string' || !src) return false;
  if (src.startsWith('data:')) return src.startsWith('data:application/pdf');
  return /\.pdf$/i.test(src.split(/[?#]/)[0]);
};
