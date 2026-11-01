import express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import mongoose from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import { validateTypeBody, reorderedIds } from '../utils/typeLists.ts';
import type { TypeKind, TypeLike } from '../utils/typeLists.ts';
import { PlacementConflict } from '../services/resourcePlacement.ts';
import type { Loose } from '../types/records.ts';

/**
 * The two admin-managed lists, Visit Types and Resource Types (one router per
 * list, built here). The database is the only source: the forms, filters and
 * the server's own checks all read it.
 *
 *   GET    /            → { types }   every staff login that can open a Sales page;
 *                         hidden ones included (`active: false`) — screens decide
 *   POST   /            add (needs the list's Add action)
 *   PUT    /:id         rename, family / fields, hide or show (Edit)
 *   PATCH  /reorder     { ids } the whole list in its new order (Reorder)
 *   GET    /:id/uses    { uses } how many records carry it (Delete), so the
 *                       delete check can ask where they go before it's pressed
 *   DELETE /:id         never a starting one (Delete). A type records use needs
 *                       { replaceWith: <id of a shown type> }: they move to it
 *                       and the type goes, in one transaction; without it, 409
 *
 *   app.use('/api/visit-types', createTypeListRouter({ kind: 'visit', Model: VisitType, … }));
 */
const stored = (doc: Loose) => ({
  _id: String(doc._id),
  name: doc.name,
  label: doc.label,
  order: doc.order,
  active: doc.active !== false,
  system: Boolean(doc.system),
  ...(doc.fields ? { fields: { notes: doc.fields.notes, outcome: doc.fields.outcome, followUp: doc.fields.followUp } } : {}),
  ...(doc.family ? { family: doc.family } : {})
});

type StaffRequest = Request & { user?: Loose; userId?: string };
type Options = {
  kind: TypeKind;
  Model: Model<Loose>;
  /** How many records carry this stored name. */
  countUses: (name: string) => Promise<number>;
  /** Moves every record from one stored name to another; returns how many moved. */
  replaceUses: (from: string, to: string, session: ClientSession) => Promise<number>;
  /**
   * Resource Types: a family change recounts the customers holding the type
   * (src/services/modaCount.ts), in the same transaction as the save. Returns
   * how many customers were recounted.
   */
  onFamilyChange?: (name: string, from: string | undefined, to: string | undefined, session: ClientSession) => Promise<number>;
  /** The list's Users & Roles keys. */
  actions: { add: string; edit: string; reorder: string; delete: string };
  /** Staff who can open a Sales page. */
  authenticate: RequestHandler | RequestHandler[];
  requireAction: (key: string) => RequestHandler;
};

