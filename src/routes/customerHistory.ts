import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import { customerProfile, customerHistoryEntry, customerRecordResponse, isHistoryId } from '../db/customers/index.ts';
import { canViewCustomerProfile } from '../utils/customerAccess.ts';
import { visiblePeopleOfRequest } from '../services/teamDirectory.ts';
import type { Loose } from '../types/records.ts';

type StaffRequest = Request & { user?: Loose; userId?: string };
/** Used by mutation responses so editing cannot bypass history scope. */
export async function customerHistoryResponse(req: StaffRequest, record: Loose): Promise<Loose> {
  const mayProfile = canViewCustomerProfile(req.user);
  return customerRecordResponse(record, { mayProfile, people: mayProfile ? await visiblePeopleOfRequest(req) : new Set() });
}

/** Full-profile access does not widen the separate Visits read permissions. */
export default function createCustomerHistoryRouter({ authenticate, requirePermission }: {
  authenticate: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
}) {
  const router = Router();
  const view = [authenticate, requirePermission('view_customers')];
  const profile = requirePermission('view_customer_profile');

  router.get('/:id', (req, _res, next) => /^[a-f0-9]{24}$/i.test(String(req.params.id)) ? next() : next('route'),
    ...view, async (req: StaffRequest, res) => {
      try {
        const mayProfile = canViewCustomerProfile(req.user);
        const customer = await customerProfile(String(req.params.id), {
          mayProfile, people: mayProfile ? await visiblePeopleOfRequest(req) : new Set()
        });
        if (!customer) return res.status(404).json({ message: 'Customer not found' });
        res.json(customer);
      } catch (error) {
        console.error('Customer history read failed:', error);
        res.status(500).json({ message: 'Failed to fetch customer details' });
      }
    });

  for (const kind of ['visits', 'resources'] as const) {
    const singular = kind === 'visits' ? 'visit' : 'resource';
    router.get(`/:customerId/${kind}/:entryId`, ...view, profile, async (req: StaffRequest, res) => {
      try {
        // A malformed id is a bad link, not a server failure.
        if (!isHistoryId(String(req.params.customerId)) || !isHistoryId(String(req.params.entryId))) {
          return res.status(404).json({ message: `${singular === 'visit' ? 'Visit' : 'Resource'} not found` });
        }
        const entry = await customerHistoryEntry(String(req.params.customerId), kind, String(req.params.entryId),
          await visiblePeopleOfRequest(req));
        if (!entry) {
          return res.status(404).json({ message: `${singular === 'visit' ? 'Visit' : 'Resource'} not found` });
        }
        res.json({ [singular]: entry });
      } catch (error) {
        console.error('Customer detail read failed:', error);
        res.status(500).json({ message: `Failed to fetch ${singular} detail` });
      }
    });
  }
  return router;
}
