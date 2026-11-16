/**
 * Permits' pull and registry-cache writes (src/permits/sync.ts, contractors.ts, syncOnLambda.ts): each call picks MongoDB or
 * Postgres by the area's switch (`DB_PERMITS`, src/db/appDb.ts). Both answer the same (permits.writes.parity.test.ts).
 * A new row's id is made here and handed to whichever database saves it.
 */
import { appDb, areaOn } from '../appDb.ts';
import { newId } from '../ids.ts';
import * as mongo from './writesMongo.ts';
import * as pg from './writesPostgres.ts';
import type { Loose } from '../../types/records.ts';

const onPostgres = () => areaOn('permits') === 'postgres';
const idsFor = (n: number) => Array.from({ length: n }, () => newId());

// permits
/** One source's permits saved by number, a permit and its contacts together. Answers how many were new and how many changed. */
export async function savePermits(source: string, permits: Loose[], { at, detailsRead = false }: { at: Date; detailsRead?: boolean }): Promise<{ added: number; updated: number }> {
  if (!permits.length) return { added: 0, updated: 0 };
  const ids = idsFor(permits.length);
  return onPostgres() ? pg.savePermits(await appDb(), source, permits, ids, at, detailsRead) : mongo.savePermits(source, permits, ids, at, detailsRead);
}
export async function syncPermitNumbers(source: string, where: { issuedFrom?: string; issuedTo?: string; among?: string[] } = {}): Promise<string[]> {
  return onPostgres() ? pg.permitNumbers(await appDb(), source, where) : mongo.permitNumbers(source, where);
}
export async function syncPermitNumbersDetailedSince(source: string, numbers: string[], since: Date): Promise<string[]> {
  return onPostgres() ? pg.permitNumbersDetailedSince(await appDb(), source, numbers, since) : mongo.permitNumbersDetailedSince(source, numbers, since);
}
export async function syncPermitsHeld(source: string, numbers: string[]): Promise<Loose[]> {
  return onPostgres() ? pg.permitsHeld(await appDb(), source, numbers) : mongo.permitsHeld(source, numbers);
}
export async function syncFillPermits(fills: { id: unknown; fill: Loose }[]): Promise<void> {
  if (!fills.length) return;
  return onPostgres() ? pg.fillPermits(await appDb(), fills) : mongo.fillPermits(fills);
}
export async function syncContactsSeenSince(since: Date): Promise<Loose[]> {
  return onPostgres() ? pg.contactsSeenSince(await appDb(), since) : mongo.contactsSeenSince(since);
}

// runs
export async function syncHasBackfillRun(source: string): Promise<boolean> {
  return onPostgres() ? pg.hasBackfillRun(await appDb(), source) : mongo.hasBackfillRun(source);
}
export async function syncStartRun(fields: Loose): Promise<Loose> {
  const id = newId();
  return onPostgres() ? pg.startRun(await appDb(), fields, id) : mongo.startRun(fields, id);
}
export async function syncFinishRun(id: unknown, fields: Loose): Promise<Loose> {
  return onPostgres() ? pg.finishRun(await appDb(), String(id), fields) : mongo.finishRun(String(id), fields);
}
export async function syncFailRun(id: unknown, error: string, at: Date): Promise<Loose | null> {
  return onPostgres() ? pg.failRun(await appDb(), String(id), error, at) : mongo.failRun(String(id), error, at);
}
export async function syncFirstBackfillRun(source: string): Promise<Loose | null> {
  return onPostgres() ? pg.firstBackfillRun(await appDb(), source) : mongo.firstBackfillRun(source);
}
export async function syncLastRun(source: string, okOnly = false): Promise<Loose | null> {
  return onPostgres() ? pg.lastRun(await appDb(), source, okOnly) : mongo.lastRun(source, okOnly);
}
/** A pull still open (no finish) that started after `startedAfter`; of one source, or of any. */
export async function syncOpenRunExists(startedAfter: Date, source?: string): Promise<boolean> {
  return onPostgres() ? pg.openRunExists(await appDb(), startedAfter, source) : mongo.openRunExists(startedAfter, source);
}
export async function syncCloseOpenRuns(at: Date, error: string): Promise<number> {
  return onPostgres() ? pg.closeOpenRuns(await appDb(), at, error) : mongo.closeOpenRuns(at, error);
}

// checks
export async function syncReportCheckedMonths(source: string): Promise<string[]> {
  return onPostgres() ? pg.reportCheckedMonths(await appDb(), source) : mongo.reportCheckedMonths(source);
}
/** Saves a month's check for a source. `keepReport`: the month-so-far check never goes over a report check. */
export async function syncSaveCheck(source: string, month: string, fields: Loose, { keepReport = false }: { keepReport?: boolean } = {}): Promise<void> {
  const id = newId();
  return onPostgres() ? pg.saveCheck(await appDb(), source, month, fields, id, keepReport) : mongo.saveCheck(source, month, fields, id, keepReport);
}

// the WA registry cache
export async function registryKnownLicenses(licenses: string[], since: Date): Promise<string[]> {
  return onPostgres() ? pg.knownLicenses(await appDb(), licenses, since) : mongo.knownLicenses(licenses, since);
}
export async function registryKnownNames(names: string[], since: Date): Promise<string[]> {
  return onPostgres() ? pg.knownNames(await appDb(), names, since) : mongo.knownNames(names, since);
}
export async function registryUpsertContractors(items: { license: string; set: Loose }[]): Promise<void> {
  if (!items.length) return;
  const ids = idsFor(items.length);
  return onPostgres() ? pg.upsertContractors(await appDb(), items, ids) : mongo.upsertContractors(items, ids);
}
export async function registryUpsertNames(items: { name: string; license: string; candidates: number; checkedAt: Date }[]): Promise<void> {
  if (!items.length) return;
  const ids = idsFor(items.length);
  return onPostgres() ? pg.upsertContractorNames(await appDb(), items, ids) : mongo.upsertContractorNames(items, ids);
}
export async function registrySavedContractor(license: string): Promise<Loose | null> {
  return onPostgres() ? pg.savedContractor(await appDb(), license) : mongo.savedContractor(license);
}
export async function registryNamesForLicense(license: string): Promise<string[]> {
  return onPostgres() ? pg.namesForLicense(await appDb(), license) : mongo.namesForLicense(license);
}
export async function registryNamedLicenses(names: string[]): Promise<{ name: string; license: string }[]> {
  return onPostgres() ? pg.namedLicenses(await appDb(), names) : mongo.namedLicenses(names);
}
export async function registryContractorsByLicense(licenses: string[]): Promise<Loose[]> {
  return onPostgres() ? pg.contractorsByLicense(await appDb(), licenses) : mongo.contractorsByLicense(licenses);
}
