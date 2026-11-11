/**
 * What the visit saves take and answer (visits.ts picks MongoDB or Postgres).
 *
 * The route decides everything first (types, dates, who may, photos uploaded) and hands
 * the save what to write. A save answers, then `afterAnswer(emit)` is the work the route
 * did after answering: on MongoDB the calendar link and the log line, as before; on
 * Postgres those were saved in the visit's own transaction, so it only tells open
 * calendars (the schedule events) once the save has committed.
 */
import type { Types } from 'mongoose';
import type { Loose } from '../../../types/records.ts';
import type { ActivityEntry } from './activityLog.ts';

export type Id = string | Types.ObjectId;

/** server.ts's emitScheduleUpdate: an open calendar refreshes this entry. */
export type ScheduleEvent = { type: 'upsert' | 'delete'; userId: Id; id: string };
export type ScheduleEmit = (event: ScheduleEvent) => void;

export type AfterAnswer = (emit: ScheduleEmit) => Promise<void>;

/** The log line, less what the save fills in (entity, customer, action, the time). */
export type VisitLogLine = Pick<ActivityEntry, 'id' | 'performedBy' | 'performedByName'> & {
  performedByRole?: unknown;
  details?: Record<string, unknown> | null;
};

export interface AddVisitInput {
  customerId: string;
  /** The visit as the route built it (its `_id`, day, type, photos as links, createdAt…). */
  visit: Loose;
  /** Whose calendar it goes on (null = nobody's: a customer login) and the drop-in's id if one is added. */
  calendar: { userId: Id | null; dropInId: string };
  log: VisitLogLine;
  /** getNowLocalISO: the log line's time, read when it is written. */
  now: () => string;
}

export type AddVisitResult =
  | { kind: 'saved'; afterAnswer: AfterAnswer }
  | { kind: 'alreadySaved'; visit: Loose }
  | { kind: 'notFound' };

/** Fields of the visit an edit sets (only those given), by their MongoDB names. */
export type VisitEdit = Partial<Record<
  'date' | 'followUpDate' | 'purpose' | 'notes' | 'outcome' | 'followUp' | 'managerComment' |
  'headquartersComment' | 'image' | 'updatedBy' | 'updatedByName' | 'updatedAt', unknown>>;

export interface EditVisitInput {
  customerId: string;
  visitId: string;
  /** The visit as it was (the route's read before the permission check). */
  before: Loose;
  set: VisitEdit;
  /** Whose calendar a moved visit's entry is on, its type, and the new drop-in's id. */
  calendar: { userId: unknown; purpose: unknown; dropInId: string };
  log: VisitLogLine;
  now: () => string;
}

export interface FollowUpInput {
  customerId: string;
  visitId: string;
  /** followUpUpdate's `set` (field → value on the visit) and `event` (a history line, or none). */
  set: Record<string, string>;
  event?: Record<string, string>;
  log: VisitLogLine & { timestamp: string };
}

export interface ReactionInput {
  customerId: string;
  visitId: string;
  type: unknown;
  /** Who reacts (a user's or a customer's id) and their name. */
  userId: string;
  userName: string;
  /** The new reaction's id when one is added (newId()). */
  reactionId: string;
  createdAt: string;
}

export type ReactionResult = { kind: 'noCustomer' } | { kind: 'noVisit' } | { kind: 'saved'; reactions: unknown };
