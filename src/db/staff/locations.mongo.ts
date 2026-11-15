/** Locations on MongoDB: what server.ts's location routes did, moved here unchanged. */
import mongoose from 'mongoose';
import Location from '../../models/Location.ts';
import type { Loose } from '../../types/records.ts';

export type Geocoder = (doc: Loose) => Promise<void>;
export type SaveResult = { ok: true; location: Loose } | { ok: false; duplicate: true };

const plain = (d: unknown) => d as Loose;

export const locationsList = async () => (await Location.find().sort({ name: 1 }).lean()) as Loose[];
export const locationNames = async () => (await Location.find().select('name').sort({ name: 1 }).lean()).map(l => String(l.name));
export const locationBriefs = async () => (await Location.find({}, { name: 1, shortCode: 1 }).lean()) as Loose[];
export const locationByName = async (name: string) => (await Location.findOne({ name }).lean()) as Loose | null;
export async function locationByNameAnyCase(name: string): Promise<Loose | null> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (await Location.findOne({ name: { $regex: new RegExp(`^${escaped}$`, 'i') } }).lean()) as Loose | null;
}
/** The Delivery Schedule's column order for a branch; null when there is no such branch. */
export async function setDeliveryColumns(name: string, columns: string[]): Promise<{ name: string; deliveryColumns: string[] } | null> {
  const l = await Location.findOneAndUpdate({ name }, { $set: { deliveryColumns: columns } }, { new: true, projection: { name: 1, deliveryColumns: 1 } }).lean();
  return l ? { name: String(l.name), deliveryColumns: (l.deliveryColumns as string[]) || [] } : null;
}
export async function locationById(id: string): Promise<Loose | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  return (await Location.findById(id).lean()) as Loose | null;
}

export async function createLocation(id: string, record: Loose, by: string, geocode: Geocoder): Promise<SaveResult> {
  const location = new Location({ ...record, _id: id, editedBy: by, editedAt: new Date() });
  await geocode(location as unknown as Loose);
  try {
    await location.save();
  } catch (err) {
    // Two people adding the same short name at once — the unique index wins.
    if ((err as Error & Loose)?.code === 11000) return { ok: false, duplicate: true };
    throw err;
  }
  return { ok: true, location: plain(location.toJSON()) };
}

export async function updateLocation(id: string, record: Loose, by: string, geocode: Geocoder): Promise<Loose | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const location = await Location.findById(id);
  if (!location) return null;
  location.set({ ...record, editedBy: by, editedAt: new Date() });
  await geocode(location as unknown as Loose);
  await location.save();
  return plain(location.toJSON());
}

/** Deletes it and clears every other branch's RDC that named it; false when it isn't there. */
export async function deleteLocation(id: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const location = await Location.findById(id);
  if (!location) return false;
  await Location.findByIdAndDelete(id);
  await Location.updateMany({ rdc: location.name }, { $set: { rdc: '' } });
  return true;
}
