/**
 * The small ones' data layer: the public site's products, the Easy Stones colours, the Crossover Sheet, the contact form
 * and the old sales-resources list. The routes read and write through these, and each picks MongoDB or Postgres by the
 * area's switch (`DB_SMALL`, src/db/appDb.ts). Both answer the same (small.parity.test.ts). Team Files is `../teamFiles/`.
 */
import { appDb, areaOn } from '../appDb.ts';
import { newId } from '../ids.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { Loose } from '../../types/records.ts';
import type { CrossoverResult } from './crossoverRules.ts';

const onPostgres = () => areaOn('small') === 'postgres';

// contact form
export async function createContact(fields: Loose): Promise<Loose> {
  const id = newId();
  return onPostgres() ? pg.createContact(await appDb(), fields, id) : mongo.createContact(fields, id);
}
export async function markContactEmailSent(id: string) {
  return onPostgres() ? pg.markContactEmailSent(await appDb(), id) : mongo.markContactEmailSent(id);
}

// colours
export async function listColors() { return onPostgres() ? pg.listColors(await appDb()) : mongo.listColors(); }
export async function seedColorsIfEmpty(names: string[]) {
  const ids = names.map(() => newId());
  return onPostgres() ? pg.seedColorsIfEmpty(await appDb(), names, ids) : mongo.seedColorsIfEmpty(names, ids);
}
export async function addColor(name: string) {
  const id = newId();
  return onPostgres() ? pg.addColor(await appDb(), name, id) : mongo.addColor(name, id);
}
export async function renameColor(id: string, name: string) { return onPostgres() ? pg.renameColor(await appDb(), id, name) : mongo.renameColor(id, name); }
export async function deleteColor(id: string) { return onPostgres() ? pg.deleteColor(await appDb(), id) : mongo.deleteColor(id); }

// sales resources
export async function listSalesResources() { return onPostgres() ? pg.listSalesResources(await appDb()) : mongo.listSalesResources(); }
export async function createSalesResource(fields: Loose) {
  const id = newId();
  return onPostgres() ? pg.createSalesResource(await appDb(), fields, id) : mongo.createSalesResource(fields, id);
}
export async function deleteSalesResource(id: string) { return onPostgres() ? pg.deleteSalesResource(await appDb(), id) : mongo.deleteSalesResource(id); }

// Crossover Sheet
export async function listCrossovers() { return onPostgres() ? pg.listCrossovers(await appDb()) : mongo.listCrossovers(); }
export async function addMapping(rawName: string, entry: Loose): Promise<CrossoverResult> {
  const ids = { color: newId(), entry: newId() };
  return onPostgres() ? pg.addMapping(await appDb(), rawName, entry, ids) : mongo.addMapping(rawName, entry, ids);
}
export async function editMapping(colorId: string, crossoverId: string, rawNewName: string, fields: Loose): Promise<CrossoverResult> {
  const ids = { color: newId() };
  return onPostgres() ? pg.editMapping(await appDb(), colorId, crossoverId, rawNewName, fields, ids) : mongo.editMapping(colorId, crossoverId, rawNewName, fields, ids);
}
export async function deleteMapping(colorId: string, crossoverId: string) {
  return onPostgres() ? pg.deleteMapping(await appDb(), colorId, crossoverId) : mongo.deleteMapping(colorId, crossoverId);
}

// products
export async function listProducts() { return onPostgres() ? pg.listProducts(await appDb()) : mongo.listProducts(); }
export async function listProductNames() { return onPostgres() ? pg.listProductNames(await appDb()) : mongo.listProductNames(); }
export async function getProduct(number: number) { return onPostgres() ? pg.getProduct(await appDb(), number) : mongo.getProduct(number); }
/** Every new id (a new product's, a bundle that has none) is made here, so both databases store the same ones. */
export async function saveProducts(list: Loose[]) {
  const prepared = list.map(product => ({
    product: Array.isArray(product.bundles) ? { ...product, bundles: product.bundles.map((b: Loose) => ({ ...b, _id: b._id || newId() })) } : product,
    newProductId: newId()
  }));
  return onPostgres() ? pg.saveProducts(await appDb(), prepared) : mongo.saveProducts(prepared);
}
export async function fillCollectionTypes() { return onPostgres() ? pg.fillCollectionTypes() : mongo.fillCollectionTypes(); }
