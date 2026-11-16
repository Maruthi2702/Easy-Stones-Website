/**
 * The small ones' data layer: each call run on MongoDB, then on Postgres, must answer the same and leave the same rows
 * behind (the copy's own check against MongoDB is the spec). Intended difference: a product's colours have no ids in Postgres.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import * as small from './index.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 90_000 });

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
// A new row's id is made by the data layer: both runs of one call must get the same one.
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

let t: WriteParity;
beforeAll(async () => { t = await openWriteParity(async () => {}, 'DB_SMALL'); }, 240000);
afterAll(async () => { await t?.close(); });

/** Both databases, same answer (after JSON), same rows. */
async function same<T>(run: () => Promise<T>, tidy: (v: T) => unknown = v => v) {
  ids.made.length = 0;
  const { mongo, postgres } = await t.both(async () => { ids.used = 0; return JSON.parse(JSON.stringify(await run() ?? null)); });
  expect(normalize(tidy(postgres as T))).toEqual(normalize(tidy(mongo as T)));
  expect(await t.differences()).toEqual([]);
  return mongo as T;
}
/** Colours inside a product have no ids in Postgres. */
const noColorIds = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === 'colors' && Array.isArray(x) ? x.map(({ _id, id, ...c }: Loose) => c) : x)));

describe('the contact form', () => {
  it('saves a message and marks its email sent', async () => {
    const saved = await same(() => small.createContact({ name: 'Ann', company: 'Acme', email: 'a@x.test', phone: '555', message: 'Hi' })) as Loose;
    expect(saved.status).toBe('new');
    await same(() => small.markContactEmailSent(String(saved._id)));
    await same(() => small.createContact({ name: 'Bo', email: 'b@x.test', message: 'No company' }));
  });
});

describe('the Easy Stones colours', () => {
  it('seeds once, adds in order, refuses the same name in another case, renames, deletes', async () => {
    expect(await same(() => small.seedColorsIfEmpty(['Alpine', 'Enigma']))).toBe(true);
    expect(await same(() => small.seedColorsIfEmpty(['Other']))).toBe(false);
    const added = await same(() => small.addColor('Calacatta')) as Loose;
    expect(added.order).toBe(2);
    expect(await same(() => small.addColor('calacatta'))).toBe('exists');
    expect(((await same(() => small.listColors())) as Loose[]).map(c => c.name)).toEqual(['Alpine', 'Enigma', 'Calacatta']);
    await same(() => small.renameColor(String(added._id), 'Calacatta Gold'));
    expect(await same(() => small.renameColor('0'.repeat(24), 'Nope'))).toBeNull();
    expect(await same(() => small.deleteColor(String(added._id)))).toBe(true);
    expect(await same(() => small.deleteColor(String(added._id)))).toBe(false);
  });
});

