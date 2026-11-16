/**
 * Permits' pull and registry-cache calls on Postgres, answering as writesMongo.ts does. A save builds the document as
 * MongoDB would hold it after the same update, then makes its rows with the copy's own builder (src/db/copy/permitsRows.ts),
 * so it writes what a re-copy of MongoDB would. A permit and its contacts are saved in one transaction. No automatic
 * updatedAt (it exists only for the 673 permits an older pull stamped); a cleared issue date stays null.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, gt, ne, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { permits, permitContacts, permitRuns, permitChecks, permitContractors, permitContractorNames } from '../schema/permits.ts';
import { permitsRows } from '../copy/permitsRows.ts';
import type { Loose } from '../../types/records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;
const empty = { permits: [], permitRuns: [], permitChecks: [], permitContractors: [], permitContractorNames: [] };
const withoutUndefined = (o: Loose) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** What Mongoose does to a Number field: a numeric string becomes a number, anything else null. */
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── permits ──
type PermitRow = typeof permits.$inferSelect;
type ContactRow = typeof permitContacts.$inferSelect;

/** A stored permit as its MongoDB document (contacts in order, numbers as numbers). */
function permitDoc(row: PermitRow, contacts: ContactRow[]): Loose {
  const { id, ...rest } = row;
  return {
    ...rest, _id: id, valuation: num(row.valuation), sqft: num(row.sqft), units: num(row.units),
    contacts: [...contacts].sort((a, b) => a.position - b.position).map(({ permitId: _p, position: _n, license, ...c }) => ({ ...c, ...(license != null && { license }) }))
  };
}
/** Casts a permit document's numbers the way the Mongoose schema does. */
const cast = (d: Loose): Loose => ({ ...d, ...['valuation', 'sqft', 'units'].reduce((o, k) => (k in d ? { ...o, [k]: num(d[k]) } : o), {}) });
function rowsOf(doc: Loose) {
  const r = permitsRows({ ...empty, permits: [doc] } as never, []);
  return { permit: r.permits[0], contacts: r.permitContacts };
}
/** The columns an update rewrites: everything the document carries except what the app stamps itself. */
const KEEP = new Set(['id', 'createdAt', 'updatedAt', 'firstSeenAt', 'lastSeenAt']);
const columnsOf = (row: Loose) => Object.fromEntries(Object.entries(row).filter(([k]) => !KEEP.has(k)));
/** What the source can change in a permit, to tell whether a save changed anything (the pull's "updated"). */
const comparable = (row: Loose) => ({ ...columnsOf(row), detailsAt: undefined, valuation: num(row.valuation), sqft: num(row.sqft), units: num(row.units) });

async function saveOne(tx: Tx, source: string, p: Loose, id: string, at: Date): Promise<'added' | 'updated' | 'same'> {
  const { permitNumber, source: _s, categoryIfNew, ...fields } = withoutUndefined(p);
  const [found] = await tx.select().from(permits).where(and(eq(permits.source, source), eq(permits.permitNumber, String(permitNumber)))).for('update');
  if (!found) {
    const doc = cast({ _id: id, source, permitNumber, ...fields, ...(categoryIfNew && !fields.category && { category: categoryIfNew }), firstSeenAt: at, lastSeenAt: at, contacts: fields.contacts ?? [] });
    const { permit, contacts } = rowsOf(doc);
    const [made] = await tx.insert(permits).values(permit).onConflictDoNothing().returning({ id: permits.id });
    if (made) {
      if (contacts.length) await tx.insert(permitContacts).values(contacts);
      return 'added';
    }
    return saveOne(tx, source, p, id, at); // another save took it first: now it is an update
  }
  const before = permitDoc(found, await tx.select().from(permitContacts).where(eq(permitContacts.permitId, found.id)));
  const after = cast({ ...before, ...fields });
  const was = rowsOf(before), now = rowsOf(after);
  const changed = !same(comparable(was.permit), comparable(now.permit)) || !same(was.contacts, now.contacts);
  if (changed) {
    await tx.update(permits).set(columnsOf(now.permit)).where(eq(permits.id, found.id));
    if (!same(was.contacts, now.contacts)) {
      await tx.delete(permitContacts).where(eq(permitContacts.permitId, found.id));
      if (now.contacts.length) await tx.insert(permitContacts).values(now.contacts);
    }
  }
  return changed ? 'updated' : 'same';
}

