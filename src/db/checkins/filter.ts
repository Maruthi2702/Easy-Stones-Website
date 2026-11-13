/**
 * The Check-In routes build their reads as MongoDB filters (src/routes/checkIn.ts:
 * `checkInListQuery`, `byBranchClock`). This turns the subset they use into SQL over
 * `office_check_ins`, so the routes keep one filter and each database answers it.
 *
 * Understood: `location` (a name, `{ $in }`, `{ $nin }`), `createdAt` (`$gte` / `$lt`),
 * `phone` (exact, or a RegExp), `name` / `fabricatorCompany` / `fabricatorPhone` (RegExp),
 * `$or`, `$and`. Anything else throws, so a new kind of filter can't quietly match the
 * wrong rows on Postgres.
 *
 * `location` is a branch NAME, read through the locations table (a check-in whose branch
 * isn't a location has none, and reads as '').
 */
import { and, or, sql, type SQL } from 'drizzle-orm';
import { officeCheckIns } from '../schema/checkInsHolds.ts';
import { locations } from '../schema/reference.ts';
import type { Loose } from '../../types/records.ts';

const FIELDS: Record<string, SQL> = {
  location: sql`coalesce(${locations.name}, '')`,
  phone: sql`${officeCheckIns.phone}`,
  name: sql`${officeCheckIns.name}`,
  fabricatorCompany: sql`${officeCheckIns.fabricatorCompany}`,
  fabricatorPhone: sql`${officeCheckIns.fabricatorPhone}`,
  createdAt: sql`${officeCheckIns.createdAt}`
};

const isOperators = (v: unknown): v is Loose =>
  !!v && typeof v === 'object' && !(v instanceof RegExp) && !(v instanceof Date) && !Array.isArray(v)
    && Object.keys(v).length > 0 && Object.keys(v).every(k => k.startsWith('$'));

function fieldCondition(name: string, col: SQL, spec: unknown): SQL {
  if (spec instanceof RegExp) return sql`${col} ${spec.flags.includes('i') ? sql.raw('~*') : sql.raw('~')} ${spec.source}`;
  if (!isOperators(spec)) return sql`${col} = ${spec instanceof Date ? spec : spec == null ? '' : String(spec)}`;
  const parts: SQL[] = [];
  for (const [op, arg] of Object.entries(spec)) {
    const list = () => sql.join((arg as unknown[]).map(x => sql`${String(x)}`), sql`, `);
    switch (op) {
      case '$in': parts.push((arg as unknown[]).length ? sql`${col} in (${list()})` : sql`false`); break;
      case '$nin': parts.push((arg as unknown[]).length ? sql`${col} not in (${list()})` : sql`true`); break;
      case '$gte': parts.push(sql`${col} >= ${arg as Date}`); break;
      case '$lt': parts.push(sql`${col} < ${arg as Date}`); break;
      default: throw new Error(`Check-in filter: ${name} ${op} is not supported on Postgres`);
    }
  }
  return parts.length === 1 ? parts[0] : and(...parts)!;
}

/** The WHERE clause for a MongoDB-style filter (`{}` = every check-in). */
export function whereOf(filter: Loose | undefined): SQL | undefined {
  if (!filter) return undefined;
  const parts: SQL[] = [];
  for (const [key, spec] of Object.entries(filter)) {
    if (key === '$or' || key === '$and') {
      const subs = (spec as Loose[]).map(whereOf).filter((s): s is SQL => !!s);
      if (!subs.length) { parts.push(key === '$or' ? sql`false` : sql`true`); continue; }
      parts.push((key === '$or' ? or(...subs) : and(...subs))!);
    } else if (FIELDS[key]) {
      parts.push(fieldCondition(key, FIELDS[key], spec));
    } else {
      throw new Error(`Check-in filter: ${key} is not supported on Postgres`);
    }
  }
  return parts.length ? (parts.length === 1 ? parts[0] : and(...parts)) : undefined;
}
