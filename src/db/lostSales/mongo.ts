/** Lost sales on MongoDB — the routes' own Mongoose calls, moved here unchanged. */
import LostSale from '../../models/LostSale.ts';
import type { Loose } from '../../types/records.ts';

/** Branches a person is assigned ('*' = all). A record with no location is shown to everyone rather than to no one. */
const visibleTo = (assigned: readonly string[]) => (assigned.includes('*') ? {}
  : { $or: [{ location: { $in: [...assigned, ''] } }, { location: null }, { location: { $exists: false } }] });

export async function listLostSales(assigned: readonly string[]): Promise<Loose[]> {
  return LostSale.find(visibleTo(assigned)).sort({ date: -1, createdAt: -1 }).lean() as unknown as Promise<Loose[]>;
}

export async function createLostSale(doc: Loose): Promise<Loose> {
  const lostSale = new LostSale(doc);
  await lostSale.save();
  return lostSale.toObject() as unknown as Loose;
}

/** Update one record this person can see; null when it is missing or at another branch. Validators run. */
export async function updateLostSale(id: string, assigned: readonly string[], set: Loose): Promise<Loose | null> {
  return LostSale.findOneAndUpdate({ _id: id, ...visibleTo(assigned) }, set, { new: true, runValidators: true }).lean() as unknown as Promise<Loose | null>;
}

export async function deleteLostSale(id: string, assigned: readonly string[]): Promise<boolean> {
  return Boolean(await LostSale.findOneAndDelete({ _id: id, ...visibleTo(assigned) }));
}
