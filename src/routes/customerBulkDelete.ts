import type { RequestHandler, Request, Response, NextFunction } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import * as customerData from '../db/customers/index.ts';
import { canDeleteCustomers } from '../utils/customerAccess.ts';
import { bulkDeleteIds } from '../utils/customerBulkDelete.ts';

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
 *   import createCustomerBulkDeleteRouter from './src/routes/customerBulkDelete.ts';
 *   app.use('/api/customers', createCustomerBulkDeleteRouter({ authenticate }));
 */
/**
 * Delete one customer, saving it whole first (source 'single'). Returns the
 * saved copy's batch id, or null when there was no such customer. Shared by
 * the single Delete route in server.ts, so every way of deleting leaves the
 * record the SPS import reads ("deleted by … on …").
 */
export async function backupAndDeleteCustomer(id: string, deletedBy = '', source = 'single') {
  return customerData.backupAndDeleteCustomer(id, deletedBy, source);
}

export default function createCustomerBulkDeleteRouter({ authenticate }: { authenticate: RequestHandler }) {
  const router = express.Router();

  const mayDelete = (req: Request, res: Response, next: NextFunction) => (
    canDeleteCustomers(req.user)
      ? next()
      : res.status(403).json({ message: 'Your role can’t delete customers.' })
  );
  const who = (req: Request) => req.user?.username || req.user?.name || '';

  router.post('/bulk-delete', authenticate, mayDelete, async (req, res) => {
    const { ids, error } = bulkDeleteIds(req.body?.ids);
    if (error) return res.status(400).json({ message: error });
    try {
      const done = await customerData.bulkDeleteCustomers(ids!, who(req));
      if (!done) {
        return res.status(404).json({ message: 'None of these customers exist any more — refresh the list.' });
      }

      req.app.get('io')?.emit('customer_update');
      res.json({ deleted: done.deleted, missing: done.missing, batchId: done.batchId });
    } catch (err) {
      console.error('Bulk delete customers error:', err);
      res.status(500).json({ message: `Could not delete the customers: ${(err as Error).message}` });
    }
  });

  router.post('/bulk-delete/undo', authenticate, mayDelete, async (req, res) => {
    const batchId = String(req.body?.batchId || '');
    if (!mongoose.Types.ObjectId.isValid(batchId)) return res.status(400).json({ message: 'Nothing to undo.' });
    try {
      const undone = await customerData.undoBulkDelete(batchId, who(req));
      if (!undone) return res.status(409).json({ message: 'This delete has already been undone.' });
      const { restored: back, failed } = undone;
      req.app.get('io')?.emit('customer_update');
      res.json({ restored: back, failed });
    } catch (err) {
      console.error('Undo bulk delete error:', err);
      res.status(500).json({ message: `Undo failed: ${(err as Error).message}` });
    }
  });

  return router;
}