export default function createTypeListRouter({ kind, Model, countUses, replaceUses, onFamilyChange, actions, authenticate, requireAction }: Options) {
  const router = express.Router();
  const noun = kind === 'visit' ? 'visit type' : 'resource type';
  const records = (n: number) => `${n} ${kind === 'visit' ? (n === 1 ? 'visit' : 'visits') : (n === 1 ? 'resource' : 'resources')}`;
  const who = (req: StaffRequest) => String(req.user?.username || req.userId || '');

  router.get('/', authenticate, async (_req: Request, res: Response) => {
    try {
      const docs = await Model.find({}).sort({ order: 1, createdAt: 1 }).lean();
      res.json({ types: docs.map((d: Loose) => stored(d)) });
    } catch (error) {
      console.error(`Get ${noun}s error:`, error);
      res.status(500).json({ message: `Failed to load the ${noun}s` });
    }
  });

  router.post('/', authenticate, requireAction(actions.add), async (req: StaffRequest, res: Response) => {
    try {
      const all = await Model.find({}).select('name label order').lean();
      const checked = validateTypeBody(kind, { ...req.body, label: req.body?.label ?? req.body?.name }, all as TypeLike[]);
      if (checked.error !== undefined) return res.status(400).json({ message: checked.error });
      const value = checked.value;
      if (!value.label) return res.status(400).json({ message: 'Enter a name.' });
      // New types go to the bottom; a manager moves them where they want.
      const order = all.reduce((max: number, t: Loose) => Math.max(max, Number(t.order ?? 0)), -1) + 1;
      const doc = await Model.create({ ...value, name: value.label, order, updatedBy: who(req) });
      res.status(201).json({ type: stored(doc.toObject()) });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) return res.status(400).json({ message: 'There is already a type with that name.' });
      console.error(`Add ${noun} error:`, error);
      res.status(500).json({ message: `Failed to add the ${noun}` });
    }
  });

  // Before /:id so "reorder" isn't read as an id.
  router.patch('/reorder', authenticate, requireAction(actions.reorder), async (req: StaffRequest, res: Response) => {
    try {
      const all = await Model.find({}).select('_id').lean();
      const ids = reorderedIds(all.map((d: Loose) => d._id), req.body?.ids);
      if (!ids) return res.status(400).json({ message: 'Send every type once, in the order you want.' });
      await Model.bulkWrite(ids.map((id, order) => ({
        updateOne: { filter: { _id: id }, update: { $set: { order, updatedBy: who(req) } } }
      })));
      const docs = await Model.find({}).sort({ order: 1 }).lean();
      res.json({ types: docs.map((d: Loose) => stored(d)) });
    } catch (error) {
      console.error(`Reorder ${noun}s error:`, error);
      res.status(500).json({ message: `Failed to save the order` });
    }
  });

  router.put('/:id', authenticate, requireAction(actions.edit), async (req: StaffRequest, res: Response) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Type not found' });
      const doc = await Model.findById(req.params.id);
      if (!doc) return res.status(404).json({ message: 'Type not found' });
      const others = await Model.find({ _id: { $ne: doc._id } }).select('name label').lean();
      const checked = validateTypeBody(kind, req.body, others as TypeLike[]);
      if (checked.error !== undefined) return res.status(400).json({ message: checked.error });
      const fromFamily = doc.family;
      const toFamily = checked.value.family;
      Object.assign(doc, checked.value, { updatedBy: who(req) });
      if (onFamilyChange && toFamily !== undefined && toFamily !== fromFamily) {
        const recounted = await mongoose.connection.transaction(async (session) => {
          const n = await onFamilyChange(doc.name, fromFamily, toFamily, session);
          await doc.save({ session });
          return n;
        });
        return res.json({ type: stored(doc.toObject()), recounted });
      }
      await doc.save();
      res.json({ type: stored(doc.toObject()) });
    } catch (error) {
      console.error(`Edit ${noun} error:`, error);
      res.status(500).json({ message: `Failed to save the ${noun}` });
    }
  });

  router.get('/:id/uses', authenticate, requireAction(actions.delete), async (req: StaffRequest, res: Response) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Type not found' });
      const doc = await Model.findById(req.params.id).select('name').lean();
      if (!doc) return res.status(404).json({ message: 'Type not found' });
      res.json({ uses: await countUses(doc.name) });
    } catch (error) {
      console.error(`Count ${noun} uses error:`, error);
      res.status(500).json({ message: `Failed to check where the ${noun} is used` });
    }
  });

  router.delete('/:id', authenticate, requireAction(actions.delete), async (req: StaffRequest, res: Response) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Type not found' });
      const doc = await Model.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ message: 'Type not found' });
      if (doc.system) return res.status(409).json({ message: `This ${noun} is built in. Hide it instead.` });
      const replaceWith = req.body?.replaceWith;
      let target: Loose | null = null;
      if (replaceWith !== undefined && replaceWith !== null && replaceWith !== '') {
        target = mongoose.isValidObjectId(replaceWith) ? await Model.findById(replaceWith).lean() : null;
        if (!target || String(target._id) === String(doc._id) || target.active === false) {
          return res.status(400).json({ message: `Choose a shown ${noun} to move them to.` });
        }
      }
      const result = await mongoose.connection.transaction(async (session) => {
        // Counted inside so a record saved since the check is moved too, or stops the delete.
        const uses = await countUses(doc.name);
        if (uses > 0 && !target) return { uses, moved: 0, deleted: false };
        const moved = uses > 0 && target ? await replaceUses(doc.name, target.name, session) : 0;
        await Model.deleteOne({ _id: doc._id }, { session });
        return { uses, moved, deleted: true };
      });
      if (!result.deleted) {
        return res.status(409).json({ message: `${records(result.uses)} use this ${noun}. Choose a type to move them to, or hide it instead.`, uses: result.uses });
      }
      res.json({ ok: true, moved: result.moved, ...(target ? { movedTo: target.label } : {}) });
    } catch (error) {
      if (error instanceof PlacementConflict) return res.status(409).json({ message: error.message });
      console.error(`Delete ${noun} error:`, error);
      res.status(500).json({ message: `Failed to delete the ${noun}` });
    }
  });

  return router;
}
