/**
 * Permits' reads on Postgres, answering in MongoDB's shapes: a permit comes back with its `contacts` array in position
 * order (a license the source didn't give is left out, as in MongoDB), numbers as numbers, dates as the text they are.
 * The list's `$unwind` / `$group` are joins and group-bys on permit_contacts. Text sorts COLLATE "C" so ties break on
 * the same bytes MongoDB compares, then on the id so a page never repeats or skips a row.
 */
import { and, asc, desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { permits, permitContacts, permitRuns, permitChecks } from '../schema/permits.ts';
import type { Loose } from '../../types/records.ts';
import type { PermitSpec, SortKey, PermitPageOptions, PermitPage, PermitMeta, ContractorPermitData } from './readTypes.ts';

/** `%`, `_` and `\` typed by a person are letters, not wildcards. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, '\\$&');
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function whereOf(spec: PermitSpec, { except = null }: { except?: 'category' | null } = {}): SQL {
  const c: SQL[] = [];
  if (spec.from || spec.to) {
    if (spec.from) c.push(sql`${permits.issuedOn} >= ${spec.from}`);
    if (spec.to) c.push(sql`${permits.issuedOn} <= ${spec.to}`);
  } else c.push(sql`${permits.issuedOn} is not null`);
  if (spec.sources) {
    c.push(spec.sources.length ? sql`${permits.source} in (${sql.join(spec.sources.map(s => sql`${s}`), sql`, `)})` : sql`false`);
  }
  if (spec.category && except !== 'category') c.push(sql`${permits.category} = ${spec.category}`);
  if (spec.city) c.push(sql`${permits.city} = ${spec.city}`);
  if (spec.minValue !== undefined) c.push(sql`${permits.valuation} >= ${spec.minValue}`);
  if (spec.text) {
    const like = `%${likeEscape(spec.text)}%`;
    const ilike = (col: unknown) => sql`${col} ilike ${like} escape '\\'`;
    c.push(sql`(${ilike(permits.permitNumber)} or ${ilike(permits.address)} or ${ilike(permits.description)} or ${ilike(permits.parcel)}
      or exists (select 1 from permit_contacts pc where pc.permit_id = ${permits.id}
        and (pc.company ilike ${like} escape '\\' or pc.name ilike ${like} escape '\\' or pc.email ilike ${like} escape '\\' or pc.license = ${spec.text.toUpperCase()})))`);
  }
  if (spec.license) {
    const { license, names } = spec.license;
    const byName = names.length
      ? sql` or (pc.license is null and pc.company ilike any (array[${sql.join(names.map(n => sql`${likeEscape(n)}`), sql`, `)}]::text[]))`
      : sql``;
    c.push(sql`exists (select 1 from permit_contacts pc where pc.permit_id = ${permits.id} and pc.kind = 'contractor' and (pc.license = ${license}${byName}))`);
  }
  return and(...c)!;
}

const contactsJson = sql<Loose[] | string>`coalesce((select json_agg(json_build_object(
  'role', pc.role, 'kind', pc.kind, 'company', pc.company, 'name', pc.name, 'phone', pc.phone, 'email', pc.email,
  'address', pc.address, 'license', pc.license) order by pc.position) from permit_contacts pc where pc.permit_id = ${permits.id}), '[]'::json)`;

/** A permit row as MongoDB's aggregate gave it. */
function permitDoc({ id, contacts, valuation, sqft, units, ...p }: Loose): Loose {
  const list = (typeof contacts === 'string' ? JSON.parse(contacts) : contacts) as Loose[];
  return {
    _id: id, ...p, valuation: num(valuation), sqft: num(sqft), units: num(units),
    contacts: list.map(({ license, ...c }) => (license === null || license === undefined ? c : { ...c, license }))
  };
}

const orderOf = (sort: SortKey): SQL[] => {
  const number = (dir: 'asc' | 'desc') => sql`${permits.permitNumber} collate "C" ${sql.raw(dir)}`;
  const tail = [asc(permits.id)];
  switch (sort) {
    case 'issued_asc': return [asc(permits.issuedOn), number('asc'), ...tail];
    case 'value_desc': return [sql`(case when ${permits.valuation} > 0 then 1 else 0 end) desc`, sql`${permits.valuation} desc nulls last`, desc(permits.issuedOn), number('desc'), ...tail];
    case 'value_asc': return [sql`(case when ${permits.valuation} > 0 then 1 else 0 end) desc`, sql`${permits.valuation} asc nulls first`, desc(permits.issuedOn), number('desc'), ...tail];
    default: return [desc(permits.issuedOn), number('desc'), ...tail];
  }
};

async function categoryCounts(db: Db, where: SQL) {
  const rows = await db.select({ _id: permits.category, n: sql<number>`count(*)::int` }).from(permits).where(where).groupBy(permits.category);
  return rows.map(r => ({ _id: r._id, n: Number(r.n) }));
}

/** The page, the tabs' counts and the total in two queries at once; the total is the counts' sum (or the one category's count). */
export async function permitPage(db: Db, spec: PermitSpec, sort: SortKey, { skip = 0, limit = null, withTotal = false, withCategoryCounts = false }: PermitPageOptions = {}): Promise<PermitPage> {
  let query = db.select({ ...getTableColumns(permits), contacts: contactsJson }).from(permits).where(whereOf(spec)).orderBy(...orderOf(sort)).$dynamic();
  if (limit) query = query.limit(limit);
  if (skip) query = query.offset(skip);
  const wantCounts = withCategoryCounts || withTotal;
  const [rows, counts] = await Promise.all([query, wantCounts ? categoryCounts(db, whereOf(spec, { except: 'category' })) : []]);
  const total = counts.reduce((sum, r) => sum + (spec.category && r._id !== spec.category ? 0 : r.n), 0);
  return { items: rows.map(permitDoc), total: withTotal ? total : 0, byCategory: withCategoryCounts ? counts : [] };
}

export async function countPermits(db: Db, spec: PermitSpec): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(permits).where(whereOf(spec));
  return Number(row.n);
}

