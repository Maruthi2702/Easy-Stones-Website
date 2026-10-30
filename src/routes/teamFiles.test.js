// Team Files' routes against a throwaway in-memory MongoDB and a temp folder
// for disk files: View and Manage are checked whatever the screen shows, a
// folder lists with its trail and counts, search finds files in every folder,
// moves never go into themselves, pins don't count as a change, a delete
// takes everything inside a folder and its disk files, and the old Dashboard
// routes still answer in their old shapes.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import mongoose from 'mongoose';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createTeamFilesRouter, createLegacyTeamFilesRouter } = await import('./teamFiles.js');
const { default: SalesDashboardResource } = await import('../models/SalesDashboardResource.js');
const { default: User } = await import('../models/User.js');

let mongo;
let app;
let publicDir;
const emit = vi.fn();
const uploadToCloudinary = vi.fn(async () => ({ secure_url: 'https://res.cloudinary.com/demo/res_1.webp' }));

const KRISH = new mongoose.Types.ObjectId();
const DANA = new mongoose.Types.ObjectId();
const MANAGER = { _id: String(KRISH), permissions: ['view_team_files', 'manage_team_files'] };
const VIEWER = { _id: String(DANA), permissions: ['view_team_files'] };
const DASHBOARD_ONLY = { _id: String(DANA), permissions: ['view_dashboard'] };
const as = (user) => ({ 'x-test-user': JSON.stringify(user) });
const api = (p) => `/api/team-files${p}`;

let clock = 0;
const getNowLocalISO = () => `2026-10-30T09:${String(clock++).padStart(2, '0')}:00.000`;

const PRICE = new mongoose.Types.ObjectId();
const ARCHIVE = new mongoose.Types.ObjectId();
const Q1 = new mongoose.Types.ObjectId();
const FORMS = new mongoose.Types.ObjectId();
const CARD = new mongoose.Types.ObjectId();
const LIST = new mongoose.Types.ObjectId();
const OLD = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await SalesDashboardResource.syncIndexes();
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-files-'));
  const deps = {
    authenticate: (req, res, next) => {
      req.user = JSON.parse(req.headers['x-test-user'] || '{}');
      req.userId = req.user._id;
      next();
    },
    upload: multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } }).single('file'),
    uploadToCloudinary,
    publicDir,
    getNowLocalISO
  };
  app = express();
  app.use(express.json());
  app.set('io', { emit });
  app.use('/api/team-files', createTeamFilesRouter(deps));
  app.use('/api/sales-dashboard', createLegacyTeamFilesRouter(deps));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  if (publicDir) fs.rmSync(publicDir, { recursive: true, force: true });
});

const diskFile = (name) => {
  const dir = path.join(publicDir, 'uploads', 'resources');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), 'pdf bytes');
  return `/uploads/resources/${name}`;
};
const onDisk = (content) => fs.existsSync(path.join(publicDir, `.${content}`));

beforeEach(async () => {
  emit.mockClear();
  uploadToCloudinary.mockClear();
  clock = 0;
  await SalesDashboardResource.collection.deleteMany({});
  await User.collection.deleteMany({});
  await User.collection.insertMany([
    { _id: KRISH, username: 'krish', displayName: 'Krish' },
    { _id: DANA, username: 'dana.w' }
  ]);
  const folder = (_id, name, parentId) => ({ _id, name, type: 'folder', content: '', isFolder: true, parentId, uploadedBy: KRISH, createdAt: '2026-01-01T09:00:00.000' });
  await SalesDashboardResource.collection.insertMany([
    folder(PRICE, 'Price lists', null),
    folder(ARCHIVE, 'Archive 2025', PRICE),
    folder(Q1, 'Q1', ARCHIVE),
    folder(FORMS, 'Forms', null),
    { _id: CARD, name: 'Moda Quartz price card Q4', type: 'file', content: 'https://res.cloudinary.com/demo/card.webp', contentType: 'image/webp', isFolder: false, parentId: PRICE, uploadedBy: KRISH, createdAt: '2026-10-27T09:00:00.000', size: 2516582 },
    { _id: LIST, name: 'Fabricator price list NW', type: 'file', content: diskFile('list.pdf'), contentType: 'application/pdf', isFolder: false, parentId: Q1, uploadedBy: DANA, createdAt: '2026-10-21T09:00:00.000' },
    // Saved by the old Dashboard screen: no size, no updatedAt.
    { _id: OLD, name: 'Moda brochure', type: 'link', content: 'https://modaquartz.com/brochure', contentType: 'text/uri-list', isFolder: false, parentId: null, uploadedBy: DANA, createdAt: '2025-06-01T09:00:00.000' }
  ]);
});

