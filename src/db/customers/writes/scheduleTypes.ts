/**
 * What the calendar entry saves (schedule.ts) take and answer, on either database.
 * An `entry` is the calendar entry as the routes answer it: the stored entry with its
 * customer's `_id`, `company` and `contactName` in `customerId` (null when the customer
 * is gone).
 */
import type { Loose } from '../../../types/records.ts';

/** What cleanScheduleFields (src/utils/scheduleRecord.ts) let through. */
export type EntryFields = Loose;

export type CreateEntryResult =
  | { kind: 'noCustomer' }
  | { kind: 'idTaken' }
  | { kind: 'alreadySaved'; entry: Loose }
  | { kind: 'created'; entry: Loose };

export interface PlanDayInput {
  /** Each stop with the id it is saved under (the client's own for a one-stop repeat, else newId()). */
  stops: { id: string; fields: EntryFields }[];
  replace: boolean;
  date: unknown;
  /** One stop sent with its own id: a repeat answers with the entry already saved. */
  retry: boolean;
}

export type PlanDayResult =
  | { kind: 'idTaken' }
  | { kind: 'alreadySaved'; stops: Loose[] }
  | { kind: 'unknownCustomer' }
  | { kind: 'needDate' }
  | { kind: 'offDate' }
  | { kind: 'saved'; stops: Loose[]; replaced: number; created: number };

export type UpdateEntryResult =
  | { kind: 'notFound' }
  | { kind: 'invalid'; message: string }
  | { kind: 'noCustomer' }
  | { kind: 'updated'; entry: Loose };

export interface BackfillResult {
  checked: number;
  /** Entries marked Completed, for the route's socket messages. */
  linked: { id: string; userId: string }[];
}

export type SyncSide = 'google' | 'icloud';

/** Ids for what an import may add: the entry, and the sync's stand-in customer if it doesn't exist yet. */
export interface SyncIds {
  entryId: string;
  customerId: string;
}

/** A Google event as the sync reads it: start / end are `start.dateTime || start.date`. */
export interface GoogleEventInput {
  id: string;
  status?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
}

/** An iCloud event as parseIcsEvents reads it. */
export interface ICloudEventInput {
  uid: string;
  description?: string;
  startTime: Date | null;
  endTime: Date | null;
}
