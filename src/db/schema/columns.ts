/**
 * Column kinds every area's tables share (src/db/README.md, "Kinds of time"):
 * `day` for days, `localTime` for the local clock times the app writes, `moment`
 * for real instants. Ids are MongoDB's 24 hex characters (`objectId`).
 */
import { sql } from 'drizzle-orm';
import { text, timestamp, date, numeric, check } from 'drizzle-orm/pg-core';

export { objectId } from './reference.ts';

export const moment = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
/** A local clock time as the app wrote it, e.g. '2026-10-23 14:05:00'. */
export const localTime = (name: string) => timestamp(name, { withTimezone: false, mode: 'string', precision: 3 });
export const day = (name: string) => date(name, { mode: 'string' });
/** Money or a measure copied from a JavaScript number: exact, no scale forced on it. */
export const decimal = (name: string) => numeric(name);
export const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`);
export const idFormat = (table: string, column = 'id') =>
  check(`${table}_${column}_format`, sql`${sql.identifier(column)} ~ '^[0-9a-f]{24}$'`);
/** `column in (…)` as a check, for a field the app keeps to a fixed list. */
export const oneOf = (table: string, column: string, values: readonly string[]) =>
  check(`${table}_${column}`, sql.raw(`"${column}" in (${values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ')})`));
