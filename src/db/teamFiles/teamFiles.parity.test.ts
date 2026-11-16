/**
 * Team Files' data layer: each call run on MongoDB, then on Postgres, must answer the same and leave the same rows behind
 * (the copy's own check against MongoDB is the spec).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import '../../models/User.ts';
import * as files from './index.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 90_000 });

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

const dana = String(new mongoose.Types.ObjectId()), gone = String(new mongoose.Types.ObjectId());
let t: WriteParity;
beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('roles').insertOne({ _id: new mongoose.Types.ObjectId(), name: 'staff', displayName: 'Staff', permissions: [] });
    await db.collection('users').insertOne({ _id: new mongoose.Types.ObjectId(dana), username: 'dana', password: 'x', role: 'staff', email: 'd@x.test', displayName: 'Dana', isActive: true });
  }, 'DB_SMALL');
}, 240000);
afterAll(async () => { await t?.close(); });

async function same<T>(run: () => Promise<T>, tidy: (v: T) => unknown = v => v) {
  ids.made.length = 0;
  const { mongo, postgres } = await t.both(async () => { ids.used = 0; return JSON.parse(JSON.stringify(await run() ?? null)); });
  expect(normalize(tidy(postgres as T))).toEqual(normalize(tidy(mongo as T)));
  expect(await t.differences()).toEqual([]);
  return mongo as T;
}
// One fixed time per name, so the same call on both databases saves the same text.
const times = new Map<string, string>();
const at = (name: string) => { if (!times.has(name)) times.set(name, `2026-11-10T09:${String(times.size).padStart(2, '0')}:00.000`); return times.get(name)!; };
const folder = (name: string, parentId: string | null = null) => ({ name, type: 'folder', content: '', contentType: 'application/vnd.google-apps.folder', isFolder: true, parentId, thumbnail: '', uploadedBy: dana, createdAt: at(name) });
const link = (name: string, parentId: string | null = null, by: string | null = dana) => ({ name, type: 'link', content: `https://x.test/${name}`, contentType: 'text/uri-list', isFolder: false, parentId, thumbnail: '', uploadedBy: by, createdAt: at(name) });

describe('Team Files', () => {
  it('makes folders and links, lists folders first and newest first, with the uploader', async () => {
    const top = await same(() => files.createResource(folder('Price lists'))) as Loose;
    const inner = await same(() => files.createResource(folder('2026', String(top._id)))) as Loose;
    await same(() => files.createResource(link('Slab chart', String(top._id))));
    await same(() => files.createResource(link('From someone deleted', String(top._id), gone)));
    await same(() => files.createResource(link(' Spaced name ', null)));
    const topList = await same(() => files.listResources(null)) as Loose[];
    expect(topList.map(r => r.name)).toEqual(['Price lists', 'Spaced name']);
    expect((await same(() => files.listResources(String(top._id)))) as Loose[]).toHaveLength(3);
    const one = await same(() => files.getResource(String(inner._id))) as Loose;
    expect(one.uploadedBy.username).toBe('dana');
    expect(await same(() => files.getResource('0'.repeat(24)))).toBeNull();
  });

  it('refuses what the schema refuses, and a bad id', async () => {
    const attempt = async (run: () => Promise<unknown>) => run().then(() => 'saved', () => 'refused');
    const { mongo, postgres } = await t.both(async () => [
      await attempt(() => files.createResource({ ...link('x'), name: '' })),
      await attempt(() => files.createResource({ ...link('x'), content: '' })),
      await attempt(() => files.getResource('nope')),
      await attempt(() => files.listResources('nope'))
    ]);
    expect(postgres).toEqual(mongo);
    expect(mongo).toEqual(['refused', 'refused', 'refused', 'refused']);
    expect(await t.differences()).toEqual([]);
  });

  it('renames, moves, replaces content and takes the editor as the uploader', async () => {
    const top = ((await t.on('mongo', () => files.listResources(null))) as Loose[]).find(r => r.name === 'Price lists')!;
    const doc = ((await t.on('mongo', () => files.listResources(String(top._id)))) as Loose[]).find(r => r.name === 'Slab chart')!;
    await same(() => files.updateResource(String(doc._id), { name: 'Slab chart v2', parentId: null, uploadedBy: dana, content: 'https://x.test/new', contentType: 'text/uri-list', thumbnail: 'data:image/png;base64,AAA' }));
    await same(() => files.updateResource(String(doc._id), { parentId: String(top._id) }));
    expect(await same(() => files.updateResource('0'.repeat(24), { name: 'x' }))).toBeNull();
  });

  it('deletes a folder with everything inside it and answers the stored contents', async () => {
    const top = ((await t.on('mongo', () => files.listResources(null))) as Loose[]).find(r => r.name === 'Price lists')!;
    const removed = await same(() => files.removeResourceTree(String(top._id)), v => [...(v as string[])].sort()) as string[];
    expect(removed.length).toBeGreaterThan(0);
    expect((await same(() => files.listResources(null))) as Loose[]).toHaveLength(1);
    expect(await same(() => files.removeResourceTree('0'.repeat(24)))).toEqual([]);
  });
});