/** Runs, checks and cities in five queries at once, whatever the number of sources. */
export async function permitMeta(db: Db, sourceIds: string[], checkLimit: number): Promise<PermitMeta> {
  const inList = (col: unknown) => sql`${col} in (${sql.join(sourceIds.map(s => sql`${s}`), sql`, `)})`;
  const runsWhere = sourceIds.length ? inList(permitRuns.source) : sql`false`;
  const [last, lastOk, first, checks, places] = await Promise.all([
    db.selectDistinctOn([permitRuns.source]).from(permitRuns).where(runsWhere).orderBy(permitRuns.source, desc(permitRuns.startedAt), desc(permitRuns.id)),
    db.selectDistinctOn([permitRuns.source]).from(permitRuns).where(and(runsWhere, eq(permitRuns.ok, true))).orderBy(permitRuns.source, desc(permitRuns.startedAt), desc(permitRuns.id)),
    db.selectDistinctOn([permitRuns.source]).from(permitRuns).where(and(runsWhere, eq(permitRuns.ok, true), eq(permitRuns.kind, 'backfill'))).orderBy(permitRuns.source, asc(permitRuns.startedAt), asc(permitRuns.id)),
    db.select().from(permitChecks).orderBy(sql`${permitChecks.month} collate "C" desc`, sql`${permitChecks.source} collate "C" desc`, desc(permitChecks.id)).limit(checkLimit),
    db.selectDistinct({ city: permits.city, source: permits.source }).from(permits).where(sql`${permits.city} <> ''`)
  ]);
  const runOf = ({ id, ...r }: Loose): Loose => ({ _id: id, ...r });
  const runs: PermitMeta['runs'] = {};
  for (const id of sourceIds) runs[id] = { last: null, lastOk: null, first: null };
  for (const r of last) runs[r.source].last = runOf(r);
  for (const r of lastOk) runs[r.source].lastOk = runOf(r);
  for (const r of first) runs[r.source].first = runOf(r);
  return {
    runs,
    checks: checks.map(({ id, ...c }) => c),
    cities: [...new Set(places.map(p => p.city))],
    bySource: places
  };
}

export async function contractorPermitData(db: Db, spec: PermitSpec): Promise<ContractorPermitData> {
  const where = whereOf(spec);
  const [byCategory, recent, emailRows] = await Promise.all([
    categoryCounts(db, where),
    db.select({
      id: permits.id, source: permits.source, permitNumber: permits.permitNumber, category: permits.category, issuedOn: permits.issuedOn,
      address: permits.address, city: permits.city, valuation: permits.valuation, description: permits.description
    }).from(permits).where(where).orderBy(desc(permits.issuedOn), sql`${permits.permitNumber} collate "C" desc`, asc(permits.id)).limit(8),
    db.select({ _id: sql<string>`lower(${permitContacts.email})`, n: sql<number>`count(*)::int` })
      .from(permitContacts).innerJoin(permits, eq(permits.id, permitContacts.permitId))
      .where(and(where, eq(permitContacts.kind, 'contractor'), sql`${permitContacts.email} <> ''`))
      .groupBy(sql`lower(${permitContacts.email})`).orderBy(sql`count(*) desc`, sql`lower(${permitContacts.email})`).limit(5)
  ]);
  return {
    total: byCategory.reduce((sum, r) => sum + r.n, 0),
    byCategory,
    recent: recent.map(({ id, valuation, ...p }) => ({ _id: id, ...p, valuation: num(valuation) })),
    emailRows: emailRows.map(r => ({ _id: r._id, n: Number(r.n) }))
  };
}
