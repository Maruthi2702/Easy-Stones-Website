import type { RequestHandler } from 'express';
import express from 'express';
import User from '../models/User.ts';
import { sanitizePinnedTabs } from '../utils/navPins.ts';

/**
 * The side nav's pinned pages (User.pinnedTabs), saved per person so they
 * follow them between devices. Order matters: the first one they can open is
 * where /sales lands when the URL names no tab (src/utils/navPins.ts).
 *
 * The client sends the whole list on every change. Ids are checked against
 * the nav's own list, but not against the caller's permissions — a pin they
 * can't open is simply not shown, and comes back if the permission does.
 *
 *   import createPinnedTabsRouter from './src/routes/pinnedTabs.ts';
 *   app.use('/api/user/me/pinned-tabs', createPinnedTabsRouter({ authenticate }));
 */
export default function createPinnedTabsRouter({ authenticate }: { authenticate: RequestHandler }) {
  const router = express.Router();

  // Scoped to the caller's own record — req.userId comes from the verified token.
  router.put('/', authenticate, async (req, res) => {
    try {
      if (!req.userId) {
        return res.status(403).json({ message: 'Staff access required' });
      }
      const pinnedTabs = sanitizePinnedTabs(req.body?.pinnedTabs);
      if (!pinnedTabs) {
        return res.status(400).json({ message: 'pinnedTabs must be a list' });
      }
      await User.findByIdAndUpdate(req.userId, { $set: { pinnedTabs } });
      res.json({ success: true, pinnedTabs });
    } catch (error) {
      console.error('Save pinned tabs error:', error);
      res.status(500).json({ message: 'Failed to save pinned pages' });
    }
  });

  return router;
}
