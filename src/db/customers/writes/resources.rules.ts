/**
 * What the resource saves share on both databases: the refusal they answer with and
 * the shapes the routes hand in. The rules themselves are the routes' and services'
 * (customerResources.ts, resourcePlacement.ts, modaCount.ts, typeReplacement.ts).
 */
import type { Loose } from '../../../types/records.ts';

/** A refusal the route answers with its own status (404, 403, 400). */
export class ResourceError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Who is saving, as visitAccess.ts reads them. */
export interface ResourceActor { id?: string; permissions?: string[] }

/** teamOfRequest(req): '*' or a Set of user ids (src/services/teamDirectory.ts). */
export type ResourceTeam = unknown;

/** A calendar change for emitScheduleUpdate, sent by the route after the save. */
export type ScheduleEvent = Loose;

export interface AddResourceInput {
  customerId: string;
  /** The route's checked fields (fieldsOf): title, date, qty, image already processed. */
  fields: Loose;
  performer: { id: string; name: string };
  /** The staff user whose calendar gets the drop-in (null: none). */
  scheduleUserId: string | null;
  /** getNowLocalISO. */
  now: () => string;
  /** newId() each: the resource, its placement visit, and a drop-in on the calendar. */
  ids: { resourceId: string; visitId: string; dropInId: string };
}

export interface UpdateResourceInput {
  /** The customer the resource ends up on (another one = a move). */
  customerId: string;
  resourceId: string;
  fields: Loose;
  actor: ResourceActor;
  team: ResourceTeam;
  /** newId(): the drop-in a date change puts on the calendar. */
  dropInId: string;
}

export interface DeleteResourceInput {
  customerId: string;
  resourceId: string;
  actor: ResourceActor;
  team: ResourceTeam;
}

export interface DeleteVisitInput {
  customerId: string;
  visitId: string;
  actor: ResourceActor;
  /** Read only when a permission check needs it, as the route did. */
  team: () => Promise<ResourceTeam>;
  performer: { id: string; name: string };
  performedByRole: unknown;
  /** newId(): the activity log line. */
  logId: string;
}

export type DeleteVisitResult =
  | { outcome: 'no-customer' }
  | { outcome: 'forbidden-visit' }
  | { outcome: 'forbidden-resource' }
  /** Deleted; `after` does what follows the answer (calendar, log line on MongoDB; the events on Postgres). */
  | { outcome: 'deleted'; after: (emit: (event: ScheduleEvent) => void) => Promise<void> };

/** A resource's type and owner, for the edit route's check before it processes attachments. */
export interface ResourceForEdit { resourceType?: unknown; uploadedBy?: unknown; createdBy?: unknown }
