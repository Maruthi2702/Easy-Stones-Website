import { describe, expect, it } from 'vitest';
import {
  cacheControlFor,
  cdnUrlFor,
  encodeKeyPath,
  extensionOf,
  findCloudinaryUrls,
  keyFromCdnUrl,
  parseCloudinaryUrl,
  s3KeyForCloudinary,
  sniffContentType,
  storageKey,
} from './fileStoreRules';
import { isCloudinaryUrl, isFilesCdnUrl, isHostedFileUrl } from './fileUrls';

const bytes = (...b: (number | string)[]) =>
  Buffer.concat(b.map((x) => (typeof x === 'string' ? Buffer.from(x, 'latin1') : Buffer.from([x]))));

describe('sniffContentType', () => {
  it.each([
    ['PDF', bytes('%PDF-1.7'), 'application/pdf', '.pdf'],
    ['PNG', bytes(0x89, 'PNG\r\n'), 'image/png', '.png'],
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg', '.jpg'],
    ['WebP', bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '), 'image/webp', '.webp'],
    ['GIF', bytes('GIF89a'), 'image/gif', '.gif'],
    ['HEIC', bytes(0, 0, 0, 24, 'ftypheic'), 'image/heic', '.heic'],
    ['MP4', bytes(0, 0, 0, 24, 'ftypisom'), 'video/mp4', '.mp4'],
    ['MOV', bytes(0, 0, 0, 20, 'ftypqt  '), 'video/quicktime', '.mov'],
    ['SVG', bytes('<?xml version="1.0"?><svg xmlns="…">'), 'image/svg+xml', '.svg'],
  ])('%s', (_name, buffer, contentType, ext) => {
    expect(sniffContentType(buffer)).toEqual({ contentType, ext });
  });

  it('falls back to octet-stream with no extension', () => {
    expect(sniffContentType(bytes('hello'))).toEqual({ contentType: 'application/octet-stream', ext: '' });
  });
});

describe('storage keys and CDN URLs', () => {
  it('adds the file’s extension unless the key already ends in a known one', () => {
    const webp = { contentType: 'image/webp', ext: '.webp' };
    expect(storageKey('visits/img_1', webp)).toBe('visits/img_1.webp');
    expect(storageKey('deliveries/pod/D1/signed.pdf', { contentType: 'application/pdf', ext: '.pdf' })).toBe('deliveries/pod/D1/signed.pdf');
    expect(storageKey('/a//b', webp)).toBe('a/b.webp');
    // "client_res_1-2_0" has no extension even though it has dots-free segments
    expect(storageKey('Resources/client_res_1-2_0', webp)).toBe('Resources/client_res_1-2_0.webp');
  });

  it('builds and reads back CDN URLs, encoding each segment', () => {
    const base = 'https://d1.cloudfront.net/';
    const key = 'products/main/Calacatta Lincoln #1.webp';
    const url = cdnUrlFor(base, key);
    expect(url).toBe('https://d1.cloudfront.net/products/main/Calacatta%20Lincoln%20%231.webp');
    expect(keyFromCdnUrl(url, base)).toBe(key);
    expect(keyFromCdnUrl(`${url}?download=x.pdf`, base)).toBe(key);
    expect(keyFromCdnUrl('https://other.cloudfront.net/a.png', base)).toBeNull();
    expect(encodeKeyPath('a b/c')).toBe('a%20b/c');
  });

  it('extensionOf looks only at the last segment', () => {
    expect(extensionOf('a.b/c')).toBe('');
    expect(extensionOf('a/b.PDF')).toBe('.pdf');
  });

  it('caches unique files for a year and overwritten ones not at all', () => {
    expect(cacheControlFor(false)).toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor(true)).toBe('no-cache');
  });
});

