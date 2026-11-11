/**
 * Record ids while two databases run side by side.
 *
 * Every record keeps a MongoDB-style id (24 hex characters) in Postgres too, so a new
 * row's id is made by the CALLER (the route) and handed to whichever database saves it:
 * the same id lands in either one, a retried request finds what it already saved, and
 * the write-parity tests can compare the two databases row for row.
 */
import { Types } from 'mongoose';

/** A new record id: 24 lowercase hex characters, as MongoDB makes them. */
export const newId = (): string => new Types.ObjectId().toHexString();

/** A record id as the app sends and stores it. */
export const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);
