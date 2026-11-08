/**
 * The Cloudinary → S3 migration against an in-memory MongoDB, with a fake copier
 * (no network, no AWS).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { BACKUP_COLLECTION, copyFiles, rewriteUrls, rewriteValue, scanForCloudinary, undoRun, type FileCopier } from './cloudinaryToS3';

const CLOUD = 'acct';
const CDN = 'https://d1abc.cloudfront.net';
const u = (path: string, type = 'image') => `https://res.cloudinary.com/${CLOUD}/${type}/upload/${path}`;

let mongo: MongoMemoryServer;
const db = () => mongoose.connection.db!;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const productId = new mongoose.Types.ObjectId();
const customerId = new mongoose.Types.ObjectId();
const deliveryId = new mongoose.Types.ObjectId();

beforeEach(async () => {
  for (const c of await db().listCollections().toArray()) await db().dropCollection(c.name);
  await db().collection('products').insertOne({
    _id: productId,
    name: 'Calacatta',
    image: u('v1/products/main/calacatta.webp'),
    installedImages: [u('v1/products/installed/kitchen_calacatta.png'), '/uploads/local.webp'],
    updatedAt: new Date('2026-11-01'),
  });
  await db().collection('customers').insertOne({
    _id: customerId,
    name: 'Acme',
    visits: [
      { _id: new mongoose.Types.ObjectId(), notes: 'hi', image: [u('v1/visits/img_1.webp'), u('v2/visits/missing.webp')] },
      { _id: new mongoose.Types.ObjectId(), html: `<img src="${u('v1/visits/img_1.webp')}">` },
    ],
    other: 'https://res.cloudinary.com/someone-else/image/upload/v1/x.jpg',
  });
  await db().collection('deliveries').insertOne({
    _id: deliveryId,
    packingListUrl: u('v3/deliveries/packing_lists/D1.pdf', 'raw'),
    packingListPublicId: 'deliveries/packing_lists/D1.pdf',
  });
  await db().collection('untouched').insertOne({ name: 'nothing here' });
});

/** Copies everything except "missing.webp" (as if Cloudinary answered 404). */
const fakeCopier = (inS3: string[] = []): FileCopier & { copiedKeys: string[] } => {
  const copiedKeys: string[] = [];
  return {
    copiedKeys,
    exists: async (key) => inS3.includes(key),
    copy: async (url, key) => {
      if (url.includes('missing')) throw new Error('Cloudinary answered 404');
      copiedKeys.push(key);
      return { bytes: 100 };
    },
  };
};

describe('scanForCloudinary', () => {
  it('finds this account’s URLs in every collection and field, nested or inside HTML', async () => {
    const scan = await scanForCloudinary(db(), { cloudName: CLOUD });
    expect(Object.keys(scan.byCollection).sort()).toEqual(['customers', 'deliveries', 'products']);
    expect(scan.byCollection.products.fields).toEqual({ image: 1, installedImages: 1 });
    expect(scan.byCollection.customers.fields).toEqual({ visits: 1 }); // "other" is another account
    expect(scan.byCollection.deliveries.fields).toEqual({ packingListUrl: 1 });
    expect(scan.urls.get(u('v1/visits/img_1.webp'))).toBe('visits/img_1.webp');
    expect(scan.urls.get(u('v3/deliveries/packing_lists/D1.pdf', 'raw'))).toBe('deliveries/packing_lists/D1.pdf');
    expect(scan.urls.size).toBe(5);
  });

  it('can be limited to some collections', async () => {
    const scan = await scanForCloudinary(db(), { cloudName: CLOUD, collections: ['deliveries'] });
    expect(scan.hits).toHaveLength(1);
  });
});

describe('copyFiles', () => {
  it('copies each file once, skips ones already in S3, and reports failures', async () => {
    const scan = await scanForCloudinary(db(), { cloudName: CLOUD });
    const copier = fakeCopier(['products/main/calacatta.webp']);
    const result = await copyFiles(scan.urls, copier);
    expect(result.alreadyThere).toEqual(['products/main/calacatta.webp']);
    expect(result.copied.sort()).toEqual(['deliveries/packing_lists/D1.pdf', 'products/installed/kitchen_calacatta.png', 'visits/img_1.webp']);
    expect(result.failed.map((f) => f.key)).toEqual(['visits/missing.webp']);
  });

  it('shares one copy between URLs that differ only by version', async () => {
    const urls = new Map([
      [u('v1/deliveries/pod/D1/signed.pdf', 'raw'), 'deliveries/pod/D1/signed.pdf'],
      [u('v2/deliveries/pod/D1/signed.pdf', 'raw'), 'deliveries/pod/D1/signed.pdf'],
    ]);
    const copier = fakeCopier();
    await copyFiles(urls, copier);
    expect(copier.copiedKeys).toEqual(['deliveries/pod/D1/signed.pdf']);
  });
});

