/** Team Files (the Dashboard's shared folders, files and links) on MongoDB: server.ts's own Mongoose calls, moved here. */
import mongoose from 'mongoose';
import SalesDashboardResource from '../../models/SalesDashboardResource.ts';
import type { Loose } from '../../types/records.ts';

export const list = async (parentId: string | null): Promise<Loose[]> =>
  SalesDashboardResource.find(parentId ? { parentId } : { parentId: null }).select('-content').populate('uploadedBy', 'username').sort({ isFolder: -1, createdAt: -1 });

export const get = async (id: string): Promise<Loose | null> => SalesDashboardResource.findById(id).populate('uploadedBy', 'username');

export async function create(fields: Loose, _id: string): Promise<Loose> {
  const doc = new SalesDashboardResource({ _id, ...fields });
  await doc.save();
  await doc.populate('uploadedBy', 'username');
  return doc;
}

/** `patch` holds only what changes; `parentId: null` moves to the top. Answers the saved record (uploadedBy left as an id). */
export async function update(id: string, patch: Loose): Promise<Loose | null> {
  const doc = await SalesDashboardResource.findById(id);
  if (!doc) return null;
  const { uploadedBy, ...rest } = patch;
  Object.assign(doc, rest);
  if (uploadedBy) doc.uploadedBy = new mongoose.Types.ObjectId(uploadedBy);
  await doc.save();
  return doc;
}

/** Remove an item and, for a folder, everything under it. Answers every removed record's content (disk paths and links). */
export async function removeTree(id: string): Promise<string[]> {
  const contents: string[] = [];
  const walk = async (folderId: unknown) => {
    const children: Loose[] = await SalesDashboardResource.find({ parentId: folderId as never });
    for (const child of children) {
      if (child.isFolder) await walk(child._id);
      else if (child.content) contents.push(child.content);
      await SalesDashboardResource.findByIdAndDelete(child._id);
    }
  };
  const item: Loose | null = await SalesDashboardResource.findById(id);
  if (!item) return contents;
  if (item.isFolder) await walk(id);
  else if (item.content) contents.push(item.content);
  await SalesDashboardResource.findByIdAndDelete(id);
  return contents;
}
