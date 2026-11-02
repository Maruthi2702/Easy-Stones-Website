import type { Model } from 'mongoose';
import type OfficeCheckIn from '../models/OfficeCheckIn.ts';

/**
 * A check-in as /api/checkin sends it: the OfficeCheckIn model
 * (src/models/OfficeCheckIn.ts) after JSON. The Selection Sheet lives on the
 * same record (`selections`, notes, rep, `sheetEdited*`).
 *
 * `CheckInFieldsMatchModel` fails the typecheck when this names a field the
 * model doesn't have, or the model gains one this doesn't list.
 */

export type CheckInStatus = 'New' | 'Processed';

/** One material on the sheet. `priceCentsPerSf` is whole cents, or null for no price. */
export type SavedSelection = {
  material?: string;
  lot?: string;
  details?: string;
  size?: string;
  priceCentsPerSf?: number | null;
};

export type CheckInRecord = {
  _id: string;
  name: string;
  location: string;
  phone: string;
  email?: string;
  fabricatorCompany?: string;
  fabricatorName?: string;
  fabricatorPhone?: string;
  builderName?: string;
  builderPhone?: string;
  status?: CheckInStatus;
  selections?: SavedSelection[];
  specialNotes?: string;
  internalNotes?: string;
  salesRep?: string;
  salesRepEmail?: string;
  sheetEditedBy?: string;
  sheetEditedAt?: string | null;
  loggedBy?: { userId?: string; displayName?: string; username?: string };
  createdAt?: string;
  updatedAt?: string;
};

type ModelOf<M> = M extends Model<infer T> ? T : never;
type StoredFields = keyof ModelOf<typeof OfficeCheckIn>;
type FromMongo = '_id' | '__v' | 'createdAt' | 'updatedAt';

/** Resolves to `true` only while the record's fields and the model's agree. */
export type CheckInFieldsMatchModel =
  [Exclude<keyof CheckInRecord, StoredFields | FromMongo>] extends [never]
    ? [Exclude<StoredFields, keyof CheckInRecord | FromMongo>] extends [never] ? true : { missingHere: Exclude<StoredFields, keyof CheckInRecord | FromMongo> }
    : { notInModel: Exclude<keyof CheckInRecord, StoredFields | FromMongo> };
export const checkInFieldsMatchModel: CheckInFieldsMatchModel = true;
