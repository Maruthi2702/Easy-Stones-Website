/** Staff sign-in and role reads on MongoDB: what server.ts's `authenticate` did, unchanged. */
import mongoose from 'mongoose';
import User from '../../models/User.ts';
import Role from '../../models/Role.ts';
import type { Loose } from '../../types/records.ts';

/** One round trip: the user's named fields and their role's permissions (the old pipeline). */
export async function authIdentity(userId: string): Promise<Loose | null> {
  if (!mongoose.isValidObjectId(userId) || String(userId).length !== 24) return null;
  const [doc] = await User.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(userId) } },
    { $limit: 1 },
    // Role.name is stored trimmed + lower-cased; aggregation does no casting, so normalise here.
    { $addFields: { _roleKey: { $toLower: { $trim: { input: { $ifNull: ['$role', ''] } } } } } },
    { $lookup: { from: Role.collection.name, localField: '_roleKey', foreignField: 'name', as: '_role' } },
    {
      $project: {
        username: 1, displayName: 1, email: 1, role: 1, assignedLocations: 1, location: 1,
        routePlannerFilters: 1, pinnedTabs: 1, isActive: 1, mustChangePassword: 1, sessionVersion: 1,
        permissions: { $ifNull: [{ $arrayElemAt: ['$_role.permissions', 0] }, []] }
      }
    }
  ] as mongoose.PipelineStage[]);
  return doc ?? null;
}

export async function roleByName(name: string): Promise<Loose | null> {
  return (await Role.findOne({ name: name.trim().toLowerCase() }).lean()) as Loose | null;
}

export async function rolesList(): Promise<Loose[]> {
  return (await Role.find().sort({ name: 1 }).lean()) as Loose[];
}
