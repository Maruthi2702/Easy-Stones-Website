import type { Request, Response, NextFunction, RequestHandler } from 'express';
import express from 'express';
import { scalarParams, validateScalarRequest } from '../server/scalarRequest.ts';
import { listLostSales, createLostSale, updateLostSale, deleteLostSale } from '../db/lostSales/index.ts';
import { newId } from '../db/ids.ts';
import { canViewLostSales, canEditLostSales, canDeleteLostSales } from '../utils/lostSaleAccess.ts';
import type { Loose } from '../types/records.ts';

/**
 * Lost Sales (Sales → Lost Sales): GET / · POST / · PUT /:id · DELETE /:id.
 * The routes moved here from server.ts unchanged; they read and write through
 * src/db/lostSales (MongoDB or Postgres by `DB_LOST_SALES`).
 *
 *   app.use('/api/lost-sales', createLostSalesRouter({ verifyAnyAuth }));
 */
export default function createLostSalesRouter({ verifyAnyAuth }: { verifyAnyAuth: RequestHandler }) {
  const router = express.Router();

  // Lost sales are scoped to the branches a person is assigned ('*' = all), like
  // the rest of the location filters. A record with no location is shown to
  // everyone rather than to no one, the same call the delivery board makes.
  const assignedLocationsOf = (user: Loose): string[] => user?.assignedLocations || [];
  const canAccessLostSaleLocation = (user: Loose, location: string) => {
    const assigned = user?.assignedLocations || [];
    return assigned.includes('*') || !location || assigned.includes(location);
  };

  // Users & Roles → Lost Sales, by the screen's own rules (lostSaleAccess.js).
  // These routes used to answer any login, a customer's or a kiosk's included.
  const allowLostSales = (may: (user: Loose) => boolean) => (req: Request, res: Response, next: NextFunction) => (
    req.user?.type !== 'customer' && may(req.user) ? next() : res.status(403).json({ error: 'Access denied.' })
  );

  // GET /api/lost-sales: Fetch the lost sales for the branches this person may see
  router.get('/', verifyAnyAuth, allowLostSales(canViewLostSales), async (req: Request, res: Response) => {
    try {
      const list = await listLostSales(assignedLocationsOf(req.user));
      res.json(list);
    } catch (error) {
      console.error('Error fetching lost sales:', error);
      res.status(500).json({ message: 'Failed to fetch lost sales' });
    }
  });

  // POST /api/lost-sales: Create a lost sale entry
  router.post('/', verifyAnyAuth, allowLostSales(canEditLostSales), async (req: Request, res: Response) => {
    try {
      const data = req.body;
      const slabsCount = Number(data.slabsCount) || 1;
      const sfPerSlab = Number(data.sfPerSlab) || 0;
      const pricePerSf = Number(data.pricePerSf) || 0;
      const totalSf = data.totalSf ? Number(data.totalSf) : (slabsCount * sfPerSlab);
      const totalLostValue = data.totalLostValue ? Number(data.totalLostValue) : (totalSf * pricePerSf);

      if (!canAccessLostSaleLocation(req.user, data.location || 'Seattle')) {
        return res.status(403).json({ message: 'You do not have access to that location' });
      }

      const lostSale = await createLostSale({
        _id: newId(),
        customerName: data.customerName,
        customerId: data.customerId || null,
        productName: data.productName,
        productId: data.productId || null,
        lengthInches: Number(data.lengthInches) || 0,
        widthInches: Number(data.widthInches) || 0,
        sfPerSlab: sfPerSlab,
        slabsCount: slabsCount,
        totalSf: totalSf,
        pricePerSf: pricePerSf,
        totalLostValue: totalLostValue,
        reason: data.reason || 'Out of Stock',
        location: data.location || 'Seattle',
        competitorName: data.competitorName || '',
        notes: data.notes || '',
        salesRepName: data.salesRepName || req.user?.displayName || req.user?.contactName || 'Sales Rep',
        // authenticate() exposes the user's id as `id`, not `_id` — this read used
        // to always be undefined, so every lost sale was stored with a null rep id.
        salesRepId: data.salesRepId || req.user?.id || null,
        date: data.date ? new Date(data.date) : new Date()
      });

      req.app.get('io')?.emit('lost_sale_update');
      res.status(201).json(lostSale);
    } catch (error) {
      console.error('Error creating lost sale:', error);
      res.status(500).json({ message: 'Failed to create lost sale record', error: (error as Error).message });
    }
  });

  // PUT /api/lost-sales/:id: Update a lost sale entry
  router.put('/:id', verifyAnyAuth, allowLostSales(canEditLostSales), validateScalarRequest, async (req: Request, res: Response) => {
    const requestParams = scalarParams(req);
    try {
      const data = req.body;
      const slabsCount = Number(data.slabsCount) || 1;
      const sfPerSlab = Number(data.sfPerSlab) || 0;
      const pricePerSf = Number(data.pricePerSf) || 0;
      const totalSf = data.totalSf ? Number(data.totalSf) : (slabsCount * sfPerSlab);
      const totalLostValue = data.totalLostValue ? Number(data.totalLostValue) : (totalSf * pricePerSf);

      const updateObj: Loose = {
        customerName: data.customerName,
        productName: data.productName,
        lengthInches: Number(data.lengthInches) || 0,
        widthInches: Number(data.widthInches) || 0,
        sfPerSlab: sfPerSlab,
        slabsCount: slabsCount,
        totalSf: totalSf,
        pricePerSf: pricePerSf,
        totalLostValue: totalLostValue,
        reason: data.reason,
        location: data.location,
        competitorName: data.competitorName || '',
        notes: data.notes || ''
      };
      if (data.salesRepName) updateObj.salesRepName = data.salesRepName;
      if (data.date) updateObj.date = new Date(data.date);

      if (!canAccessLostSaleLocation(req.user, data.location)) {
        return res.status(403).json({ message: 'You do not have access to that location' });
      }

      // findByIdAndUpdate skips validators by default, so an edit could store a
      // `reason` outside the schema enum that POST would have rejected.
      // Only a record this person can see — one at another branch reads as missing.
      const updated = await updateLostSale(requestParams.id, assignedLocationsOf(req.user), updateObj);

      if (!updated) {
        return res.status(404).json({ message: 'Lost sale record not found' });
      }

      req.app.get('io')?.emit('lost_sale_update');
      res.json(updated);
    } catch (error) {
      console.error('Error updating lost sale:', error);
      res.status(500).json({ message: 'Failed to update lost sale record', error: (error as Error).message });
    }
  });

  // DELETE /api/lost-sales/:id: Delete a lost sale entry
  router.delete('/:id', verifyAnyAuth, allowLostSales(canDeleteLostSales), validateScalarRequest, async (req: Request, res: Response) => {
    const requestParams = scalarParams(req);
    try {
      const deleted = await deleteLostSale(requestParams.id, assignedLocationsOf(req.user));
      if (!deleted) {
        return res.status(404).json({ message: 'Lost sale record not found' });
      }
      req.app.get('io')?.emit('lost_sale_update');
      res.json({ success: true, message: 'Lost sale record deleted successfully' });
    } catch (error) {
      console.error('Error deleting lost sale:', error);
      res.status(500).json({ message: 'Failed to delete lost sale record' });
    }
  });

  return router;
}
