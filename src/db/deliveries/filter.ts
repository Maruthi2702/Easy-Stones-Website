/**
 * The Delivery Schedule's routes build their reads as MongoDB filters (nested $or / $and /
 * $nor over a few fields). This turns the subset they use into SQL over the `deliveries`
 * table, so the routes keep one filter and each database answers it.
 *
 * Only what the routes use is understood; anything else throws, so a new kind of filter
 * can't quietly match the wrong rows on Postgres.
 *
 * What the copy has already merged, and the SQL follows:
 * - a text field that is missing, null or '' is one thing, '' (a branch, a day, a driver);
 * - `date` / `expectedArrivalDate` are real days; no day reads as '';
 * - `location` / `transferDestination` are branch NAMES, read through the locations table.
 */
import { and, or, not, sql, eq, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { deliveries } from '../schema/operations.ts';
import { locations } from '../schema/reference.ts';
import type { Loose } from '../../types/records.ts';

export const origin = alias(locations, 'origin');
export const destination = alias(locations, 'destination');

type Field = { value: SQL; kind: 'text' | 'bool' };

const text = (col: SQL): Field => ({ value: col, kind: 'text' });
/** What MongoDB showed for a field: '' when there is nothing. */
const textOrBlank = (col: unknown): Field => text(sql`coalesce(${col}, '')`);
const dayOrBlank = (col: unknown): Field => text(sql`coalesce(${col}::text, '')`);

const FIELDS: Record<string, Field> = {
  id: text(sql`${deliveries.ticketId}`),
  truckId: text(sql`${deliveries.truckKey}`),
  date: dayOrBlank(deliveries.day),
  expectedArrivalDate: dayOrBlank(deliveries.expectedArrivalDay),
  status: text(sql`${deliveries.status}`),
  deliveryType: text(sql`${deliveries.deliveryType}`),
  customerDropOff: { value: sql`${deliveries.customerDropOff}`, kind: 'bool' },
  location: textOrBlank(origin.name),
  transferDestination: textOrBlank(destination.name),
  customerName: text(sql`${deliveries.customerName}`),
  soNumber: text(sql`${deliveries.soNumber}`),
  invoiceNumber: text(sql`${deliveries.invoiceNumber}`),
  driver: text(sql`${deliveries.driver}`)
};

const isOperatorObject = (v: unknown): v is Loose =>
  !!v && typeof v === 'object' && !(v instanceof RegExp) && !(v instanceof Date) && !Array.isArray(v)
    && Object.keys(v).length > 0 && Object.keys(v).every(k => k.startsWith('$'));

/** null reads as '' for text, as the copy turned a missing value into the default. */
const scalar = (f: Field, v: unknown): SQL => {
  if (f.kind === 'bool') return sql`${Boolean(v)}`;
  return sql`${v == null ? '' : String(v)}`;
};

function fieldCondition(name: string, f: Field, spec: unknown): SQL {
  if (spec instanceof RegExp) {
    return sql`${f.value} ${spec.flags.includes('i') ? sql.raw('~*') : sql.raw('~')} ${spec.source}`;
  }
  if (!isOperatorObject(spec)) return sql`${f.value} = ${scalar(f, spec)}`;

  const parts: SQL[] = [];
  for (const [op, arg] of Object.entries(spec)) {
    const list = () => (arg as unknown[]).map(x => scalar(f, x));
    switch (op) {
      // An empty list matches nothing ($in) / everything ($nin), as in MongoDB; SQL's `in ()` is an error.
      case '$in': parts.push((arg as unknown[]).length ? sql`${f.value} in (${sql.join(list(), sql`, `)})` : sql`false`); break;
      case '$nin': parts.push((arg as unknown[]).length ? sql`${f.value} not in (${sql.join(list(), sql`, `)})` : sql`true`); break;
      case '$ne': parts.push(sql`${f.value} <> ${scalar(f, arg)}`); break;
      case '$gte': parts.push(sql`${f.value} >= ${scalar(f, arg)}`); break;
      case '$lte': parts.push(sql`${f.value} <= ${scalar(f, arg)}`); break;
      // Missing and '' are one thing here: a field "exists" when it has something.
      case '$exists': parts.push(arg ? sql`${f.value} <> ''` : sql`${f.value} = ''`); break;
      default: throw new Error(`Delivery filter: ${name} ${op} is not supported on Postgres`);
    }
  }
  return parts.length === 1 ? parts[0] : and(...parts)!;
}

/** A MongoDB filter over deliveries → a SQL condition (true for an empty filter). */
export function deliveryWhere(filter: Loose | null | undefined): SQL {
  const parts: SQL[] = [];
  for (const [key, spec] of Object.entries(filter || {})) {
    if (key === '$or') parts.push((spec as Loose[]).length ? or(...(spec as Loose[]).map(deliveryWhere))! : sql`false`);
    else if (key === '$and') parts.push((spec as Loose[]).length ? and(...(spec as Loose[]).map(deliveryWhere))! : sql`true`);
    else if (key === '$nor') parts.push((spec as Loose[]).length ? not(or(...(spec as Loose[]).map(deliveryWhere))!) : sql`true`);
    else if (key === '_id') parts.push(eq(deliveries.id, String(spec)));
    else {
      const f = FIELDS[key];
      if (!f) throw new Error(`Delivery filter: ${key} is not supported on Postgres`);
      parts.push(fieldCondition(key, f, spec));
    }
  }
  return parts.length ? and(...parts)! : sql`true`;
}