describe('who may', () => {
  it('needs View to read and Manage to change; the Dashboard alone opens nothing', async () => {
    await request(app).get(api('/')).set(as(DASHBOARD_ONLY)).expect(403);
    await request(app).get('/api/sales-dashboard/resources').set(as(DASHBOARD_ONLY)).expect(403);
    await request(app).get(api('/')).set(as(VIEWER)).expect(200);
    await request(app).post(api('/folders')).set(as(VIEWER)).send({ name: 'New' }).expect(403);
    await request(app).delete(api(`/${CARD}`)).set(as(VIEWER)).expect(403);
    await request(app).patch(api(`/${CARD}`)).set(as(VIEWER)).send({ pinned: true }).expect(403);
    expect(await SalesDashboardResource.countDocuments()).toBe(7);
  });
});

describe('GET / (a folder)', () => {
  it('lists the top: folders first with their own file counts, no content', async () => {
    const res = await request(app).get(api('/')).set(as(VIEWER)).expect(200);
    expect(res.body.folder).toBeNull();
    expect(res.body.path).toEqual([]);
    const names = res.body.items.map((i) => i.name);
    expect(names.slice(0, 2).sort()).toEqual(['Forms', 'Price lists']);
    expect(names[2]).toBe('Moda brochure');
    expect(res.body.items.find((i) => i.name === 'Price lists')).toMatchObject({ files: 1, uploadedByName: 'Krish' });
    expect(res.body.items[2].content).toBeUndefined();
    expect(res.body.items[2].uploadedByName).toBe('Dana W');
  });

  it('gives a folder its trail', async () => {
    const res = await request(app).get(api(`/?folder=${Q1}`)).set(as(VIEWER)).expect(200);
    expect(res.body.path.map((c) => c.name)).toEqual(['Price lists', 'Archive 2025', 'Q1']);
    expect(res.body.items.map((i) => i.name)).toEqual(['Fabricator price list NW']);
  });

  it('says when a folder is gone', async () => {
    const res = await request(app).get(api(`/?folder=${new mongoose.Types.ObjectId()}`)).set(as(VIEWER)).expect(404);
    expect(res.body.folderGone).toBe(true);
    await request(app).get(api('/?folder=nonsense')).set(as(VIEWER)).expect(404);
  });
});

describe('tree, search, pinned and recent', () => {
  it('sends every folder with its own count, and the top count', async () => {
    const res = await request(app).get(api('/tree')).set(as(VIEWER)).expect(200);
    expect(res.body.folders).toHaveLength(4);
    expect(res.body.folders.find((f) => f.name === 'Q1')).toMatchObject({ parentId: String(ARCHIVE), files: 1 });
    expect(res.body.topFiles).toBe(1);
  });

  it('finds files by name in every folder, with each one’s trail, literally', async () => {
    const res = await request(app).get(api('/search?q=MODA')).set(as(VIEWER)).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((i) => [i.name, i.path.map((c) => c.name)])).toEqual([
      ['Moda Quartz price card Q4', ['Price lists']],
      ['Moda brochure', []]
    ]);
    expect((await request(app).get(api('/search?q=.*')).set(as(VIEWER))).body.total).toBe(0);
    expect((await request(app).get(api('/search?q=')).set(as(VIEWER))).body).toEqual({ items: [], total: 0 });
  });

  it('pins for the whole team, newest first, without counting as a change', async () => {
    await request(app).patch(api(`/${OLD}`)).set(as(MANAGER)).send({ pinned: true }).expect(200);
    const card = await request(app).patch(api(`/${CARD}`)).set(as(MANAGER)).send({ pinned: true }).expect(200);
    expect(card.body.pinned).toBe(true);
    expect(card.body.updatedAt).toBeUndefined();
    const pinned = await request(app).get(api('/pinned')).set(as(VIEWER)).expect(200);
    expect(pinned.body.items.map((i) => i.name)).toEqual(['Moda Quartz price card Q4', 'Moda brochure']);
    await request(app).patch(api(`/${PRICE}`)).set(as(MANAGER)).send({ pinned: true }).expect(400);
    await request(app).patch(api(`/${CARD}`)).set(as(MANAGER)).send({ pinned: false }).expect(200);
    expect((await request(app).get(api('/pinned')).set(as(VIEWER))).body.items).toHaveLength(1);
  });

  it('puts the latest change first in Recent', async () => {
    await request(app).patch(api(`/${OLD}`)).set(as(MANAGER)).send({ name: 'Moda brochure 2026' }).expect(200);
    const res = await request(app).get(api('/recent')).set(as(VIEWER)).expect(200);
    expect(res.body.items[0].name).toBe('Moda brochure 2026');
  });
});

