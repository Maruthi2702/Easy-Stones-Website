/**
 * The small ones on Postgres, answering in MongoDB's shapes (docs.ts). A save builds the document as MongoDB would hold it,
 * then makes its rows with the copy's own builders (src/db/copy/miscRows.ts), so it writes what a re-copy of MongoDB would.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { products, productColors, productBundles, easyStonesColors, crossoverColors, crossovers, contactSubmissions, salesResources } from '../schema/misc.ts';
import {
  productRowsOf, easyStonesColorRowOf, crossoverRowsOf, contactRowOf, salesResourceRowOf
} from '../copy/miscRows.ts';
import { colorDoc, contactDoc, salesResourceDoc, crossoverDoc, productDoc, productAdminJson } from './docs.ts';
import { hasDuplicateMapping, type CrossoverResult } from './crossoverRules.ts';
import type { Loose } from '../../types/records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const same = (col: unknown, v: string) => sql`lower(${col}) = lower(${v})`;

// ── contact form ──
export async function createContact(db: Db, fields: Loose, _id: string): Promise<Loose> {
  const now = new Date();
  const row = contactRowOf({ _id, ...fields, status: 'new', emailSent: false, createdAt: now, updatedAt: now }, []);
  await db.insert(contactSubmissions).values(row!);
  const [saved] = await db.select().from(contactSubmissions).where(eq(contactSubmissions.id, _id));
  return contactDoc(saved);
}
export async function markContactEmailSent(db: Db, id: string): Promise<void> {
  await db.update(contactSubmissions).set({ emailSent: true, updatedAt: new Date() }).where(eq(contactSubmissions.id, id));
}

// ── Easy Stones colours ──
const colorOrder = [asc(easyStonesColors.order), asc(easyStonesColors.createdAt), asc(easyStonesColors.id)];
export async function listColors(db: Db): Promise<Loose[]> {
  return (await db.select().from(easyStonesColors).orderBy(...colorOrder)).map(colorDoc);
}
export async function seedColorsIfEmpty(db: Db, names: string[], ids: string[]): Promise<boolean> {
  return db.transaction(async tx => {
    if ((await tx.select({ id: easyStonesColors.id }).from(easyStonesColors).limit(1)).length) return false;
    const now = new Date();
    await tx.insert(easyStonesColors).values(names.map((name, order) => easyStonesColorRowOf({ _id: ids[order], name, order, createdAt: now, updatedAt: now }, [])!));
    return true;
  });
}
export async function addColor(db: Db, name: string, _id: string): Promise<Loose | 'exists'> {
  return db.transaction(async tx => {
    // One at a time, so two adds can't both take the next order number.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('easy_stones_colors'))`);
    const [dupe] = await tx.select({ id: easyStonesColors.id }).from(easyStonesColors).where(same(easyStonesColors.name, name));
    if (dupe) return 'exists' as const;
    const [highest] = await tx.select({ order: easyStonesColors.order }).from(easyStonesColors).orderBy(desc(easyStonesColors.order)).limit(1);
    const now = new Date();
    const row = easyStonesColorRowOf({ _id, name, order: (highest?.order ?? -1) + 1, createdAt: now, updatedAt: now }, [])!;
    await tx.insert(easyStonesColors).values(row);
    return colorDoc((await tx.select().from(easyStonesColors).where(eq(easyStonesColors.id, _id)))[0]);
  });
}
export async function renameColor(db: Db, id: string, name: string): Promise<Loose | null> {
  const [r] = await db.update(easyStonesColors).set({ name, updatedAt: new Date() }).where(eq(easyStonesColors.id, id.toLowerCase())).returning();
  return r ? colorDoc(r) : null;
}
export async function deleteColor(db: Db, id: string): Promise<boolean> {
  return (await db.delete(easyStonesColors).where(eq(easyStonesColors.id, id.toLowerCase())).returning({ id: easyStonesColors.id })).length > 0;
}

// ── sales resources ──
export async function listSalesResources(db: Db): Promise<Loose[]> {
  return (await db.select().from(salesResources).orderBy(desc(salesResources.createdAt), desc(salesResources.id))).map(salesResourceDoc);
}
export async function createSalesResource(db: Db, fields: Loose, _id: string): Promise<Loose> {
  const row = salesResourceRowOf({ _id, type: 'file', contentType: 'application/octet-stream', ...fields, createdAt: new Date() }, [])!;
  await db.insert(salesResources).values(row);
  return salesResourceDoc((await db.select().from(salesResources).where(eq(salesResources.id, _id)))[0]);
}
export async function deleteSalesResource(db: Db, id: string): Promise<void> {
  await db.delete(salesResources).where(eq(salesResources.id, id.toLowerCase()));
}

// ── Crossover Sheet ──
async function colorDocs(tx: Db | Tx, where?: ReturnType<typeof eq>): Promise<Loose[]> {
  const colors = await (tx as Db).select().from(crossoverColors).where(where);
  if (!colors.length) return [];
  const entries = await (tx as Db).select().from(crossovers).where(inArray(crossovers.colorId, colors.map(c => c.id)));
  return colors.map(c => crossoverDoc(c, entries.filter(e => e.colorId === c.id)));
}
export async function listCrossovers(db: Db): Promise<Loose[]> {
  // MongoDB sorts names by character code; so does this.
  return (await colorDocs(db)).sort((a, b) => (a.easyStonesName < b.easyStonesName ? -1 : a.easyStonesName > b.easyStonesName ? 1 : 0));
}

async function canonicalName(tx: Tx, rawName: string) {
  const [existing] = await tx.select({ n: crossoverColors.easyStonesName }).from(crossoverColors).where(same(crossoverColors.easyStonesName, rawName));
  const [catalog] = await tx.select({ n: easyStonesColors.name }).from(easyStonesColors).where(same(easyStonesColors.name, rawName));
  return existing?.n || catalog?.n || rawName;
}
/** Write one colour document back: its row, and its entries in order (the copy's builder decides every column). */
async function saveColorDoc(tx: Tx, doc: Loose) {
  const made = crossoverRowsOf(doc, [])!;
  await tx.insert(crossoverColors).values(made.color).onConflictDoUpdate({ target: crossoverColors.id, set: { easyStonesName: made.color.easyStonesName, updatedAt: made.color.updatedAt } });
  await tx.delete(crossovers).where(eq(crossovers.colorId, made.color.id));
  if (made.entries.length) await tx.insert(crossovers).values(made.entries);
}
const lockSheet = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('crossover_sheet'))`);
const docNamed = async (tx: Tx, name: string) => (await colorDocs(tx, eq(crossoverColors.easyStonesName, name)))[0] as Loose | undefined;

export async function addMapping(db: Db, rawName: string, entry: Loose, ids: { color: string; entry: string }): Promise<CrossoverResult> {
  return db.transaction(async tx => {
    await lockSheet(tx);
    const easyStonesName = await canonicalName(tx, rawName);
    const existing = await docNamed(tx, easyStonesName);
    if (hasDuplicateMapping(existing?.crossovers, entry.distributorName, entry.distributorColorName)) {
      return { status: 409, message: 'This distributor mapping already exists for this color' };
    }
    const now = new Date();
    const added = { _id: ids.entry, ...entry, createdAt: now, updatedAt: now };
    const doc = existing
      ? { ...existing, crossovers: [...existing.crossovers, added], updatedAt: now }
      : { _id: ids.color, easyStonesName, crossovers: [added], createdAt: now, updatedAt: now };
    await saveColorDoc(tx, doc);
    return { status: 201, body: (await colorDocs(tx, eq(crossoverColors.id, String(doc._id))))[0] };
  });
}

export async function editMapping(db: Db, colorId: string, crossoverId: string, rawNewName: string, fields: Loose, ids: { color: string }): Promise<CrossoverResult> {
  return db.transaction(async tx => {
    await lockSheet(tx);
    const source = (await colorDocs(tx, eq(crossoverColors.id, colorId.toLowerCase())))[0];
    const entry = source?.crossovers.find((e: Loose) => String(e._id) === crossoverId.toLowerCase());
    if (!source || !entry) return { status: 404, message: 'Crossover entry not found' };
    const now = new Date();
    const newName = rawNewName ? await canonicalName(tx, rawNewName) : source.easyStonesName;
    const moved = newName !== source.easyStonesName;
    let result: Loose;
    if (moved) {
      const dest = await docNamed(tx, newName);
      if (hasDuplicateMapping(dest?.crossovers, fields.distributorName, fields.distributorColorName)) {
        return { status: 409, message: 'This distributor mapping already exists for the destination color' };
      }
      const rest = source.crossovers.filter((e: Loose) => e !== entry);
      if (rest.length === 0) await tx.delete(crossoverColors).where(eq(crossoverColors.id, String(source._id)));
      else await saveColorDoc(tx, { ...source, crossovers: rest, updatedAt: now });
      const movedEntry = { ...entry, ...fields };
      const doc = dest
        ? { ...dest, crossovers: [...dest.crossovers, movedEntry], updatedAt: now }
        : { _id: ids.color, easyStonesName: newName, crossovers: [movedEntry], createdAt: now, updatedAt: now };
      await saveColorDoc(tx, doc);
      result = (await colorDocs(tx, eq(crossoverColors.id, String(doc._id))))[0];
    } else {
      if (hasDuplicateMapping(source.crossovers, fields.distributorName, fields.distributorColorName, crossoverId)) {
        return { status: 409, message: 'This distributor mapping already exists for this color' };
      }
      Object.assign(entry, fields, { updatedAt: now });
      await saveColorDoc(tx, { ...source, updatedAt: now });
      result = (await colorDocs(tx, eq(crossoverColors.id, String(source._id))))[0];
    }
    return { status: 200, body: { moved, sourceColorId: colorId, colorDoc: result } };
  });
}

export async function deleteMapping(db: Db, colorId: string, crossoverId: string): Promise<boolean> {
  return db.transaction(async tx => {
    await lockSheet(tx);
    const source = (await colorDocs(tx, eq(crossoverColors.id, colorId.toLowerCase())))[0];
    const entry = source?.crossovers.find((e: Loose) => String(e._id) === crossoverId.toLowerCase());
    if (!source || !entry) return false;
    const rest = source.crossovers.filter((e: Loose) => e !== entry);
    if (rest.length === 0) await tx.delete(crossoverColors).where(eq(crossoverColors.id, String(source._id)));
    else await saveColorDoc(tx, { ...source, crossovers: rest, updatedAt: new Date() });
    return true;
  });
}

// ── products ──
async function productDocs(tx: Db | Tx, where?: ReturnType<typeof eq>): Promise<Loose[]> {
  const rows = await (tx as Db).select().from(products).where(where).orderBy(desc(products.productNumber));
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [colors, bundles] = await Promise.all([
    (tx as Db).select().from(productColors).where(inArray(productColors.productId, ids)),
    (tx as Db).select().from(productBundles).where(inArray(productBundles.productId, ids))
  ]);
  return rows.map(r => productDoc(r, colors.filter(c => c.productId === r.id), bundles.filter(b => b.productId === r.id)));
}
export const listProducts = (db: Db) => productDocs(db);
export async function listProductNames(db: Db): Promise<Loose[]> {
  return (await productDocs(db)).map(p => ({ _id: p._id, id: p.id, name: p.name, category: p.category, availability: p.availability, image: p.image }));
}
export async function getProduct(db: Db, number: number): Promise<Loose | null> {
  const [doc] = await productDocs(db, eq(products.productNumber, number));
  return doc ? productAdminJson(doc) : null;
}

/** The fields a product document has; anything else a request sends is dropped, as the schema drops it. */
const PRODUCT_FIELDS = ['name', 'category', 'collectionType', 'availability', 'image', 'colors', 'installedImages', 'bundles', 'isNewArrival',
  'showInSlider', 'thickness', 'sizes', 'description', 'primaryColor', 'accentColor', 'style', 'variations', 'finishes', 'applications',
  'bookMatch', 'landingCost', 'priceLevels'];

export async function saveProducts(db: Db, prepared: { product: Loose; newProductId: string }[]): Promise<void> {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('products'))`);
    for (const { product, newProductId } of prepared) {
      const { _id, __v, ...data } = product;
      if (data.collection) { data.collectionType = data.collection; delete data.collection; }
      const set = Object.fromEntries(PRODUCT_FIELDS.filter(k => data[k] !== undefined).map(k => [k, data[k]]));
      const number = Number(product.id);
      const [existing] = await productDocs(tx, eq(products.productNumber, number));
      const now = new Date();
      const doc = existing
        ? { ...existing, ...set, updatedAt: now }
        : { _id: newProductId, id: number, availability: 'In Stock', variations: 'Low', bookMatch: 'N/A', isNewArrival: false, showInSlider: false, ...set, createdAt: now, updatedAt: now };
      const made = productRowsOf(doc, []);
      if (!made) continue;
      const { id, createdAt: _c, ...columns } = made.product;
      await tx.insert(products).values(made.product).onConflictDoUpdate({ target: products.id, set: columns });
      await tx.delete(productColors).where(eq(productColors.productId, id));
      await tx.delete(productBundles).where(eq(productBundles.productId, id));
      if (made.colors.length) await tx.insert(productColors).values(made.colors);
      if (made.bundles.length) await tx.insert(productBundles).values(made.bundles);
    }
  });
}
/** Nothing to fill: Postgres never held the old `collection` field. */
export const fillCollectionTypes = async (): Promise<number> => 0;
