/**
 * Visit saves (add, edit, follow-up, reaction): MongoDB or Postgres by the area's switch
 * (`DB_CUSTOMERS`, src/db/appDb.ts). Routes call these, never the twins directly. See
 * ./README.md for the rules every save follows.
 *
 * The route decides first (types, dates, permissions, photos) and hands the save what to
 * write. A save answers, then the route runs `afterAnswer(emit)`: on MongoDB the calendar
 * link and the log line (as the route always did after answering); on Postgres those were
 * saved in the visit's own transaction, so it only tells open calendars.
 */
import { appDb, areaOn } from '../../appDb.ts';
import * as mongo from './visits.mongo.ts';
import * as pg from './visits.postgres.ts';
import type { Id, AddVisitInput, EditVisitInput, FollowUpInput, ReactionInput } from './visits.types.ts';

export type {
  AddVisitInput, AddVisitResult, EditVisitInput, FollowUpInput, ReactionInput, ReactionResult,
  AfterAnswer, ScheduleEmit, ScheduleEvent
} from './visits.types.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

/** One visit of a customer as stored, or null. */
export async function savedVisit(customerId: string, visitId: Id) {
  return onPostgres() ? pg.findVisit(await appDb(), customerId, String(visitId)) : mongo.findVisit(customerId, visitId);
}

/** The customer a new visit is logged on ({ company, contactName }), or null. */
export async function visitCustomer(customerId: string) {
  return onPostgres() ? pg.visitCustomer(await appDb(), customerId) : mongo.visitCustomer(customerId);
}

/** A reacting customer's name, or null when there is no such customer. */
export async function reactorCustomerName(customerId: string) {
  return onPostgres() ? pg.reactorCustomerName(await appDb(), customerId) : mongo.reactorCustomerName(customerId);
}

/** The visit type of that name (hidden ones too), or null. */
export async function visitTypeNamed(name: string) {
  return onPostgres() ? pg.visitTypeByName(await appDb(), name) : mongo.visitTypeByName(name);
}

export async function addVisit(input: AddVisitInput) {
  return onPostgres() ? pg.addVisit(await appDb(), input) : mongo.addVisit(input);
}

export async function editVisit(input: EditVisitInput) {
  return onPostgres() ? pg.editVisit(await appDb(), input) : mongo.editVisit(input);
}

export async function setFollowUp(input: FollowUpInput) {
  return onPostgres() ? pg.setFollowUp(await appDb(), input) : mongo.setFollowUp(input);
}

export async function toggleReaction(input: ReactionInput) {
  return onPostgres() ? pg.toggleReaction(await appDb(), input) : mongo.toggleReaction(input);
}
