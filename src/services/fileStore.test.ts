import { describe, expect, it, vi } from 'vitest';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createFileStore } from './fileStore';

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.7 …');
const S3_ENV = {
  FILE_STORE: 's3',
  FILES_BUCKET: 'easy-surfaces-dev-website-files-533848567248-us-east-2',
  FILES_CDN_URL: 'https://d1abc.cloudfront.net/',
  AWS_REGION: 'us-east-2',
};
const CLD_ENV = { CLOUDINARY_CLOUD_NAME: 'acct', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' };

const fakeS3 = () => {
  const sent: (PutObjectCommand | DeleteObjectCommand)[] = [];
  return { sent, client: { send: vi.fn(async (cmd: PutObjectCommand | DeleteObjectCommand) => (sent.push(cmd), {})) } };
};

const fakeCloudinary = () => {
  const uploads: Record<string, unknown>[] = [];
  const destroyed: [string, unknown][] = [];
  const cld = {
    config: vi.fn(),
    uploader: {
      upload_stream: vi.fn((opts: Record<string, unknown>, cb: (e: unknown, r: unknown) => void) => ({
        end: () => {
          uploads.push(opts);
          cb(null, { secure_url: `https://res.cloudinary.com/acct/image/upload/v1/${opts.public_id}.webp`, public_id: opts.public_id });
        },
      })),
      destroy: vi.fn(async (id: string, opts: unknown) => (destroyed.push([id, opts]), { result: 'ok' })),
    },
  };
  return { cld, uploads, destroyed };
};

describe('createFileStore', () => {
  it('is null when nothing is configured (callers keep their disk fallback)', () => {
    expect(createFileStore({})).toBeNull();
  });

  it('defaults to Cloudinary, uploading under folder/name as before', async () => {
    const { cld, uploads } = fakeCloudinary();
    const store = createFileStore(CLD_ENV, { cloudinary: cld as never })!;
    expect(store.backend).toBe('cloudinary');
    const out = await store.put(WEBP, { key: 'visits/img_1', kind: 'image' });
    expect(uploads[0]).toEqual({ public_id: 'visits/img_1', resource_type: 'image' });
    expect(out).toEqual({ url: 'https://res.cloudinary.com/acct/image/upload/v1/visits/img_1.webp', id: 'visits/img_1' });
  });

  it('asks Cloudinary to overwrite and invalidate fixed-name files', async () => {
    const { cld, uploads } = fakeCloudinary();
    await createFileStore(CLD_ENV, { cloudinary: cld as never })!.put(PDF, { key: 'deliveries/pod/D1/signed.pdf', kind: 'raw', overwrite: true });
    expect(uploads[0]).toMatchObject({ overwrite: true, invalidate: true, resource_type: 'raw' });
  });

  it('with FILE_STORE=s3, puts the file in the bucket and returns the CDN URL', async () => {
    const { client, sent } = fakeS3();
    const store = createFileStore(S3_ENV, { s3: client })!;
    expect(store.backend).toBe('s3');
    const out = await store.put(WEBP, { key: 'visits/img_1', kind: 'image' });
    const put = sent[0] as PutObjectCommand;
    expect(put.input).toMatchObject({
      Bucket: S3_ENV.FILES_BUCKET,
      Key: 'visits/img_1.webp',
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    expect(out).toEqual({ url: 'https://d1abc.cloudfront.net/visits/img_1.webp', id: 's3:visits/img_1.webp' });
  });

  it('keeps a PDF’s name and turns caching off for overwritten files', async () => {
    const { client, sent } = fakeS3();
    await createFileStore(S3_ENV, { s3: client })!.put(PDF, { key: 'deliveries/packing_lists/D1.pdf', kind: 'raw', overwrite: true });
    expect((sent[0] as PutObjectCommand).input).toMatchObject({ Key: 'deliveries/packing_lists/D1.pdf', ContentType: 'application/pdf', CacheControl: 'no-cache' });
  });

  it('stays on Cloudinary (loudly) when FILE_STORE=s3 is half configured', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cld } = fakeCloudinary();
    expect(createFileStore({ ...CLD_ENV, FILE_STORE: 's3' }, { cloudinary: cld as never })!.backend).toBe('cloudinary');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  describe('remove', () => {
    it('deletes CDN URLs and s3: ids from the bucket', async () => {
      const { client, sent } = fakeS3();
      const store = createFileStore(S3_ENV, { s3: client })!;
      expect(await store.remove('https://d1abc.cloudfront.net/products/main/a%20b.webp?download=x')).toBe(true);
      expect(await store.remove('s3:visits/img_1.webp')).toBe(true);
      expect(sent.map((c) => (c as DeleteObjectCommand).input.Key)).toEqual(['products/main/a b.webp', 'visits/img_1.webp']);
    });

    it('still deletes Cloudinary files (by URL or saved public_id) after the switch', async () => {
      const { client } = fakeS3();
      const { cld, destroyed } = fakeCloudinary();
      const store = createFileStore({ ...S3_ENV, ...CLD_ENV }, { s3: client, cloudinary: cld as never })!;
      await store.remove('https://res.cloudinary.com/acct/raw/upload/v9/deliveries/pod/D1/signed.pdf');
      await store.remove('deliveries/pod/D1/sig_customer', 'image');
      expect(destroyed).toEqual([
        ['deliveries/pod/D1/signed.pdf', { resource_type: 'raw', invalidate: true }],
        ['deliveries/pod/D1/sig_customer', { resource_type: 'image', invalidate: true }],
      ]);
    });

    it('ignores what isn’t ours and never throws', async () => {
      const failing = { send: vi.fn(async () => Promise.reject(new Error('AccessDenied'))) };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = createFileStore(S3_ENV, { s3: failing })!;
      expect(await store.remove('https://example.com/a.webp')).toBe(false);
      expect(await store.remove('')).toBe(false);
      expect(await store.remove('s3:a.webp')).toBe(false);
      warn.mockRestore();
    });
  });
});