export async function savePermits(db: Db, source: string, list: Loose[], ids: string[], at: Date, detailsRead: boolean) {
  return db.transaction(async tx => {
    let added = 0, updated = 0;
    for (const [i, p] of list.entries()) {
      const r = await saveOne(tx, source, p, ids[i], at);
      if (r === 'added') added++; else if (r === 'updated') updated++;
    }
    const numbers = list.map(p => String(p.permitNumber));
    if (numbers.length) {
      await tx.update(permits).set({ lastSeenAt: at, ...(detailsRead && { detailsAt: at }) }).where(and(eq(permits.source, source), inArray(permits.permitNumber, numbers)));
    }
    return { added, updated };
  });
}

export async function permitNumbers(db: Db, source: string, where: { issuedFrom?: string; issuedTo?: string; among?: string[] } = {}): Promise<string[]> {
  if (where.among && !where.among.length) return [];
  const rows = await db.selectDistinct({ n: permits.permitNumber }).from(permits).where(and(
    eq(permits.source, source),
    where.issuedFrom ? gte(permits.issuedOn, where.issuedFrom) : undefined,
    where.issuedTo ? lte(permits.issuedOn, where.issuedTo) : undefined,
    where.among ? inArray(permits.permitNumber, where.among) : undefined
  ));
  return rows.map(r => r.n);
}

export async function permitNumbersDetailedSince(db: Db, source: string, numbers: string[], since: Date): Promise<string[]> {
  if (!numbers.length) return [];
  const rows = await db.selectDistinct({ n: permits.permitNumber }).from(permits)
    .where(and(eq(permits.source, source), inArray(permits.permitNumber, numbers), gte(permits.detailsAt, since)));
  return rows.map(r => r.n);
}

export async function permitsHeld(db: Db, source: string, numbers: string[]): Promise<Loose[]> {
  if (!numbers.length) return [];
  const rows = await db.select().from(permits).where(and(eq(permits.source, source), inArray(permits.permitNumber, numbers)));
  return rows.map(r => ({
    _id: r.id, permitNumber: r.permitNumber, valuation: num(r.valuation), units: num(r.units),
    projectName: r.projectName, city: r.city, zip: r.zip, parcel: r.parcel
  }));
}

export async function fillPermits(db: Db, fills: { id: unknown; fill: Loose }[]): Promise<void> {
  await db.transaction(async tx => {
    for (const { id, fill } of fills) {
      const set: Loose = {};
      for (const [k, v] of Object.entries(fill)) set[k] = ['valuation', 'units', 'sqft'].includes(k) ? (num(v) == null ? null : String(num(v))) : v == null ? '' : String(v);
      if (Object.keys(set).length) await tx.update(permits).set(set).where(eq(permits.id, String(id)));
    }
  });
}

export async function contactsSeenSince(db: Db, since: Date): Promise<Loose[]> {
  const rows = await db.select({ c: permitContacts }).from(permitContacts)
    .innerJoin(permits, eq(permits.id, permitContacts.permitId))
    .where(gte(permits.lastSeenAt, since)).orderBy(asc(permitContacts.permitId), asc(permitContacts.position));
  return rows.map(({ c: { permitId: _p, position: _n, license, ...c } }) => ({ ...c, ...(license != null && { license }) }));
}

// ── runs ──
type RunRow = typeof permitRuns.$inferSelect;
const runDoc = ({ id, ...r }: RunRow): Loose => ({ _id: id, ...r });
const runRow = (doc: Loose) => permitsRows({ ...empty, permitRuns: [doc] } as never, []).permitRuns[0];
const BLANK_RUN = { finishedAt: null, ok: false, error: '', by: '', pages: 0, seen: 0, leads: 0, added: 0, updated: 0, detailErrors: 0, latestIssuedOn: null, unsortedTypes: [] };

