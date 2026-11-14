/** Daily Reports on MongoDB — the routes' own Mongoose calls, moved here unchanged. */
import DailyReport from '../../models/DailyReport.ts';
import type { LogEntry } from '../../utils/dailyReportLog.ts';
import type { Loose } from '../../types/records.ts';
import type { LeanReport } from './index.ts';

type Document = InstanceType<typeof DailyReport>;

export const find = (date: string, location: string): Promise<Document | null> => DailyReport.findOne({ date, location });

export const findLean = (date: string, location: string, fields?: string) =>
  DailyReport.findOne({ date, location }, fields).lean() as unknown as Promise<LeanReport | null>;

export const onDay = (date: string, locations: readonly string[]): Promise<Document[]> =>
  DailyReport.find({ date, location: { $in: [...locations] } });

export const inMonth = (locations: readonly string[], month: string, order: 'newest' | 'branch') =>
  DailyReport.find({ location: { $in: [...locations] }, date: { $regex: `^${month}-` } })
    .sort(order === 'newest' ? { date: -1 } : { location: 1, date: 1 }).lean() as unknown as Promise<LeanReport[]>;

export const statuses = (location: string, dates: string[]) =>
  DailyReport.find({ location, date: { $in: dates } }, 'date status').lean() as unknown as Promise<{ date: string; status: string }[]>;

export const recentContainers = (locations: readonly string[], limit: number) =>
  DailyReport.find({ location: { $in: [...locations] } }, 'containers.poNumber containers.slabs')
    .sort({ date: -1 }).limit(limit).lean() as unknown as Promise<Loose[]>;

export const submittedOn = (pairs: { location: string; date: string }[]) =>
  DailyReport.find(
    { status: 'submitted', $or: pairs.map(p => ({ location: p.location, date: p.date })) },
    'date location submittedAt submittedBy autoSubmitted'
  ).lean() as unknown as Promise<Loose[]>;

export const dayStatus = (location: string, date: string) =>
  DailyReport.findOne({ location, date }, 'status submittedBy submittedAt autoSubmitted').lean() as unknown as Promise<Loose | null>;

export const isSubmitted = async (location: string, date: string) =>
  Boolean(await DailyReport.exists({ location, date, status: 'submitted' }));

export async function claim(report: Loose, log: LogEntry[]): Promise<Document | null> {
  const payload = report.toObject();
  // _id can't move and shouldn't be restated in $set; __v is left for Mongo;
  // the log is only ever pushed to.
  delete payload._id;
  delete payload.__v;
  delete payload.log;
  return DailyReport.findOneAndUpdate(
    { _id: report._id, status: 'draft' },
    { $set: payload, $push: { log: { $each: log } } },
    { returnDocument: 'after' }
  );
}

export async function writeDraft(date: string, location: string, update: Loose): Promise<Document | null> {
  try {
    return await DailyReport.findOneAndUpdate(
      { date, location, status: { $ne: 'submitted' } },
      { $set: update },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) return null;
    throw error;
  }
}

export async function save(report: Document): Promise<void> { await report.save(); }

/** A report that doesn't exist yet, saved: null when someone created the day meanwhile. */
export async function insert(report: Document): Promise<Document | null> {
  try {
    return await report.save();
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) return null;
    throw error;
  }
}

export const pushLog = (date: string, location: string, entry: LogEntry) =>
  DailyReport.updateOne({ date, location }, { $push: { log: entry } });

/** Add a transfer line (and its log line) to a SUBMITTED report that doesn't list the ticket yet. */
export async function addTransferIfSubmitted(date: string, location: string, ticketId: string, line: Loose, entry: LogEntry): Promise<boolean> {
  const result = await DailyReport.updateOne(
    { date, location, status: 'submitted', 'transfers.ticketIds': { $ne: ticketId } },
    { $push: { transfers: line, log: entry } }
  );
  return Boolean(result.modifiedCount);
}

/** This branch's drafts to look at for the 11:59 PM job: the listed days, or any earlier reopened one. */
export const draftCandidates = (location: string, dates: string[], today: string): Promise<Document[]> =>
  DailyReport.find({
    location,
    status: 'draft',
    $or: [{ date: { $in: dates } }, { reopenedAt: { $ne: null }, date: { $lt: today } }]
  });

export const existingDates = async (location: string, dates: string[]) =>
  (await DailyReport.find({ location, date: { $in: dates } }, 'date').lean()).map(r => r.date as string);
