import type { Model } from 'mongoose';
import type Delivery from '../models/Delivery.ts';

/**
 * A delivery ticket as /api/deliveries sends it: the Delivery model
 * (src/models/Delivery.ts) after JSON — ids and dates are strings — with
 * `_id` left off and `id` as the ticket's key. Fields the list leaves out
 * (DELIVERY_LIST_PROJECTION strips signatures, SEARCH_RESULT_PROJECTION
 * sends a handful) are optional, so a screen has to say what it needs.
 *
 * `DeliveryFieldsMatchModel` below fails the typecheck when this names a
 * field the model doesn't have, or the model drops one this still lists.
 */

export type DeliveryStatus = 'pending' | 'scheduled' | 'completed' | 'delayed' | 'cancelled';
export type DeliveryKind = 'jobsite' | 'transfer' | 'will_call' | 'return';

/** The proof of delivery as the board gets it (signatures only on the full read). */
export type DeliveryPod = {
  signeeName?: string;
  driverName?: string;
  customerSignature?: string;
  driverSignature?: string;
  customerSignedAt?: string | null;
  driverSignedAt?: string | null;
  signedAt?: string | null;
  photos?: string[];
  notes?: string;
  signedPdfUrl?: string;
  signedPdfFilename?: string;
  signedPdfPublicId?: string;
  verified?: boolean;
  clearedAt?: string | null;
  clearedBy?: string;
  clearReason?: string;
};

export type DeliveryTicket = {
  id: string;
  customerId?: string | null;
  truckId?: string;
  date?: string;
  time?: string;
  customerName?: string;
  address?: string;
  salesRepName?: string;
  status?: DeliveryStatus;
  notes?: string;
  soNumber?: string;
  invoiceNumber?: string;
  routeNumber?: number;
  location?: string;
  driver?: string;
  deliveryType?: DeliveryKind;
  customerDropOff?: boolean;
  transferDestination?: string;
  expectedArrivalDate?: string;
  receivedAt?: string | null;
  receivedBy?: string;
  /** Logged by the receiving branch on arrival (src/utils/transferArrival.ts). */
  arrivalLogged?: { byName?: string; byLocation?: string; at?: string | null } | null;
  pickupInfo?: string;
  carrierName?: string;
  proNumber?: string;
  freightFee?: number;
  numberOfSlabs?: number;
  packingListUrl?: string;
  packingListFilename?: string;
  packingListPublicId?: string;
  pod?: DeliveryPod;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * What the board adds to a transfer it redraws on its arrival day
 * (`showOnArrivalDay` in src/utils/deliveryTypes.ts) — never sent by the server.
 * `receivingOnly` is not set anywhere today; TicketChip still reads it.
 */
export type TransferView = {
  isIncomingView?: boolean;
  shipDate?: string;
  viewedAs?: 'origin' | 'destination';
  receivingOnly?: boolean;
};

/** A ticket as the board holds it: the stored fields plus the transfer view's. */
export type ViewedTicket = DeliveryTicket & TransferView;

type ModelOf<M> = M extends Model<infer T> ? T : never;
type StoredFields = keyof ModelOf<typeof Delivery>;
// Sent but never stored: the id Mongo adds is dropped, timestamps come from `timestamps: true`.
type FromMongo = 'createdAt' | 'updatedAt';

/** Resolves to `true` only while the ticket's fields and the model's agree. */
export type DeliveryFieldsMatchModel =
  [Exclude<keyof DeliveryTicket, StoredFields | FromMongo>] extends [never]
    ? [Exclude<StoredFields, keyof DeliveryTicket | '_id' | '__v' | FromMongo>] extends [never] ? true : { missingHere: Exclude<StoredFields, keyof DeliveryTicket | '_id' | '__v' | FromMongo> }
    : { notInModel: Exclude<keyof DeliveryTicket, StoredFields | FromMongo> };
export const deliveryFieldsMatchModel: DeliveryFieldsMatchModel = true;