export async function hasBackfillRun(db: Db, source: string): Promise<boolean> {
  const [r] = await db.select({ id: permitRuns.id }).from(permitRuns).where(and(eq(permitRuns.source, source), eq(permitRuns.ok, true), eq(permitRuns.kind, 'backfill'))).limit(1);
  return Boolean(r);
}
export async function startRun(db: Db, fields: Loose, id: string): Promise<Loose> {
  const row = runRow({ ...BLANK_RUN, ...withoutUndefined(fields), _id: id });
  await db.insert(permitRuns).values(row);
  const [saved] = await db.select().from(permitRuns).where(eq(permitRuns.id, id));
  return runDoc(saved);
}
export async function finishRun(db: Db, id: string, fields: Loose): Promise<Loose> {
  const [found] = await db.select().from(permitRuns).where(eq(permitRuns.id, id));
  const { id: _i, ...row } = runRow({ ...runDoc(found), ...fields });
  await db.update(permitRuns).set(row).where(eq(permitRuns.id, id));
  const [saved] = await db.select().from(permitRuns).where(eq(permitRuns.id, id));
  return runDoc(saved);
}
export async function failRun(db: Db, id: string, error: string, at: Date): Promise<Loose | null> {
  const [saved] = await db.update(permitRuns).set({ ok: false, finishedAt: at, error }).where(eq(permitRuns.id, id)).returning();
  return saved ? runDoc(saved) : null;
}
export async function firstBackfillRun(db: Db, source: string): Promise<Loose | null> {
  const [r] = await db.select().from(permitRuns).where(and(eq(permitRuns.source, source), eq(permitRuns.ok, true), eq(permitRuns.kind, 'backfill'))).orderBy(asc(permitRuns.startedAt)).limit(1);
  return r ? runDoc(r) : null;
}
export async function lastRun(db: Db, source: string, okOnly = false): Promise<Loose | null> {
  const [r] = await db.select().from(permitRuns).where(and(eq(permitRuns.source, source), okOnly ? eq(permitRuns.ok, true) : undefined)).orderBy(desc(permitRuns.startedAt)).limit(1);
  return r ? runDoc(r) : null;
}
export async function openRunExists(db: Db, startedAfter: Date, source?: string): Promise<boolean> {
  const [r] = await db.select({ id: permitRuns.id }).from(permitRuns)
    .where(and(source ? eq(permitRuns.source, source) : undefined, isNull(permitRuns.finishedAt), gt(permitRuns.startedAt, startedAfter))).limit(1);
  return Boolean(r);
}
export async function closeOpenRuns(db: Db, at: Date, error: string): Promise<number> {
  const rows = await db.update(permitRuns).set({ finishedAt: at, ok: false, error }).where(isNull(permitRuns.finishedAt)).returning({ id: permitRuns.id });
  return rows.length;
}

// ── checks ──
type CheckRow = typeof permitChecks.$inferSelect;
const checkDoc = ({ id, ...r }: CheckRow): Loose => ({ _id: id, ...r });
const checkRow = (doc: Loose) => permitsRows({ ...empty, permitChecks: [doc] } as never, []).permitChecks[0];

