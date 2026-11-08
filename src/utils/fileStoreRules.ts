/**
 * Pure rules behind src/services/fileStore.ts and scripts/migrate-cloudinary-to-s3.ts:
 * what a file is, the S3 key it gets, and how a Cloudinary URL maps onto S3.
 * Tested in fileStoreRules.test.ts.
 */

export interface SniffedType {
  contentType: string;
  /** With the dot, e.g. ".webp"; "" when unknown. */
  ext: string;
}

const startsWith = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** The type of a file from its first bytes (what the app stores: images, PDFs, videos). */
export function sniffContentType(buffer: Uint8Array): SniffedType {
  const b = buffer;
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46])) return { contentType: 'application/pdf', ext: '.pdf' }; // %PDF
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return { contentType: 'image/png', ext: '.png' };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', ext: '.jpg' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { contentType: 'image/webp', ext: '.webp' };
  if (ascii(b, 0, 4) === 'GIF8') return { contentType: 'image/gif', ext: '.gif' };
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (brand === 'avif' || brand === 'avis') return { contentType: 'image/avif', ext: '.avif' };
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return { contentType: 'image/heic', ext: '.heic' };
    if (brand === 'qt  ') return { contentType: 'video/quicktime', ext: '.mov' };
    return { contentType: 'video/mp4', ext: '.mp4' };
  }
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return { contentType: 'video/webm', ext: '.webm' };
  const head = ascii(b, 0, Math.min(b.length, 256)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return { contentType: 'image/svg+xml', ext: '.svg' };
  return { contentType: 'application/octet-stream', ext: '' };
}

const EXT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

/** The extension of a key's last segment (".pdf"), lowercased; "" when it has none. */
export const extensionOf = (key: string) => {
  const last = key.split('/').pop() || '';
  const m = /(\.[A-Za-z0-9]{2,5})$/.exec(last);
  return m ? m[1].toLowerCase() : '';
};

export const contentTypeForExtension = (ext: string) => EXT_TYPES[ext.toLowerCase()];

/**
 * The S3 key a file is stored under: the app's key (folder/name), plus the file's own
 * extension when the key doesn't end in a known one — so URLs end in .pdf / .webp and
 * isPdfSource (src/utils/attachments.ts) keeps recognising PDFs.
 */
export function storageKey(key: string, sniffed: SniffedType): string {
  const clean = key.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  return contentTypeForExtension(extensionOf(clean)) ? clean : `${clean}${sniffed.ext}`;
}

/** encodeURIComponent per segment, keeping the slashes. */
export const encodeKeyPath = (key: string) => key.split('/').map(encodeURIComponent).join('/');

export const cdnUrlFor = (base: string, key: string) => `${base.replace(/\/+$/, '')}/${encodeKeyPath(key)}`;

/** The S3 key of a CDN URL on `base`, or null when it isn't one. */
export function keyFromCdnUrl(url: string, base: string): string | null {
  const prefix = `${base.replace(/\/+$/, '')}/`;
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length).split(/[?#]/)[0];
  try {
    return path.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

/** Long-lived caching for unique names; overwritten-in-place files must be re-checked. */
export const cacheControlFor = (overwrite: boolean) => (overwrite ? 'no-cache' : 'public, max-age=31536000, immutable');

// ── Cloudinary URLs ─────────────────────────────────────────────────────────

export interface CloudinaryAsset {
  cloudName: string;
  resourceType: 'image' | 'raw' | 'video';
  /** "f_auto,q_auto,w_1100" etc., joined with "/" when several; "" when none. */
  transformation: string;
  /** The stored path after the version: folder/name.ext (decoded). */
  path: string;
  /** Cloudinary's public_id: the path without its extension (raw files keep theirs). */
  publicId: string;
}

const TRANSFORMATION = /^(?:[a-z]{1,3}_[^/]*|fl_[^/]*)$/;

/** Parse https://res.cloudinary.com/<cloud>/<type>/upload/[<transformations>/][v123/]<path>. */
export function parseCloudinaryUrl(url: string): CloudinaryAsset | null {
  const m = /^https?:\/\/res\.cloudinary\.com\/([^/]+)\/(image|raw|video)\/upload\/(.+)$/.exec(url.split(/[?#]/)[0]);
  if (!m) return null;
  const [, cloudName, resourceType, rest] = m;
  const segments = rest.split('/').filter(Boolean);
  const versionAt = segments.findIndex((s) => /^v\d+$/.test(s));
  let transforms: string[];
  let pathSegments: string[];
  if (versionAt >= 0) {
    transforms = segments.slice(0, versionAt);
    pathSegments = segments.slice(versionAt + 1);
  } else {
    let i = 0;
    while (i < segments.length - 1 && TRANSFORMATION.test(segments[i]) && (segments[i].includes(',') || segments[i].includes('_'))) i++;
    transforms = segments.slice(0, i);
    pathSegments = segments.slice(i);
  }
  if (pathSegments.length === 0) return null;
  let path: string;
  try {
    path = pathSegments.map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  const publicId = resourceType === 'raw' ? path : path.replace(/\.[^/.]+$/, '');
  return { cloudName, resourceType: resourceType as CloudinaryAsset['resourceType'], transformation: transforms.join('/'), path, publicId };
}

/**
 * Where a Cloudinary file goes in S3: the same folder/name it had, so a migrated URL
 * reads like the original. A transformed copy (e.g. the login page's resized slab)
 * is its own file, under cloudinary-derived/<transformation>/….
 */
export function s3KeyForCloudinary(asset: CloudinaryAsset): string {
  if (!asset.transformation) return asset.path;
  const t = asset.transformation.replace(/[^A-Za-z0-9,_-]+/g, '_');
  return `cloudinary-derived/${t}/${asset.path}`;
}

/** Every Cloudinary URL of one account in a piece of text (JSON, HTML, a plain field). */
export function findCloudinaryUrls(text: string, cloudName: string): string[] {
  const re = new RegExp(`https?://res\\.cloudinary\\.com/${cloudName.replace(/[^A-Za-z0-9_-]/g, '')}/(?:image|raw|video)/upload/[^\\s"'<>()\\\\]+`, 'g');
  return [...new Set(text.match(re) ?? [])];
}