describe('the Crossover Sheet', () => {
  const entry = (d: string, c: string, extra: Loose = {}) => ({ distributorName: d, distributorColorName: c, matchType: 'Similar', notes: '', addedByName: 'Dee', addedById: 'u1', ...extra });
  it('adds, refuses a duplicate, takes the catalog casing, edits, moves and deletes', async () => {
    const first = await same(() => small.addMapping('enigma', entry('MSI', 'Enigma Grey'))) as Loose;
    expect(first.status).toBe(201);
    expect((first.body as Loose).easyStonesName).toBe('Enigma');
    expect((await same(() => small.addMapping('ENIGMA', entry('msi', 'enigma grey')))).status).toBe(409);
    const second = await same(() => small.addMapping('Enigma', entry('Arizona', 'Smoke', { matchType: 'Direct Crossover' }))) as Loose;
    const colorId = String((second.body as Loose)._id);
    const entryId = String((second.body as Loose).crossovers[1]._id);
    expect(((await same(() => small.listCrossovers())) as Loose[])).toHaveLength(1);

    // an edit in place, a duplicate edit, then a move to a new colour (which makes its document)
    await same(() => small.editMapping(colorId, entryId, '', { distributorName: 'Arizona', distributorColorName: 'Smoke 2', matchType: 'Similar', notes: 'n' }));
    expect((await same(() => small.editMapping(colorId, entryId, '', { distributorName: 'MSI', distributorColorName: 'Enigma Grey', matchType: 'Similar', notes: '' }))).status).toBe(409);
    const moved = await same(() => small.editMapping(colorId, entryId, 'Calacatta', { distributorName: 'Arizona', distributorColorName: 'Smoke 2', matchType: 'Similar', notes: 'n' })) as Loose;
    expect((moved.body as Loose).moved).toBe(true);
    expect((await same(() => small.editMapping('0'.repeat(24), entryId, '', {}))).status).toBe(404);
    // moving the last entry out deletes its colour document
    const newColorId = String((moved.body as Loose).colorDoc._id);
    const lone = String((moved.body as Loose).colorDoc.crossovers[0]._id);
    await same(() => small.editMapping(newColorId, lone, 'Enigma', { distributorName: 'Arizona', distributorColorName: 'Smoke 2', matchType: 'Similar', notes: 'n' }));
    expect(await same(() => small.deleteMapping(newColorId, lone))).toBe(false);
    const sheet = (await same(() => small.listCrossovers())) as Loose[];
    for (const e of sheet[0].crossovers) expect(await same(() => small.deleteMapping(String(sheet[0]._id), String(e._id)))).toBe(true);
    expect((await same(() => small.listCrossovers())) as Loose[]).toEqual([]);
  });
});

describe('the sales resources', () => {
  it('creates, lists newest first and deletes', async () => {
    const a = await same(() => small.createSalesResource({ name: 'Price list', type: 'link', content: 'https://x.test', contentType: 'text/html' })) as Loose;
    await same(() => small.createSalesResource({ name: 'File', content: 'abc' }));
    // Both saved in one frozen instant, so their order is a tie: compare as a set.
    await same(() => small.listSalesResources(), v => [...(v as Loose[])].sort((x, y) => (x._id < y._id ? -1 : 1)));
    await same(() => small.deleteSalesResource(String(a._id)));
  });
});

describe('products', () => {
  const bundle = (n: string, id: string) => ({ _id: id, bundleNumber: n, serial: `S${n}`, avgSize: '120x60', qty: '8', location: 'Seattle', images: ['https://x/i.jpg'] });
  it('upserts a catalog, merges a partial save, and answers the admin list and detail', async () => {
    await same(() => small.saveProducts([
      { id: 7, name: 'Taj Mahal', category: 'Quartzite', collection: 'Luxury', colors: [{ name: 'Cream', image: 'c.jpg' }], bundles: [bundle('1', 'a'.repeat(24))],
        priceLevels: { level1: 12.5, level2: 14 }, landingCost: 9.75, thickness: ['2cm', '3cm'], isNewArrival: true, price: 'ignored' },
      { id: 9, name: 'Alpine', category: 'Marble' }
    ]), noColorIds);
    // a partial save changes only what it names
    await same(() => small.saveProducts([{ id: 7, availability: 'Out of Stock', _id: 'x', __v: 3 }]), noColorIds);
    expect(((await same(() => small.listProducts(), noColorIds)) as Loose[]).map(p => p.id)).toEqual([9, 7]);
    await same(() => small.listProductNames());
    const detail = await same(() => small.getProduct(7), noColorIds) as Loose;
    expect(detail.price).toBe('$12.50/sqft');
    expect(detail.collection).toBe('Luxury');
    expect(((await same(() => small.getProduct(9))) as Loose).price).toBe('$0.00/sqft');
    expect(await same(() => small.getProduct(404))).toBeNull();
    expect(await same(() => small.fillCollectionTypes())).toBe(0);
  });
});