export async function reportCheckedMonths(db: Db, source: string): Promise<string[]> {
  const rows = await db.select({ m: permitChecks.month }).from(permitChecks).where(and(eq(permitChecks.source, source), eq(permitChecks.ok, true), ne(permitChecks.method, 'search')));
  return rows.map(r => r.m);
}
export async function saveCheck(db: Db, source: string, month: string, fields: Loose, id: string, keepReport: boolean): Promise<void> {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`permit_check:${source}:${month}`}))`);
    const [found] = await tx.select().from(permitChecks).where(and(eq(permitChecks.source, source), eq(permitChecks.month, month)));
    if (!found) {
      await tx.insert(permitChecks).values(checkRow({ _id: id, source, month, ...fields }));
      return;
    }
    if (keepReport && found.method === 'report') return; // a month-so-far check never goes over a report
    const { id: _i, ...row } = checkRow({ ...checkDoc(found), ...fields });
    await tx.update(permitChecks).set(row).where(eq(permitChecks.id, found.id));
  });
}

// ── the WA registry cache ──
type ContractorRow = typeof permitContractors.$inferSelect;
const contractorDoc = ({ id, ...r }: ContractorRow): Loose => ({ _id: id, ...r });
const contractorRow = (doc: Loose) => permitsRows({ ...empty, permitContractors: [doc] } as never, []).permitContractors[0];

export async function knownLicenses(db: Db, licenses: string[], since: Date): Promise<string[]> {
  if (!licenses.length) return [];
  const rows = await db.select({ l: permitContractors.license }).from(permitContractors).where(and(inArray(permitContractors.license, licenses), gte(permitContractors.refreshedAt, since)));
  return rows.map(r => r.l);
}
export async function knownNames(db: Db, names: string[], since: Date): Promise<string[]> {
  if (!names.length) return [];
  const rows = await db.select({ n: permitContractorNames.name }).from(permitContractorNames).where(and(inArray(permitContractorNames.name, names), gte(permitContractorNames.checkedAt, since)));
  return rows.map(r => r.n);
}
export async function upsertContractors(db: Db, items: { license: string; set: Loose }[], ids: string[]): Promise<void> {
  await db.transaction(async tx => {
    for (const [i, { license, set }] of items.entries()) {
      const [found] = await tx.select().from(permitContractors).where(eq(permitContractors.license, license));
      if (!found) { await tx.insert(permitContractors).values(contractorRow({ _id: ids[i], license, ...set })); continue; }
      const { id: _i, ...row } = contractorRow({ ...contractorDoc(found), ...set });
      await tx.update(permitContractors).set(row).where(eq(permitContractors.id, found.id));
    }
  });
}
export async function upsertContractorNames(db: Db, items: { name: string; license: string; candidates: number; checkedAt: Date }[], ids: string[]): Promise<void> {
  await db.transaction(async tx => {
    for (const [i, item] of items.entries()) {
      const rowOf = (_id: string) => permitsRows({ ...empty, permitContractorNames: [{ _id, ...item }] } as never, []).permitContractorNames[0];
      const [found] = await tx.select({ id: permitContractorNames.id }).from(permitContractorNames).where(eq(permitContractorNames.name, item.name));
      if (!found) { await tx.insert(permitContractorNames).values(rowOf(ids[i])); continue; }
      const { id: _i, ...row } = rowOf(found.id);
      await tx.update(permitContractorNames).set(row).where(eq(permitContractorNames.id, found.id));
    }
  });
}
export async function savedContractor(db: Db, license: string): Promise<Loose | null> {
  const [r] = await db.select().from(permitContractors).where(and(eq(permitContractors.license, license), eq(permitContractors.notFound, false)));
  return r ? contractorDoc(r) : null;
}
export async function namesForLicense(db: Db, license: string): Promise<string[]> {
  const rows = await db.select({ n: permitContractorNames.name }).from(permitContractorNames).where(eq(permitContractorNames.license, license)).orderBy(asc(permitContractorNames.name));
  return rows.map(r => r.n);
}
export async function namedLicenses(db: Db, names: string[]): Promise<{ name: string; license: string }[]> {
  if (!names.length) return [];
  return db.select({ name: permitContractorNames.name, license: permitContractorNames.license }).from(permitContractorNames)
    .where(and(inArray(permitContractorNames.name, names), ne(permitContractorNames.license, '')));
}
export async function contractorsByLicense(db: Db, licenses: string[]): Promise<Loose[]> {
  if (!licenses.length) return [];
  const rows = await db.select().from(permitContractors).where(and(inArray(permitContractors.license, licenses), eq(permitContractors.notFound, false)));
  return rows.map(contractorDoc);
}
