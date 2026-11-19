import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import * as customerData from '../db/customers/index.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { canSeeVisitLocation } from '../utils/visitAccess.ts';
import type { Loose } from '../types/records.ts';

/**
 * Where visits and resources were logged (src/utils/visitLocation.ts), for the marks on the
 * dashboard's Visits list, the customer's Visits tab and the Visit view.
 *
 *   POST /api/visit-locations  { visitIds?: string[], resourceIds?: string[] }
 *     → { locations: { [visitId]: loggedFrom }, byResource: { [resourceId]: loggedFrom } }
 *
 * Only readings the caller may see come back (`canSeeVisitLocation`: their own, or their team's
 * with the "See where visits were logged" switch); anything else is simply absent, so a screen
 * can't tell "not allowed" from "none". This is the only way `loggedFrom` leaves the server
 * apart from the answer to the add that created it. Capped at 500 ids a call.
 */
const MAX_IDS = 500;
type StaffRequest = Request & { user?: Loose; userId?: string };

export default function createVisitLocationsRouter({ authenticate, requireSalesPage }: { authenticate: RequestHandler; requireSalesPage: RequestHandler }) {
  const router = Router();
  router.post('/', authenticate, requireSalesPage, async (req: StaffRequest, res) => {
    try {
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      const visitIds = strings(req.body?.visitIds), resourceIds = strings(req.body?.resourceIds);
      if (visitIds.length > MAX_IDS || resourceIds.length > MAX_IDS) return res.status(400).json({ message: `Ask for at most ${MAX_IDS} at a time.` });
      const rows = await customerData.visitLocations({ visitIds, resourceIds });
      const team = await teamOfRequest(req);
      const viewer = { id: req.userId, permissions: req.user?.permissions };
      const locations: Record<string, unknown> = {}, byResource: Record<string, unknown> = {};
      for (const row of rows) {
        if (!canSeeVisitLocation(viewer, { createdBy: row.createdBy }, team)) continue;
        locations[row.visitId] = row.loggedFrom;
        if (row.resourceId) byResource[row.resourceId] = row.loggedFrom;
      }
      res.json({ locations, byResource });
    } catch (error) {
      console.error('Visit locations failed:', error);
      res.status(500).json({ message: 'Could not load where these were logged.' });
    }
  });
  return router;
}
