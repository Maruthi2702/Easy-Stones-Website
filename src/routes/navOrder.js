import express from 'express';
import AppSetting from '../models/AppSetting.js';
import { sanitizeNavOrder, isDefaultNavOrder } from '../utils/navPins.js';

/**
 * The side nav's order, set by an admin for everyone (src/utils/navPins.js):
 * which section comes first on the rail, and the order of the pages inside
 * each. Everyone signed in reads it; saving needs manage_users, the same
 * people who run Users & Roles. Each person's pins still come first for
 * them on Home — this only orders the sections and their pages.
 *
 *   GET /api/nav-order   → { order }  (null = the default order)
 *   PUT /api/nav-order   { order }    (null, or the default, clears it)
 *
 *   import createNavOrderRouter from './src/routes/navOrder.js';
 *   app.use('/api/nav-order', createNavOrderRouter({ authenticate, requirePermission }));
 */
const KEY = 'navOrder';

export default function createNavOrderRouter({ authenticate, requirePermission }) {
  const router = express.Router();

  router.get('/', authenticate, async (req, res) => {
    try {
      const doc = await AppSetting.findOne({ key: KEY }).lean();
      res.json({ order: sanitizeNavOrder(doc?.value) });
    } catch (error) {
      console.error('Get nav order error:', error);
      res.status(500).json({ message: 'Failed to load the side nav order' });
    }
  });

  router.put('/', authenticate, requirePermission('manage_users'), async (req, res) => {
    try {
      const requested = req.body?.order;
      const order = requested === null ? null : sanitizeNavOrder(requested);
      if (requested !== null && !order) {
        return res.status(400).json({ message: 'order must be an object or null' });
      }
      if (!order || isDefaultNavOrder(order)) {
        await AppSetting.deleteOne({ key: KEY });
        return res.json({ order: null });
      }
      await AppSetting.findOneAndUpdate(
        { key: KEY },
        { $set: { value: order, updatedBy: String(req.user?.username || req.userId || '') } },
        { upsert: true }
      );
      res.json({ order });
    } catch (error) {
      console.error('Save nav order error:', error);
      res.status(500).json({ message: 'Failed to save the side nav order' });
    }
  });

  return router;
}
