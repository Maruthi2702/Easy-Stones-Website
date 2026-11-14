/** A Postgres lost-sale row → the record as MongoDB held it (`_id`, the branch's name in `location`), so routes and the screen never learn which database answered. */
import type { lostSales } from '../schema/misc.ts';
import type { Loose } from '../../types/records.ts';

/** A record MongoDB holds without the figure (an old one, read lean) has none here either. */
const num = (v: string | null) => (v == null ? undefined : Number(v));

export function lostSaleDoc(r: typeof lostSales.$inferSelect, locationName: string | null): Loose {
  return {
    _id: r.id,
    customerName: r.customerName,
    // Null only when the customer or rep was deleted since; MongoDB kept the old id as text.
    customerId: r.customerId,
    productName: r.productName,
    productId: r.productId,
    lengthInches: num(r.lengthInches),
    widthInches: num(r.widthInches),
    sfPerSlab: num(r.sfPerSlab),
    slabsCount: num(r.slabsCount),
    totalSf: num(r.totalSf),
    pricePerSf: num(r.pricePerSf),
    totalLostValue: num(r.totalLostValue),
    reason: r.reason,
    location: locationName ?? '',
    competitorName: r.competitorName,
    notes: r.notes,
    salesRepName: r.salesRepName,
    salesRepId: r.salesRepId,
    date: r.lostAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}
