import express from 'express';
import mongoose from 'mongoose';
import { validateTypeBody, reorderedIds } from '../utils/typeLists.js';

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
 *   DELETE /:id         only a type no record uses and that isn't a starting
 *                       one (Delete); otherwise hide it
 *
 *   app.use('/api/visit-types', createTypeListRouter({ kind: 'visit', Model: VisitType, … }));
 */
const stored = (doc) => ({
  _id: String(doc._id),
  name: doc.name,
  label: doc.label,
  order: doc.order,
  active: doc.active !== false,
  system: Boolean(doc.system),
  ...(doc.fields ? { fields: { notes: doc.fields.notes, outcome: doc.fields.outcome, followUp: doc.fields.followUp } } : {}),
  ...(doc.family ? { family: doc.family } : {})
});

/**
 * @param {object} opts
 * @param {'visit'|'resource'} opts.kind
 * @param {import('mongoose').Model<any>} opts.Model
 * @param {(name: string) => Promise<number>} opts.countUses how many records carry this stored name
 * @param {{ add: string, edit: string, reorder: string, delete: string }} opts.actions Users & Roles keys
 * @param {Function|Function[]} opts.authenticate  staff who can open a Sales page
 * @param {(key: string) => Function} opts.requireAction
 */
export default function createTypeListRouter({ kind, Model, countUses, actions, authenticate, requireAction }) {
  const router = express.Router();
  const noun = kind === 'visit' ? 'visit type' : 'resource type';
  const who = (req) => String(req.user?.username || req.userId || '');

  router.get('/', authenticate, async (_req, res) => {
    try {
      const docs = await Model.find({}).sort({ order: 1, createdAt: 1 }).lean();
      res.json({ types: docs.map(stored) });
    } catch (error) {
      console.error(`Get ${noun}s error:`, error);
      res.status(500).json({ message: `Failed to load the ${noun}s` });
    }
  });

  router.post('/', authenticate, requireAction(actions.add), async (req, res) => {
    try {
      const all = await Model.find({}).select('name label order').lean();
      const { error, value } = validateTypeBody(kind, { ...req.body, label: req.body?.label ?? req.body?.name }, all);
      if (error) return res.status(400).json({ message: error });
      if (!value.label) return res.status(400).json({ message: 'Enter a name.' });
      // New types go to the bottom; a manager moves them where they want.
      const order = all.reduce((max, t) => Math.max(max, t.order ?? 0), -1) + 1;
      const doc = await Model.create({ ...value, name: value.label, order, updatedBy: who(req) });
      res.status(201).json({ type: stored(doc.toObject()) });
    } catch (error) {
      if (error?.code === 11000) return res.status(400).json({ message: 'There is already a type with that name.' });
      console.error(`Add ${noun} error:`, error);
      res.status(500).json({ message: `Failed to add the ${noun}` });
    }
  });

  // Before /:id so "reorder" isn't read as an id.
  router.patch('/reorder', authenticate, requireAction(actions.reorder), async (req, res) => {
    try {
      const all = await Model.find({}).select('_id').lean();
      const ids = reorderedIds(all.map((d) => d._id), req.body?.ids);
      if (!ids) return res.status(400).json({ message: 'Send every type once, in the order you want.' });
      await Model.bulkWrite(ids.map((id, order) => ({
        updateOne: { filter: { _id: id }, update: { $set: { order, updatedBy: who(req) } } }
      })));
      const docs = await Model.find({}).sort({ order: 1 }).lean();
      res.json({ types: docs.map(stored) });
    } catch (error) {
      console.error(`Reorder ${noun}s error:`, error);
      res.status(500).json({ message: `Failed to save the order` });
    }
  });

  router.put('/:id', authenticate, requireAction(actions.edit), async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Type not found' });
      const doc = await Model.findById(req.params.id);
      if (!doc) return res.status(404).json({ message: 'Type not found' });
      const others = await Model.find({ _id: { $ne: doc._id } }).select('name label').lean();
      const { error, value } = validateTypeBody(kind, req.body, others);
      if (error) return res.status(400).json({ message: error });
      Object.assign(doc, value, { updatedBy: who(req) });
      await doc.save();
      res.json({ type: stored(doc.toObject()) });
    } catch (error) {
      console.error(`Edit ${noun} error:`, error);
      res.status(500).json({ message: `Failed to save the ${noun}` });
    }
  });

  router.delete('/:id', authenticate, requireAction(actions.delete), async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Type not found' });
      const doc = await Model.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ message: 'Type not found' });
      if (doc.system) return res.status(409).json({ message: `This ${noun} is built in. Hide it instead.` });
      const uses = await countUses(doc.name);
      if (uses > 0) {
        return res.status(409).json({ message: `${uses} ${uses === 1 ? 'record uses' : 'records use'} this ${noun}. Hide it instead.` });
      }
      await Model.deleteOne({ _id: doc._id });
      res.json({ ok: true });
    } catch (error) {
      console.error(`Delete ${noun} error:`, error);
      res.status(500).json({ message: `Failed to delete the ${noun}` });
    }
  });

  return router;
}
