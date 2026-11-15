/** Postgres rows → the documents MongoDB held, so routes and screens never learn which database answered. */
import type { products, productColors, productBundles, easyStonesColors, crossoverColors, crossovers, contactSubmissions, salesResources } from '../schema/misc.ts';
import type { Loose } from '../../types/records.ts';

const num = (v: string | null) => (v == null ? undefined : Number(v));
const orUndef = <T>(v: T | null): T | undefined => (v == null ? undefined : v);

export const colorDoc = (r: typeof easyStonesColors.$inferSelect): Loose =>
  ({ _id: r.id, name: r.name, order: r.order, createdAt: r.createdAt, updatedAt: r.updatedAt, __v: 0 });

export const contactDoc = (r: typeof contactSubmissions.$inferSelect): Loose => ({
  _id: r.id, name: r.name, company: orUndef(r.company), email: r.email, phone: orUndef(r.phone), message: r.message,
  status: r.status, emailSent: r.emailSent, createdAt: r.createdAt, updatedAt: r.updatedAt, __v: 0
});

export const salesResourceDoc = (r: typeof salesResources.$inferSelect): Loose => ({
  _id: r.id, name: r.name, type: r.type, content: r.content, contentType: r.contentType, uploadedBy: orUndef(r.uploadedBy), createdAt: r.createdAt, __v: 0
});

export function crossoverDoc(color: typeof crossoverColors.$inferSelect, entries: (typeof crossovers.$inferSelect)[]): Loose {
  return {
    _id: color.id, easyStonesName: color.easyStonesName,
    crossovers: [...entries].sort((a, b) => a.position - b.position).map(e => ({
      _id: e.id, distributorName: e.distributorName, distributorColorName: e.distributorColorName, matchType: e.matchType,
      notes: e.notes, addedByName: e.addedByName, addedById: e.addedById || null, createdAt: e.createdAt, updatedAt: e.updatedAt
    })),
    createdAt: color.createdAt, updatedAt: color.updatedAt, __v: 0
  };
}

/** A product as `Product.find().lean()` returns it (colours have no ids here: Postgres keeps them by position). */
export function productDoc(
  p: typeof products.$inferSelect, colors: (typeof productColors.$inferSelect)[], bundles: (typeof productBundles.$inferSelect)[]
): Loose {
  return {
    _id: p.id, id: p.productNumber, name: p.name, category: p.category, collectionType: orUndef(p.collectionType), availability: p.availability,
    image: orUndef(p.image), colors: [...colors].sort((a, b) => a.position - b.position).map(c => ({ name: c.name, image: orUndef(c.image) })),
    installedImages: p.installedImages ?? [],
    bundles: [...bundles].sort((a, b) => a.position - b.position).map(b => ({
      _id: b.id, bundleNumber: orUndef(b.bundleNumber), serial: orUndef(b.serial), avgSize: orUndef(b.avgSize), qty: orUndef(b.qty),
      location: orUndef(b.location), images: b.images ?? []
    })),
    isNewArrival: p.isNewArrival, showInSlider: p.showInSlider, thickness: p.thickness ?? [], sizes: p.sizes ?? [],
    description: orUndef(p.description), primaryColor: orUndef(p.primaryColor), accentColor: orUndef(p.accentColor), style: orUndef(p.style),
    variations: p.variations, finishes: p.finishes ?? [], applications: p.applications ?? [], bookMatch: p.bookMatch,
    landingCost: num(p.landingCost),
    priceLevels: { level1: num(p.priceLevel1), level2: num(p.priceLevel2), level3: num(p.priceLevel3), level4: num(p.priceLevel4) },
    createdAt: p.createdAt, updatedAt: p.updatedAt, __v: 0
  };
}

/** What `res.json(product)` sent for one product: no `_id` / `__v`, plus the `collection` and `price` virtuals. */
export function productAdminJson(doc: Loose): Loose {
  const { _id, __v, ...rest } = doc;
  const level1 = rest.priceLevels?.level1;
  // toJSON runs with virtuals, so every subdocument also carries `id` (its `_id` as text).
  const bundles = (rest.bundles || []).map((b: Loose) => ({ ...b, id: b._id }));
  return { ...rest, bundles, collection: rest.collectionType, price: level1 ? `$${level1.toFixed(2)}/sqft` : '$0.00/sqft' };
}
