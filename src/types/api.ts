/**
 * Shapes shared by the screens' API calls (src/api/*). The data types for
 * records (Customer, Delivery…) live beside this file as they're needed.
 */

/** A MongoDB id as it travels in JSON. */
export type Id = string;

/** Query-string values: empty, null and undefined are left out of the URL. */
export type Query = Record<string, string | number | boolean | null | undefined>;

/** What a call in src/api throws: a message to show as is, plus the HTTP status (0 = no answer). */
export type ApiError = Error & { status: number; problems?: unknown[] };

/** The `{ error }` / `{ message }` body our routes send with a refusal. */
export type ErrorBody = { error?: string; message?: string; problems?: unknown[] };

/** The record fields every call here needs: an id and the optimistic-lock version. */
export type Versioned = { _id: Id; version?: number };

/** Turn a Query into URLSearchParams input (values as strings, blanks dropped). */
export const queryEntries = (query: Query): [string, string][] =>
  Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)]);
