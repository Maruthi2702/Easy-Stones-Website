/**
 * Where uploaded files go: Cloudinary (as before) or S3 behind CloudFront, chosen by
 * FILE_STORE. Every upload and delete in the app goes through here, so switching is a
 * Render setting, not a code change, and old Cloudinary URLs keep working (and can still
 * be deleted) after new uploads go to S3.
 *
 *   FILE_STORE=cloudinary (default)   CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET
 *   FILE_STORE=s3                     FILES_BUCKET, FILES_CDN_URL, AWS_REGION,
 *                                     AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *
 * Neither configured (local dev without .env) → getFileStore() is null and callers keep
 * their disk / inline fallbacks. The bucket and CDN are the aws-infra repo's files stack.
 */
import { v2 as cloudinary } from 'cloudinary';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  cacheControlFor,
  cdnUrlFor,
  keyFromCdnUrl,
  parseCloudinaryUrl,
  sniffContentType,
  storageKey,
} from '../utils/fileStoreRules.ts';

export type FileKind = 'image' | 'raw' | 'auto';

export interface PutOptions {
  /** folder/name, e.g. "visits/img_123"; the file's extension is added when missing. */
  key: string;
  /** Cloudinary's resource type; S3 ignores it. */
  kind?: FileKind;
  /** Replace a file kept at a fixed name (delivery packing lists, signatures, signed PDFs). */
  overwrite?: boolean;
}

export interface StoredFile {
  url: string;
  /** What to keep to delete it later: Cloudinary's public_id, or "s3:<key>". */
  id: string;
}

export interface FileStore {
  readonly backend: 'cloudinary' | 's3';
  put(buffer: Buffer, options: PutOptions): Promise<StoredFile>;
  /**
   * Delete by URL (Cloudinary or this CDN), "s3:<key>", or a bare Cloudinary public_id.
   * Never throws: returns false when nothing was deleted (unknown, not configured, or failed).
   */
  remove(idOrUrl: string | null | undefined, kind?: Exclude<FileKind, 'auto'>): Promise<boolean>;
}

type Env = Record<string, string | undefined>;

const cloudinaryConfigured = (env: Env) => Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
const s3Configured = (env: Env) => Boolean(env.FILES_BUCKET && env.FILES_CDN_URL);

export interface FileStoreDeps {
  s3?: Pick<S3Client, 'send'>;
  cloudinary?: typeof cloudinary;
}

export function createFileStore(env: Env = process.env, deps: FileStoreDeps = {}): FileStore | null {
  const hasCloudinary = cloudinaryConfigured(env);
  const wantsS3 = (env.FILE_STORE || '').toLowerCase() === 's3';
  const cld = deps.cloudinary ?? cloudinary;
  if (hasCloudinary) {
    cld.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
  }

  if (wantsS3 && !s3Configured(env)) {
    console.error('❌ FILE_STORE=s3 but FILES_BUCKET / FILES_CDN_URL are not set — uploads stay on Cloudinary.');
  }
  const useS3 = wantsS3 && s3Configured(env);
  if (!useS3 && !hasCloudinary) return null;

  const bucket = env.FILES_BUCKET || '';
  const cdnBase = (env.FILES_CDN_URL || '').replace(/\/+$/, '');
  let s3: Pick<S3Client, 'send'> | undefined = deps.s3;
  const s3Client = () => (s3 ??= new S3Client({ region: env.AWS_REGION || 'us-east-2' }));

  const removeS3 = async (key: string) => {
    if (!bucket) return false;
    try {
      await s3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (err) {
      console.warn(`[files] could not delete s3:${key}:`, (err as Error).message);
      return false;
    }
  };

  const removeCloudinary = async (publicId: string, kind: 'image' | 'raw' | 'video') => {
    if (!hasCloudinary) return false;
    try {
      const result = await cld.uploader.destroy(publicId, { resource_type: kind, invalidate: true });
      return result?.result === 'ok';
    } catch (err) {
      console.warn(`[files] could not delete Cloudinary ${publicId}:`, (err as Error).message);
      return false;
    }
  };

  return {
    backend: useS3 ? 's3' : 'cloudinary',

    async put(buffer, { key, kind = 'auto', overwrite = false }) {
      if (useS3) {
        const sniffed = sniffContentType(buffer);
        const finalKey = storageKey(key, sniffed);
        await s3Client().send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: finalKey,
            Body: buffer,
            ContentType: sniffed.contentType,
            CacheControl: cacheControlFor(overwrite),
          }),
        );
        return { url: cdnUrlFor(cdnBase, finalKey), id: `s3:${finalKey}` };
      }
      const result = await new Promise<import('cloudinary').UploadApiResponse>((resolve, reject) => {
        cld.uploader
          .upload_stream({ public_id: key, resource_type: kind, ...(overwrite ? { overwrite: true, invalidate: true } : {}) }, (error, res) =>
            error ? reject(error) : resolve(res!),
          )
          .end(buffer);
      });
      return { url: result.secure_url, id: result.public_id };
    },

    async remove(idOrUrl, kind = 'image') {
      if (!idOrUrl) return false;
      if (idOrUrl.startsWith('s3:')) return removeS3(idOrUrl.slice(3));
      if (/^https?:\/\//.test(idOrUrl)) {
        const key = cdnBase ? keyFromCdnUrl(idOrUrl, cdnBase) : null;
        if (key) return removeS3(key);
        const asset = parseCloudinaryUrl(idOrUrl);
        if (asset && !asset.transformation) return removeCloudinary(asset.publicId, asset.resourceType);
        return false;
      }
      return removeCloudinary(idOrUrl, kind); // a public_id saved before the move
    },
  };
}

let shared: FileStore | null | undefined;

/** The app's store, built from process.env on first use (after dotenv has loaded). */
export function getFileStore(): FileStore | null {
  if (shared === undefined) shared = createFileStore();
  return shared;
}

/** Tests only: rebuild from the current environment next time. */
export function resetFileStore(): void {
  shared = undefined;
}
