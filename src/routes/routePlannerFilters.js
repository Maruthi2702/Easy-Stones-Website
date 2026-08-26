import express from 'express';
import User from '../models/User.js';

/**
 * Route Planner's saved filter preferences — Sales Rep, Customer Type, and
 * Days-Since-Last-Visit today. Each is its own key under routePlannerFilters
 * on the user document, saved independently (the client fires one PUT per
 * filter group when that group changes, not one combined payload), so this
 * accepts a partial body and only touches the keys actually present.
 *
 * Kept out of server.js deliberately, same reasoning as
 * src/routes/dailyReports.js: a self-contained, growing feature that doesn't
 * need to add to that file's length. The middleware it needs is handed in
 * rather than imported, so this stays testable on its own.
 *
 *   import createRoutePlannerFiltersRouter from './src/routes/routePlannerFilters.js';
 *   app.use('/api/user/me/route-planner-filters', createRoutePlannerFiltersRouter({ authenticate }));
 */
const FILTER_KEYS = ['activeSalesReps', 'activeTypes', 'activeBuckets'];

export default function createRoutePlannerFiltersRouter({ authenticate }) {
  const router = express.Router();

  // Scoped to the caller's own record only — there is no id in the URL to
  // tamper with, req.userId comes from the verified token.
  router.put('/', authenticate, async (req, res) => {
    try {
      if (!req.userId) {
        return res.status(403).json({ message: 'Staff access required' });
      }
      const body = req.body || {};
      const updates = {};
      for (const key of FILTER_KEYS) {
        if (!(key in body)) continue;
        const value = body[key];
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return res.status(400).json({ message: `${key} must be an object` });
        }
        updates[`routePlannerFilters.${key}`] = value;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: 'No recognized filter fields provided' });
      }
      await User.findByIdAndUpdate(req.userId, { $set: updates });
      res.json({ success: true });
    } catch (error) {
      console.error('Save route planner filters error:', error);
      res.status(500).json({ message: 'Failed to save filter preferences' });
    }
  });

  return router;
}
