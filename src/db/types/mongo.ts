/** The type lists on MongoDB: the router's own logic from before DB_TYPES, moved here unchanged. */
import mongoose from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import type { Loose } from '../../types/records.ts';
import type { TypeStore, RemoveResult } from './store.ts';

export interface MongoTypeOptions {
  Model: Model<never>;
  /** How many records carry this stored name. */
  countUses: (name: string) => Promise<number>;
  /** Moves every record from one stored name to another; returns how many moved. */
  replaceUses: (from: string, to: string, session: ClientSession) => Promise<number>;
  /** Resource Types: recounts the customers holding the type (src/services/modaCount.ts), in the edit's transaction. */
  onFamilyChange?: (name: string, from: string | undefined, to: string | undefined, session: ClientSession) => Promise<number>;
  /** Resource Types: the families list. */
  families?: () => Promise<{ name: string; active?: boolean }[]>;
}

const ok = (id: string) => mongoose.isValidObjectId(id);

export function mongoTypeStore(o: MongoTypeOptions): TypeStore {
  const Model = o.Model as unknown as Model<Loose>;
  return {
    list: async () => Model.find({}).sort({ order: 1, createdAt: 1 }).lean() as unknown as Promise<Loose[]>,
    byId: async id => (ok(id) ? (await Model.findById(id).lean()) as Loose | null : null),

    async add(id, value, order, by) {
      const doc = new Model({ ...value, _id: id, name: value.label, order, updatedBy: by });
      try {
        await doc.save();
      } catch (error) {
        if ((error as { code?: number })?.code === 11000) return { duplicate: true };
        throw error;
      }
      return { type: doc.toObject() as Loose };
    },

    async reorder(ids, by) {
      await Model.bulkWrite(ids.map((id, order) => ({ updateOne: { filter: { _id: id }, update: { $set: { order, updatedBy: by } } } })) as never);
      return Model.find({}).sort({ order: 1 }).lean() as unknown as Promise<Loose[]>;
    },

    async edit(id, value, by) {
      if (!ok(id)) return null;
      const doc = await Model.findById(id);
      if (!doc) return null;
      const fromFamily = doc.family as string | undefined;
      const toFamily = value.family as string | undefined;
      Object.assign(doc, value, { updatedBy: by });
      if (o.onFamilyChange && toFamily !== undefined && toFamily !== fromFamily) {
        const recounted = await mongoose.connection.transaction(async session => {
          const n = await o.onFamilyChange!(doc.name as string, fromFamily, toFamily, session);
          await doc.save({ session });
          return n;
        });
        return { type: doc.toObject() as Loose, recounted };
      }
      await doc.save();
      return { type: doc.toObject() as Loose };
    },

    async uses(id) {
      if (!ok(id)) return null;
      const doc = await Model.findById(id).select('name').lean();
      return doc ? o.countUses(doc.name as string) : null;
    },

    async remove(doc, target): Promise<RemoveResult> {
      return mongoose.connection.transaction(async session => {
        // Counted inside so a record saved since the check is moved too, or stops the delete.
        const uses = await o.countUses(doc.name);
        if (uses > 0 && !target) return { status: 'uses' as const, uses, moved: 0 };
        const moved = uses > 0 && target ? await o.replaceUses(doc.name, target.name, session) : 0;
        await Model.deleteOne({ _id: doc._id }, { session });
        return { status: 'ok' as const, uses, moved };
      });
    },

    families: async () => (o.families ? o.families() : [])
  };
}
