/** App settings on MongoDB — the nav-order route's own Mongoose calls, moved here unchanged. */
import AppSetting from '../../models/AppSetting.ts';

export async function readSetting(key: string): Promise<unknown> {
  const doc = await AppSetting.findOne({ key }).lean();
  return doc?.value;
}

/** A new setting takes the id the layer made (so both databases hold the same one); an existing one keeps its own. */
export async function writeSetting(key: string, value: unknown, by: string, _id: string): Promise<void> {
  await AppSetting.findOneAndUpdate({ key }, { $set: { value, updatedBy: by }, $setOnInsert: { _id } }, { upsert: true });
}

export async function removeSetting(key: string): Promise<void> {
  await AppSetting.deleteOne({ key });
}
