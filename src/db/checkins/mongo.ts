/** Check-ins on MongoDB — the route's own Mongoose calls, moved here unchanged. */
import OfficeCheckIn from '../../models/OfficeCheckIn.ts';
import type { Loose } from '../../types/records.ts';

type Document = InstanceType<typeof OfficeCheckIn>;

export const count = (filter: Loose | undefined) => OfficeCheckIn.countDocuments(filter);

/** Newest first; a page of them, or the first `limit`. */
export const list = (filter: Loose | undefined, skip: number, limit: number) =>
  OfficeCheckIn.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean() as unknown as Promise<Loose[]>;

/** The newest check-in matching, with only the fields asked for. */
export const newest = (filter: Loose | undefined, fields?: string) =>
  OfficeCheckIn.findOne(filter, fields).sort({ createdAt: -1 }).lean() as unknown as Promise<Loose | null>;

export const find = (id: string): Promise<Document | null> => OfficeCheckIn.findById(id);

export async function create(data: Loose): Promise<Document> {
  const checkIn = new OfficeCheckIn(data);
  await checkIn.save();
  return checkIn;
}

export async function save(checkIn: Document): Promise<void> { await checkIn.save(); }

export async function remove(id: string): Promise<void> { await OfficeCheckIn.findByIdAndDelete(id); }
