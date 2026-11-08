/**
 * Where the app's stored files live, as URLs — shared by the server and the screens.
 *
 * Files used to be on Cloudinary (res.cloudinary.com). Since the move to AWS
 * (2026-11, `FILE_STORE=s3`) new ones are in S3, served through CloudFront at
 * FILES_CDN_URL (server) / VITE_FILES_CDN_URL (screens). Both kinds keep working:
 * old records point at Cloudinary until scripts/migrate-cloudinary-to-s3.ts rewrites them.
 */

/** The CloudFront base(s) this deployment serves files from, without a trailing slash. */
export function filesCdnBases(): string[] {
  const server = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FILES_CDN_URL;
  const browser = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_FILES_CDN_URL;
  return [server, browser].filter((b): b is string => Boolean(b)).map((b) => b.replace(/\/+$/, ''));
}

export const isCloudinaryUrl = (url: unknown): url is string => typeof url === 'string' && /^https?:\/\/res\.cloudinary\.com\//.test(url);

/** A file on this deployment's CDN (exact base when configured). */
export const isFilesCdnUrl = (url: unknown, bases: string[] = filesCdnBases()): url is string =>
  typeof url === 'string' && bases.some((base) => url.startsWith(`${base}/`));

/**
 * A file the app stored (Cloudinary, or S3 behind CloudFront). The screens may not
 * know the exact CDN base, so any *.cloudfront.net file counts there; anything that
 * decides what the server trusts uses isFilesCdnUrl with the configured base instead.
 */
export const isHostedFileUrl = (url: unknown, bases: string[] = filesCdnBases()): url is string =>
  isCloudinaryUrl(url) || isFilesCdnUrl(url, bases) || (typeof url === 'string' && /^https:\/\/[a-z0-9]+\.cloudfront\.net\//.test(url));

/** The query parameter the CDN turns into Content-Disposition: attachment (see aws-infra files stack). */
export const DOWNLOAD_PARAM = 'download';