describe('uploads and folders', () => {
  it('stores a PDF on disk with its size, in the folder asked', async () => {
    const res = await request(app).post(api('/')).set(as(MANAGER))
      .field('name', 'Remnant pricing').field('parentId', String(FORMS))
      .attach('file', Buffer.from('%PDF-1.4 hello'), { filename: 'Remnant pricing.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Remnant pricing', type: 'file', parentId: String(FORMS), size: 14, contentType: 'application/pdf', uploadedByName: 'Krish' });
    expect(res.body.content).toMatch(/^\/uploads\/resources\/Remnant_pricing_.*\.pdf$/);
    expect(onDisk(res.body.content)).toBe(true);
    expect(emit).toHaveBeenCalledWith('resource_update');
  });

  it('sends images to Cloudinary', async () => {
    const res = await request(app).post(api('/')).set(as(MANAGER))
      .field('name', 'Showroom').attach('file', Buffer.from('img'), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201);
    expect(uploadToCloudinary).toHaveBeenCalledOnce();
    expect(res.body).toMatchObject({ content: 'https://res.cloudinary.com/demo/res_1.webp', contentType: 'image/webp', parentId: null });
  });

  it('takes only web links, and refuses a missing name, file or folder', async () => {
    await request(app).post(api('/')).set(as(MANAGER)).send({ kind: 'link', name: 'Book', url: 'https://stoneprofits.com' }).expect(201);
    await request(app).post(api('/')).set(as(MANAGER)).send({ kind: 'link', name: 'Bad', url: 'javascript:alert(1)' }).expect(400);
    await request(app).post(api('/')).set(as(MANAGER)).send({ kind: 'file', name: 'Nothing' }).expect(400);
    await request(app).post(api('/')).set(as(MANAGER)).send({ kind: 'link', name: ' ', url: 'https://x.com' }).expect(400);
    const gone = await request(app).post(api('/')).set(as(MANAGER))
      .send({ kind: 'link', name: 'Book', url: 'https://x.com', parentId: String(new mongoose.Types.ObjectId()) }).expect(400);
    expect(gone.body.folderGone).toBe(true);
  });

  it('makes a folder, and refuses one inside a file', async () => {
    const res = await request(app).post(api('/folders')).set(as(MANAGER)).send({ name: '  Spec   sheets ', parentId: String(PRICE) }).expect(201);
    expect(res.body).toMatchObject({ name: 'Spec sheets', isFolder: true, parentId: String(PRICE), files: 0 });
    await request(app).post(api('/folders')).set(as(MANAGER)).send({ name: 'Inside', parentId: String(CARD) }).expect(400);
    await request(app).post(api('/folders')).set(as(MANAGER)).send({ name: '' }).expect(400);
  });
});