describe('Cloudinary URLs', () => {
  it('parses an image URL with a version', () => {
    expect(parseCloudinaryUrl('https://res.cloudinary.com/dqf4k0dn2/image/upload/v1768437320/products/main/Nero_Marquina.jpg')).toEqual({
      cloudName: 'dqf4k0dn2',
      resourceType: 'image',
      transformation: '',
      path: 'products/main/Nero_Marquina.jpg',
      publicId: 'products/main/Nero_Marquina',
    });
  });

  it('keeps the extension in a raw file’s public_id', () => {
    const a = parseCloudinaryUrl('https://res.cloudinary.com/dqf4k0dn2/raw/upload/v1792000000/deliveries/pod/D_1/signed.pdf')!;
    expect(a.publicId).toBe('deliveries/pod/D_1/signed.pdf');
    expect(s3KeyForCloudinary(a)).toBe('deliveries/pod/D_1/signed.pdf');
  });

  it('separates transformations and gives transformed copies their own key', () => {
    const a = parseCloudinaryUrl(
      'https://res.cloudinary.com/dqf4k0dn2/image/upload/f_auto,q_auto,w_1100,c_fill,g_center/v1768458938/products/Nero_Marquina.jpg',
    )!;
    expect(a.transformation).toBe('f_auto,q_auto,w_1100,c_fill,g_center');
    expect(a.path).toBe('products/Nero_Marquina.jpg');
    expect(s3KeyForCloudinary(a)).toBe('cloudinary-derived/f_auto,q_auto,w_1100,c_fill,g_center/products/Nero_Marquina.jpg');
  });

  it('decodes encoded names and handles URLs without a version', () => {
    expect(parseCloudinaryUrl('https://res.cloudinary.com/x/image/upload/visits/my%20photo.webp')!.path).toBe('visits/my photo.webp');
    expect(parseCloudinaryUrl('https://res.cloudinary.com/x/image/upload/w_100/visits/a.webp')!.transformation).toBe('w_100');
  });

  it('refuses what isn’t a Cloudinary delivery URL', () => {
    expect(parseCloudinaryUrl('https://example.com/a.jpg')).toBeNull();
    expect(parseCloudinaryUrl('https://res.cloudinary.com/x/image/upload/')).toBeNull();
  });

  it('finds this account’s URLs inside JSON, HTML and CSS, once each', () => {
    const text = JSON.stringify({
      a: 'https://res.cloudinary.com/acct/image/upload/v1/a.jpg',
      b: ['<img src="https://res.cloudinary.com/acct/image/upload/v1/a.jpg">', "url('https://res.cloudinary.com/acct/raw/upload/v2/p.pdf')"],
      other: 'https://res.cloudinary.com/someone-else/image/upload/v1/x.jpg',
    });
    expect(findCloudinaryUrls(text, 'acct').sort()).toEqual([
      'https://res.cloudinary.com/acct/image/upload/v1/a.jpg',
      'https://res.cloudinary.com/acct/raw/upload/v2/p.pdf',
    ]);
  });
});

describe('which URLs are ours (fileUrls.ts)', () => {
  const base = ['https://d1abc.cloudfront.net'];
  it('recognises Cloudinary and this CDN', () => {
    expect(isCloudinaryUrl('https://res.cloudinary.com/x/image/upload/v1/a.jpg')).toBe(true);
    expect(isFilesCdnUrl('https://d1abc.cloudfront.net/visits/a.webp', base)).toBe(true);
    expect(isFilesCdnUrl('https://d1abc.cloudfront.net.evil.com/a.webp', base)).toBe(false);
    expect(isFilesCdnUrl('https://d2other.cloudfront.net/a.webp', base)).toBe(false);
  });
  it('the screens accept any CloudFront file when they don’t know the base', () => {
    expect(isHostedFileUrl('https://d2other.cloudfront.net/a.webp', [])).toBe(true);
    expect(isHostedFileUrl('https://example.com/a.webp', [])).toBe(false);
    expect(isHostedFileUrl('/uploads/a.webp', [])).toBe(false);
  });
});
