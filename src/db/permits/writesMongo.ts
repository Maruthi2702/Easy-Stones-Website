/**
 * Permits' pull and registry-cache calls on MongoDB: the Mongoose calls src/permits/sync.ts, contractors.ts and
 * syncOnLambda.ts used to make, moved here unchanged (2026-11-15). `writesPostgres.ts` answers the same.
 * A new row's id is made by the caller (writes.ts) and handed in, so both databases can hold the same one.
 */
import { Permit, PermitRun, PermitCheck, Contractor, ContractorName } from '../../permits/models.ts';
import type { Loose } from '../../types/records.ts';

const withoutUndefined = (o: Loose) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ── permits ──
/** One source's permits saved by number in one batch: how many were new and how many the source actually changed. */
export async function savePermits(source: string, permits: Loose[], ids: string[], at: Date, detailsRead: boolean) {
  const r = await Permit.bulkWrite(permits.map((p, i) => {
    // `categoryIfNew`: a category only for a permit the app doesn't hold yet.
    const { permitNumber, source: _source, categoryIfNew, ...fields } = withoutUndefined(p);
    const onInsert = { _id: ids[i], firstSeenAt: at, ...(categoryIfNew && !fields.category && { category: categoryIfNew }) };
    return { updateOne: { filter: { source, permitNumber }, update: { $set: fields, $setOnInsert: onInsert }, upsert: true } };
  }) as never, { ordered: false });
  await Permit.updateMany(
    { source, permitNumber: { $in: permits.map(p => p.permitNumber) } },
    { $set: { lastSeenAt: at, ...(detailsRead && { detailsAt: at }) } }
  );
  return { added: r.upsertedCount, updated: r.modifiedCount };
}

/** Permit numbers of a source: issued in a window, among a list, or all. */
export async function permitNumbers(source: string, where: { issuedFrom?: string; issuedTo?: string; among?: string[] } = {}): Promise<string[]> {
  const q: Loose = { source };
  if (where.issuedFrom || where.issuedTo) q.issuedOn = { ...(where.issuedFrom && { $gte: where.issuedFrom }), ...(where.issuedTo && { $lte: where.issuedTo }) };
  if (where.among) q.permitNumber = { $in: where.among };
  return Permit.distinct('permitNumber', q);
}

/** Of these numbers, the ones whose details were read on or after `since`. */
export async function permitNumbersDetailedSince(source: string, numbers: string[], since: Date): Promise<string[]> {
  return Permit.distinct('permitNumber', { source, permitNumber: { $in: numbers }, detailsAt: { $gte: since } });
}

/** The permits a source holds under these numbers, with the fields a King County report can fill. */
export async function permitsHeld(source: string, numbers: string[]): Promise<Loose[]> {
  return Permit.find({ source, permitNumber: { $in: numbers } }, 'permitNumber valuation units projectName city zip parcel').lean();
}

/** Sets only the given fields on each permit (by its id). */
export async function fillPermits(fills: { id: unknown; fill: Loose }[]): Promise<void> {
  await Permit.bulkWrite(fills.map(({ id, fill }) => ({ updateOne: { filter: { _id: id }, update: { $set: fill } } })) as never, { ordered: false });
}

/** The contacts of every permit the pull saw since `since`. */
export async function contactsSeenSince(since: Date): Promise<Loose[]> {
  const seen = await Permit.find({ lastSeenAt: { $gte: since } }, 'contacts').lean();
  return seen.flatMap(p => p.contacts || []);
}

