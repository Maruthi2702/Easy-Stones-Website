/**
 * A Postgres delivery row → the ticket the Delivery Schedule has always been sent
 * (MongoDB's shape: `id` = the ticket id, `_id`, `truckId`, `date`, branch NAMES in
 * `location` / `transferDestination`, the proof in a `pod` object). The board never
 * learns which database answered.
 */
import type { deliveries } from '../schema/operations.ts';
import type { Loose } from '../../types/records.ts';

export type DeliveryRow = typeof deliveries.$inferSelect;

export interface DeliveryJoins {
  locationName: string | null;
  destinationName: string | null;
}

export function deliveryDoc(d: DeliveryRow, j: DeliveryJoins): Loose {
  return {
    _id: d.id,
    id: d.ticketId,
    customerId: d.customerId,
    truckId: d.truckKey,
    date: d.day ?? '',
    time: d.time,
    customerName: d.customerName,
    address: d.address,
    salesRepName: d.salesRepName,
    status: d.status,
    notes: d.notes,
    soNumber: d.soNumber,
    invoiceNumber: d.invoiceNumber,
    routeNumber: d.routeNumber,
    location: j.locationName ?? '',
    driver: d.driver,
    deliveryType: d.deliveryType,
    customerDropOff: d.customerDropOff,
    transferDestination: j.destinationName ?? '',
    expectedArrivalDate: d.expectedArrivalDay ?? '',
    receivedAt: d.receivedAt,
    receivedBy: d.receivedBy,
    arrivalLogged: d.arrivalLoggedByName == null && d.arrivalLoggedByLocation == null && d.arrivalLoggedAt == null
      ? null
      : { byName: d.arrivalLoggedByName ?? '', byLocation: d.arrivalLoggedByLocation ?? '', at: d.arrivalLoggedAt },
    pickupInfo: d.pickupInfo,
    carrierName: d.carrierName,
    proNumber: d.proNumber,
    freightFee: Number(d.freightFee),
    numberOfSlabs: d.numberOfSlabs,
    packingListUrl: d.packingListUrl,
    packingListFilename: d.packingListFilename,
    packingListPublicId: d.packingListPublicId,
    pod: {
      signeeName: d.podSigneeName,
      driverName: d.podDriverName,
      customerSignature: d.podCustomerSignature,
      driverSignature: d.podDriverSignature,
      customerSignedAt: d.podCustomerSignedAt,
      driverSignedAt: d.podDriverSignedAt,
      signedAt: d.podSignedAt,
      photos: d.podPhotos,
      notes: d.podNotes,
      signedPdfUrl: d.podSignedPdfUrl,
      signedPdfFilename: d.podSignedPdfFilename,
      signedPdfPublicId: d.podSignedPdfPublicId,
      verified: d.podVerified,
      clearedAt: d.podClearedAt,
      clearedBy: d.podClearedBy,
      clearReason: d.podClearReason
    },
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  };
}

/**
 * MongoDB's `.find(filter, projection)` for the two projection shapes the schedule
 * uses: exclude some dotted paths (the list drops signatures and photos), or include
 * only some (the order search). `_id` stays unless a projection says `_id: 0`.
 */
export function projectDelivery(doc: Loose, projection: Record<string, number> | undefined): Loose {
  if (!projection) return doc;
  const entries = Object.entries(projection).filter(([k]) => k !== '_id');
  const keepId = projection._id !== 0;
  if (entries.length && entries.every(([, v]) => v === 0)) {
    const out: Loose = { ...doc, ...(doc.pod ? { pod: { ...doc.pod } } : {}) };
    for (const [path] of entries) {
      const [head, tail] = path.split('.');
      if (tail && out[head] && typeof out[head] === 'object') delete out[head][tail];
      else delete out[head];
    }
    if (!keepId) delete out._id;
    return out;
  }
  const out: Loose = keepId ? { _id: doc._id } : {};
  for (const [path, v] of entries) {
    if (!v) continue;
    const [head, tail] = path.split('.');
    if (tail) out[head] = { ...(out[head] || {}), [tail]: doc[head]?.[tail] };
    else out[head] = doc[head];
  }
  return out;
}