describe('rewriteValue', () => {
  it('rewrites strings in arrays and objects, leaving BSON values alone', () => {
    const id = new mongoose.Types.ObjectId();
    const when = new Date();
    const map = (url: string) => (url.endsWith('a.jpg') ? `${CDN}/a.jpg` : undefined);
    const { value, changed } = rewriteValue({ id, when, list: [u('v1/a.jpg'), u('v1/b.jpg')], html: `x ${u('v1/a.jpg')} y` }, map, CLOUD);
    expect(changed).toBe(2);
    expect(value).toEqual({ id, when, list: [`${CDN}/a.jpg`, u('v1/b.jpg')], html: `x ${CDN}/a.jpg y` });
    expect((value as { id: unknown }).id).toBe(id);
  });
});

describe('rewriteUrls + undoRun', () => {
  const run = async () => {
    const scan = await scanForCloudinary(db(), { cloudName: CLOUD });
    const copy = await copyFiles(scan.urls, fakeCopier());
    const copiedKeys = new Set([...copy.copied, ...copy.alreadyThere]);
    return { scan, rewrite: await rewriteUrls(db(), scan.hits, { cloudName: CLOUD, cdnBase: CDN, urls: scan.urls, copiedKeys, runId: 'run-1' }) };
  };

  it('points every copied URL at the CDN and leaves failed ones alone', async () => {
    const { rewrite } = await run();
    expect(rewrite).toMatchObject({ documents: 3, conflicts: [] });
    const product = await db().collection('products').findOne({ _id: productId });
    expect(product).toMatchObject({
      name: 'Calacatta',
      image: `${CDN}/products/main/calacatta.webp`,
      installedImages: [`${CDN}/products/installed/kitchen_calacatta.png`, '/uploads/local.webp'],
    });
    expect(product!.updatedAt).toEqual(new Date('2026-11-01')); // other fields untouched
    const customer = await db().collection('customers').findOne({ _id: customerId });
    expect(customer!.visits[0].image).toEqual([`${CDN}/visits/img_1.webp`, u('v2/visits/missing.webp')]);
    expect(customer!.visits[1].html).toBe(`<img src="${CDN}/visits/img_1.webp">`);
    expect(customer!.other).toContain('someone-else');
    const delivery = await db().collection('deliveries').findOne({ _id: deliveryId });
    expect(delivery).toMatchObject({ packingListUrl: `${CDN}/deliveries/packing_lists/D1.pdf`, packingListPublicId: 'deliveries/packing_lists/D1.pdf' });
  });

  it('backs up the old values and can put them back', async () => {
    await run();
    expect(await db().collection(BACKUP_COLLECTION).countDocuments({ runId: 'run-1' })).toBe(3);
    expect(await undoRun(db(), 'run-1')).toBe(3);
    const product = await db().collection('products').findOne({ _id: productId });
    expect(product!.image).toBe(u('v1/products/main/calacatta.webp'));
    expect(await undoRun(db(), 'run-1')).toBe(0); // each backup is restored once
  });

  it('is safe to run again: nothing left to rewrite', async () => {
    await run();
    const again = await run();
    // Only the uncopyable URL is still on Cloudinary, and it is never rewritten.
    expect(again.scan.urls.size).toBe(1);
    expect(again.rewrite).toEqual({ documents: 0, urlsReplaced: 0, conflicts: [] });
  });

  it('an edit made after the scan is kept: the record is read again before writing', async () => {
    const scan = await scanForCloudinary(db(), { cloudName: CLOUD, collections: ['products'] });
    const newPhoto = u('v1/products/main/new-photo.webp');
    await db().collection('products').updateOne({ _id: productId }, { $set: { image: newPhoto } });
    await rewriteUrls(db(), scan.hits, { cloudName: CLOUD, cdnBase: CDN, urls: scan.urls, copiedKeys: new Set(scan.urls.values()), runId: 'run-2' });
    const product = await db().collection('products').findOne({ _id: productId });
    expect(product!.image).toBe(newPhoto); // not in this run: left for the next one
    expect(product!.installedImages[0]).toBe(`${CDN}/products/installed/kitchen_calacatta.png`);
  });

  it('a record edited between that read and the write is left alone, with no backup', async () => {
    const scan = await scanForCloudinary(db(), { cloudName: CLOUD, collections: ['products'] });
    const rewrite = await rewriteUrls(db(), scan.hits, {
      cloudName: CLOUD,
      cdnBase: CDN,
      urls: scan.urls,
      copiedKeys: new Set(scan.urls.values()),
      runId: 'run-3',
      beforeWrite: async () => {
        await db().collection('products').updateOne({ _id: productId }, { $set: { image: 'edited by someone' } });
      },
    });
    expect(rewrite.conflicts).toHaveLength(1);
    expect((await db().collection('products').findOne({ _id: productId }))!.image).toBe('edited by someone');
    expect(await db().collection(BACKUP_COLLECTION).countDocuments({ runId: 'run-3' })).toBe(0);
  });
});
