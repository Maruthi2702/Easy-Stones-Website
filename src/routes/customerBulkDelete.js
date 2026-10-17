import express from 'express';
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import CustomerDeleteBackup from '../models/CustomerDeleteBackup.js';
import { canDeleteCustomers } from '../utils/customerAccess.js';
import { bulkDeleteIds } from '../utils/customerBulkDelete.js';

/**
 * Bulk delete from the Customer List, with Undo (2026-10-17).
 *
 *   POST /api/customers/bulk-delete        { ids }     → { deleted, missing, batchId }
 *   POST /api/customers/bulk-delete/undo   { batchId } → { restored, failed: [{ id, company }] }
 *
 * Both need the Delete switch (canDeleteCustomers — which needs View too),
 * checked here whatever the screen showed.
 *
 * One request for the whole selection. Every customer is saved whole to
 * customerdeletebackups first, and only then are they removed — so a request
 * that dies part-way has deleted nothing it didn't save, and Undo puts back
 * whatever is missing and skips what's still there. Undo restores each record
 * under its own _id, so the deliveries, lost sales, schedules and activity
 * that point at it by id point at it again. One that can't come back (a new
 * customer took its email since) is reported and stays in the backups.
 *
 *   import createCustomerBulkDeleteRouter from './src/routes/customerBulkDelete.js';
 *   app.use('/api/customers', createCustomerBulkDeleteRouter({ authenticate }));
 */
/**
 * Delete one customer, saving it whole first (source 'single'). Returns the
 * saved copy's batch id, or null when there was no such customer. Shared by
 * the single Delete route in server.js, so every way of deleting leaves the
 * record the SPS import reads ("deleted by … on …").
 */
export async function backupAndDeleteCustomer(id, deletedBy = '') {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const raw = await Customer.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
  if (!raw) return null;
  const batchId = new mongoose.Types.ObjectId().toString();
  await CustomerDeleteBackup.create({ batchId, customerId: raw._id, customer: raw, source: 'single', deletedBy });
  await Customer.collection.deleteOne({ _id: raw._id });
  return batchId;
}

export default function createCustomerBulkDeleteRouter({ authenticate }) {
  const router = express.Router();

  const mayDelete = (req, res, next) => (
    canDeleteCustomers(req.user)
      ? next()
      : res.status(403).json({ message: 'Your role can’t delete customers.' })
  );
  const who = (req) => req.user?.username || req.user?.name || '';

  router.post('/bulk-delete', authenticate, mayDelete, async (req, res) => {
    const { ids, error } = bulkDeleteIds(req.body?.ids);
    if (error) return res.status(400).json({ message: error });
    try {
      const oids = ids.map((id) => new mongoose.Types.ObjectId(id));
      const docs = await Customer.collection.find({ _id: { $in: oids } }).toArray();
      if (docs.length === 0) {
        return res.status(404).json({ message: 'None of these customers exist any more — refresh the list.' });
      }

      const batchId = new mongoose.Types.ObjectId().toString();
      const deletedBy = who(req);
      await CustomerDeleteBackup.insertMany(
        docs.map((customer) => ({ batchId, customerId: customer._id, customer, source: 'bulk', deletedBy }))
      );
      const { deletedCount } = await Customer.collection.deleteMany({ _id: { $in: docs.map((d) => d._id) } });

      req.app.get('io')?.emit('customer_update');
      res.json({ deleted: deletedCount, missing: ids.length - docs.length, batchId });
    } catch (err) {
      console.error('Bulk delete customers error:', err);
      res.status(500).json({ message: `Could not delete the customers: ${err.message}` });
    }
  });

  router.post('/bulk-delete/undo', authenticate, mayDelete, async (req, res) => {
    const batchId = String(req.body?.batchId || '');
    if (!mongoose.Types.ObjectId.isValid(batchId)) return res.status(400).json({ message: 'Nothing to undo.' });
    try {
      const backups = await CustomerDeleteBackup.find({ batchId, undoneAt: null }).lean();
      if (backups.length === 0) return res.status(409).json({ message: 'This delete has already been undone.' });

      // Put them all back; one that clashes (still there, or its email taken
      // since) fails alone and the rest go in.
      try {
        await Customer.collection.insertMany(backups.map((b) => b.customer), { ordered: false });
      } catch (err) {
        if (!Array.isArray(err.writeErrors) && !err.result) throw err;
      }

      // What's there now is back — restored just now, or never deleted.
      const ids = backups.map((b) => b.customerId);
      const present = new Set(
        (await Customer.collection.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id))
      );
      const back = backups.filter((b) => present.has(String(b.customerId)));
      const failed = backups
        .filter((b) => !present.has(String(b.customerId)))
        .map((b) => ({ id: String(b.customerId), company: b.customer?.company || b.customer?.contactName || '' }));

      if (back.length) {
        await CustomerDeleteBackup.updateMany(
          { _id: { $in: back.map((b) => b._id) } },
          { $set: { undoneAt: new Date(), undoneBy: who(req) } }
        );
      }
      req.app.get('io')?.emit('customer_update');
      res.json({ restored: back.length, failed });
    } catch (err) {
      console.error('Undo bulk delete error:', err);
      res.status(500).json({ message: `Undo failed: ${err.message}` });
    }
  });

  return router;
}
