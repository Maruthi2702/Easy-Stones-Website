/** SQL counterparts of the Customers page's MongoDB filters and sort fields. */
import { sql, and, or, eq, inArray, notInArray, ilike, type SQL } from 'drizzle-orm';
import { customers } from '../schema/customers.ts';
import { locations } from '../schema/reference.ts';
import { idOf } from '../copy/values.ts';
import { addDays, FOLLOW_UP_WINDOW_DAYS, letterQuery } from '../../utils/customerList.ts';
import { PLACEHOLDER_EMAIL_RE, OWN_DOMAIN_RE } from '../../utils/customerMatch.ts';
import type { CustomerListQuery } from './types.ts';

const parts = (value = '') => value.split(',').map(v => v.trim()).filter(Boolean);
const pattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

export const listFields = {
  sortPriority: sql<number>`case when ${customers.status} in ('Different Sales Person', 'Not Interested') then 1 else 0 end`,
  normalizedCompany: sql<string>`coalesce(nullif(${customers.company}, ''), ${customers.contactName}, '')`,
  normalizedCity: sql<string>`${customers.city}`,
  normalizedLocation: sql<string>`coalesce(nullif(${locations.name}, ''), 'Seattle')`
};

/** Kept in step with incompleteQuery(), including its delimiter exceptions. */
const incomplete = () => sql`(
  ${customers.phone} !~ ${'\\d'} or ${customers.email} !~ ${'\\S'} or
  ((${customers.email} ~* ${PLACEHOLDER_EMAIL_RE.source} or ${customers.email} ~* ${OWN_DOMAIN_RE.source})
    and ${customers.email} !~ '[,;]') or
  ${customers.street} !~ ${'\\S'} or ${customers.geocodeStatus} = 'failed'
)`;

export function listWhere(q: CustomerListQuery): SQL | undefined {
  const filters: (SQL | undefined)[] = [];
  if (q.search) {
    const p = pattern(q.search);
    filters.push(or(...[customers.company, customers.contactName, customers.email, customers.phone,
      customers.city, customers.street, customers.status].map(c => ilike(c, p))));
  }
  switch (q.view) {
    case 'mine': filters.push(idOf(q.userId) ? eq(customers.salesRepId, idOf(q.userId)!) : sql`false`); break;
    case 'followups':
      filters.push(sql`exists (select 1 from visits v where v.customer_id = ${customers.id}
        and v.follow_up_date >= ${q.today}::date and v.follow_up_date <= ${addDays(q.today, FOLLOW_UP_WINDOW_DAYS)}::date)`);
      break;
    case 'onboarding': filters.push(eq(customers.status, 'Trying to Onboard')); break;
    case 'noModa': filters.push(sql`${customers.modaDisplay} is distinct from true`); break;
    case 'unassigned': filters.push(sql`${customers.salesRepId} is null`); break;
    case 'incomplete': filters.push(incomplete()); break;
  }
  // Legacy `name` and top-level `city` are absent in the source data. The A–Z
  // rule deliberately does NOT fall back to contactName (unlike the sort).
  if (letterQuery(q.letter)) {
    const letter = q.letter!.trim().toUpperCase();
    filters.push(sql`${customers.company} ~* ${letter === '#' ? '^\\s*[^A-Za-z]' : `^\\s*${letter}`}`);
  }
  const moda: SQL[] = [];
  for (const v of parts(q.moda)) {
    if (v === 'display') moda.push(sql`${customers.modaDisplay} = true`);
    if (v === 'noDisplay') moda.push(sql`${customers.modaDisplay} is distinct from true`);
    if (v === 'binders') moda.push(sql`${customers.modaBinders} <> 0`);
    if (v === 'noBinders') moda.push(sql`${customers.modaBinders} = 0`);
  }
  if (moda.length) filters.push(or(...moda));
  if (parts(q.status).length) filters.push(inArray(customers.status, parts(q.status)));
  if (parts(q.level).length) filters.push(inArray(customers.level, parts(q.level)));

  const fabricator = sql`(${customers.customerType} is null or ${customers.customerType} = '' or ${customers.customerType} ~* '^fabricator$')`;
  const types = parts(q.type);
  if (types.length) {
    const includesFabricator = types.some(t => t.toLowerCase() === 'fabricator');
    const others = types.filter(t => t.toLowerCase() !== 'fabricator');
    filters.push(or(includesFabricator ? fabricator : undefined,
      others.length ? inArray(customers.customerType, others) : undefined));
  }
  const excludes = parts(q.typeExclude);
  if (excludes.length) {
    // Match the existing endpoint: a Fabricator exclusion takes precedence
    // over the other excluded types, rather than changing that rule here.
    filters.push(excludes.some(t => t.toLowerCase() === 'fabricator')
      ? sql`not ${fabricator}`
      : or(sql`${customers.customerType} is null`, notInArray(customers.customerType, excludes)));
  }
  // The city filter accepts regex patterns today; search above is literal.
  if (parts(q.city).length) filters.push(or(...parts(q.city).map(c => sql`${customers.city} ~* ${c}`)));
  const reps = parts(q.salesRep);
  const ids = reps.map(idOf).filter((id): id is string => id !== null);
  const unassigned = reps.some(r => r.toLowerCase() === 'unassigned');
  if (ids.length || unassigned) filters.push(or(ids.length ? inArray(customers.salesRepId, ids) : undefined,
    unassigned ? sql`${customers.salesRepId} is null` : undefined));
  // As MongoDB: the branch name exactly; choosing Seattle also takes a blank branch (none
  // reach Postgres — the copy needs a branch — but kept so the rule reads the same).
  const branches = parts(q.location);
  if (branches.length) filters.push(or(inArray(locations.name, branches),
    branches.some(b => b.toLowerCase() === 'seattle') ? sql`coalesce(${locations.name}, '') = ''` : undefined));
  return and(...filters);
}

/** MongoDB's binary string ordering, with missing values first ascending. */
export function listOrder(q: CustomerListQuery, repName: SQL): SQL[] {
  const order = (field: SQL | typeof customers.level, direction: number, text = true) =>
    sql`${field}${text ? sql` collate "C"` : sql``} ${direction === -1 ? sql`desc nulls last` : sql`asc nulls first`}`;
  const result = [sql`${listFields.sortPriority} asc`];
  switch (q.sortBy) {
    case 'company': result.push(order(listFields.normalizedCompany, q.sortOrder)); break;
    case 'level': result.push(order(customers.level, q.sortOrder), order(listFields.normalizedCompany, 1)); break;
    case 'city': result.push(order(listFields.normalizedCity, q.sortOrder)); break;
    case 'salesRep': result.push(order(repName, q.sortOrder), order(listFields.normalizedCompany, 1)); break;
    case 'location': result.push(order(listFields.normalizedLocation, q.sortOrder), order(listFields.normalizedCompany, 1)); break;
    default: result.push(sql`${customers.createdAt} desc`);
  }
  // Last, the id (MongoDB: _id; hex sorts the same as its bytes): customers with equal
  // sort values come in one fixed order, so no page repeats or skips a customer.
  result.push(sql`${customers.id} collate "C" asc`);
  return result;
}