// ── runs ──
export async function hasBackfillRun(source: string): Promise<boolean> {
  return Boolean(await PermitRun.exists({ source, ok: true, kind: 'backfill' }));
}
export async function startRun(fields: Loose, id: string): Promise<Loose> {
  const run = await PermitRun.create({ _id: id, ...fields });
  return run.toObject();
}
export async function finishRun(id: string, fields: Loose): Promise<Loose> {
  const run = await PermitRun.findById(id);
  Object.assign(run!, fields);
  await run!.save();
  return run!.toObject();
}
/** Written directly, so a run that failed while saving its own counts is still closed. Answers the run, or null. */
export async function failRun(id: string, error: string, at: Date): Promise<Loose | null> {
  await PermitRun.updateOne({ _id: id }, { $set: { ok: false, finishedAt: at, error } });
  return PermitRun.findById(id).lean();
}
export async function firstBackfillRun(source: string): Promise<Loose | null> {
  return PermitRun.findOne({ source, ok: true, kind: 'backfill' }).sort({ startedAt: 1 }).lean();
}
export async function lastRun(source: string, okOnly = false): Promise<Loose | null> {
  return PermitRun.findOne({ source, ...(okOnly && { ok: true }) }).sort({ startedAt: -1 }).lean();
}
/** A pull still open (no finish) that started after `startedAfter`; one source, or any. */
export async function openRunExists(startedAfter: Date, source?: string): Promise<boolean> {
  return Boolean(await PermitRun.exists({ ...(source && { source }), finishedAt: null, startedAt: { $gt: startedAfter } }));
}
/** Closes every pull still open (cut short by a restart). Answers how many. */
export async function closeOpenRuns(at: Date, error: string): Promise<number> {
  const r = await PermitRun.updateMany({ finishedAt: null }, { $set: { finishedAt: at, ok: false, error } });
  return r.modifiedCount;
}

// ── checks ──
/** Months of a source with a clean check against a report (a month-so-far 'search' check doesn't count). */
export async function reportCheckedMonths(source: string): Promise<string[]> {
  return (await PermitCheck.find({ source, ok: true, method: { $ne: 'search' } }, 'month').lean()).map(c => c.month);
}
/** Saves a month's check. `keepReport`: never over a report check (the month-so-far one). */
export async function saveCheck(source: string, month: string, fields: Loose, id: string, keepReport: boolean): Promise<void> {
  if (!keepReport) {
    await PermitCheck.findOneAndUpdate({ source, month }, { $set: fields, $setOnInsert: { _id: id } }, { upsert: true });
    return;
  }
  await PermitCheck.findOneAndUpdate({ source, month, method: { $ne: 'report' } }, { $set: fields, $setOnInsert: { _id: id } }, { upsert: true }).catch(err => {
    if (err?.code !== 11000) throw err;
  });
}

// ── the WA registry cache ──
export async function knownLicenses(licenses: string[], since: Date): Promise<string[]> {
  return Contractor.distinct('license', { license: { $in: licenses }, refreshedAt: { $gte: since } });
}
export async function knownNames(names: string[], since: Date): Promise<string[]> {
  return ContractorName.distinct('name', { name: { $in: names }, checkedAt: { $gte: since } });
}
/** Sets these fields on each license's record, adding it if new. */
export async function upsertContractors(items: { license: string; set: Loose }[], ids: string[]): Promise<void> {
  await Contractor.bulkWrite(items.map(({ license, set }, i) => ({
    updateOne: { filter: { license }, update: { $set: set, $setOnInsert: { _id: ids[i] } }, upsert: true }
  })) as never, { ordered: false });
}
export async function upsertContractorNames(items: { name: string; license: string; candidates: number; checkedAt: Date }[], ids: string[]): Promise<void> {
  await ContractorName.bulkWrite(items.map(({ name, license, candidates, checkedAt }, i) => ({
    updateOne: { filter: { name }, update: { $set: { name, license, candidates, checkedAt }, $setOnInsert: { _id: ids[i] } }, upsert: true }
  })) as never, { ordered: false });
}
/** The saved record of a license that was found in the registry, or null. */
export async function savedContractor(license: string): Promise<Loose | null> {
  return Contractor.findOne({ license, notFound: { $ne: true } }).lean();
}
export async function namesForLicense(license: string): Promise<string[]> {
  return ContractorName.distinct('name', { license });
}
/** Names that matched one active license: { name, license }. */
export async function namedLicenses(names: string[]): Promise<{ name: string; license: string }[]> {
  return ContractorName.find({ name: { $in: names }, license: { $ne: '' } }, 'name license').lean();
}
export async function contractorsByLicense(licenses: string[]): Promise<Loose[]> {
  return Contractor.find({ license: { $in: licenses }, notFound: { $ne: true } }).lean();
}
