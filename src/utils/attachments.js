/**
 * Whether a visit/resource attachment is a PDF rather than an image.
 *
 * An attachment is either an inline data URL (how the browser holds a freshly
 * picked file, and how PDFs used to be stored) or a hosted URL. Visit screens
 * only recognised the first, so a PDF stored on Cloudinary would have rendered
 * as a broken <img>. A hosted PDF is recognised by its path ending in .pdf —
 * PDFs are uploaded as Cloudinary raw files named *.pdf for exactly this
 * (processBase64Image in server.js, scripts/migrate-inline-images.js).
 */
export const isPdfSource = (src) => {
  if (typeof src !== 'string' || !src) return false;
  if (src.startsWith('data:')) return src.startsWith('data:application/pdf');
  return /\.pdf$/i.test(src.split(/[?#]/)[0]);
};