describe('rename, move and replace', () => {
  it('renames, keeping who added it and noting who changed it', async () => {
    const res = await request(app).patch(api(`/${LIST}`)).set(as(MANAGER)).send({ name: 'NW price list' }).expect(200);
    expect(res.body).toMatchObject({ name: 'NW price list', uploadedByName: 'Dana W', updatedByName: 'Krish' });
    const saved = await SalesDashboardResource.findById(LIST).lean();
    expect(String(saved.uploadedBy)).toBe(String(DANA));
    expect(String(saved.updatedBy)).toBe(String(KRISH));
  });

  it('moves a folder, but never into itself or its own subfolders', async () => {
    await request(app).patch(api(`/${PRICE}`)).set(as(MANAGER)).send({ parentId: String(Q1) }).expect(400);
    await request(app).patch(api(`/${ARCHIVE}`)).set(as(MANAGER)).send({ parentId: String(ARCHIVE) }).expect(400);
    await request(app).patch(api(`/${ARCHIVE}`)).set(as(MANAGER)).send({ parentId: String(FORMS) }).expect(200);
    await request(app).patch(api(`/${CARD}`)).set(as(MANAGER)).send({ parentId: null }).expect(200);
    const top = await request(app).get(api('/')).set(as(VIEWER));
    expect(top.body.items.map((i) => i.name)).toContain('Moda Quartz price card Q4');
    const forms = await request(app).get(api(`/?folder=${FORMS}`)).set(as(VIEWER));
    expect(forms.body.items.map((i) => i.name)).toEqual(['Archive 2025']);
  });

  it('replaces a file and removes the old one from disk', async () => {
    const before = (await SalesDashboardResource.findById(LIST).lean()).content;
    const res = await request(app).put(api(`/${LIST}`)).set(as(MANAGER))
      .attach('file', Buffer.from('%PDF new one'), { filename: 'list v2.pdf', contentType: 'application/pdf' }).expect(200);
    expect(res.body.size).toBe(12);
    expect(onDisk(res.body.content)).toBe(true);
    expect(onDisk(before)).toBe(false);
  });

  it('replaces a link with another web link only', async () => {
    await request(app).put(api(`/${OLD}`)).set(as(MANAGER)).send({ url: 'ftp://x' }).expect(400);
    const res = await request(app).put(api(`/${OLD}`)).set(as(MANAGER)).send({ url: 'https://modaquartz.com/2026' }).expect(200);
    expect(res.body.content).toBe('https://modaquartz.com/2026');
  });
});

describe('delete', () => {
  it('counts what a folder delete takes, then takes it all, disk files included', async () => {
    const listContent = (await SalesDashboardResource.findById(LIST).lean()).content;
    const summary = await request(app).get(api(`/${PRICE}/delete-summary`)).set(as(MANAGER)).expect(200);
    expect(summary.body).toEqual({ folders: 2, files: 2 });
    const res = await request(app).delete(api(`/${PRICE}`)).set(as(MANAGER)).expect(200);
    expect(res.body).toMatchObject({ deleted: true, folders: 2, files: 2 });
    expect((await SalesDashboardResource.find().lean()).map((r) => r.name).sort()).toEqual(['Forms', 'Moda brochure']);
    expect(onDisk(listContent)).toBe(false);
    await request(app).delete(api(`/${PRICE}`)).set(as(MANAGER)).expect(404);
  });

  it('never removes a disk file outside uploads/resources', async () => {
    const outside = path.join(publicDir, 'keep.txt');
    fs.writeFileSync(outside, 'keep');
    await SalesDashboardResource.collection.updateOne({ _id: OLD }, { $set: { content: '/uploads/resources/../../keep.txt', type: 'file' } });
    await request(app).delete(api(`/${OLD}`)).set(as(MANAGER)).expect(200);
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe('the old Dashboard routes', () => {
  it('answer in their old shapes behind the new switches', async () => {
    const list = await request(app).get(`/api/sales-dashboard/resources?parentId=${PRICE}`).set(as(VIEWER)).expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.map((r) => r.name)).toEqual(['Archive 2025', 'Moda Quartz price card Q4']);
    expect(list.body[1].uploadedBy.username).toBe('krish');

    const one = await request(app).get(`/api/sales-dashboard/resources/${OLD}`).set(as(VIEWER)).expect(200);
    expect(one.body.content).toBe('https://modaquartz.com/brochure');

    const folder = await request(app).post('/api/sales-dashboard/upload').set(as(MANAGER))
      .send({ name: 'Training', type: 'folder', isFolder: true, parentId: null }).expect(201);
    expect(folder.body.isFolder).toBe(true);
    await request(app).post('/api/sales-dashboard/upload').set(as(VIEWER)).send({ name: 'X', type: 'folder', isFolder: true }).expect(403);

    await request(app).put(`/api/sales-dashboard/resources/${OLD}`).set(as(MANAGER))
      .field('name', 'Brochure').field('type', 'link').field('content', 'https://modaquartz.com/b').expect(200);
    expect((await SalesDashboardResource.findById(OLD).lean()).name).toBe('Brochure');

    await request(app).delete(`/api/sales-dashboard/resources/${PRICE}`).set(as(MANAGER)).expect(200);
    expect(await SalesDashboardResource.countDocuments({ parentId: PRICE })).toBe(0);
  });
});
