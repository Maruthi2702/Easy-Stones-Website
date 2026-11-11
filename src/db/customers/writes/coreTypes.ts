/** Shapes the core saves share between MongoDB and Postgres (core.mongo.ts, core.postgres.ts). */
import type { Loose } from '../../../types/records.ts';

/** A customer's rep as it is stored: the id (an ObjectId on MongoDB) and the name copy MongoDB keeps. */
export interface ResolvedRep { salesRep: unknown; salesRepName: string }

export interface CreateCustomerInput {
  /** newId() from the route: a retried request meets its own record. */
  id: string;
  fields: Loose;
  rep: ResolvedRep;
  /** The map point and geocode block, found by the route before the save. */
  geo: Loose;
  createdBy: unknown;
}

/** Looks an address up on the map (the Google call stays in the route). */
export type GeocodePatch = (address: Loose, storedKey: string) => Promise<Loose | null>;

export interface EditCustomerInput {
  /** The body, without protected fields (customerUpdateFields), already cut to the basic card when needed. */
  updateData: Loose;
  /** The body's salesRep, undefined when the edit carried none. */
  salesRep: unknown;
  /** addressFrom(body) when the body had an address object, else null. */
  address: Loose | null;
  /** The body's bare city (older screens). */
  city: unknown;
  geocode: GeocodePatch;
}

/** Not found, a refusal with its reason, or the saved customer (in MongoDB's shape: a document or a plain record). */
export type EditResult = { notFound: true } | { error: string } | { customer: Loose };
