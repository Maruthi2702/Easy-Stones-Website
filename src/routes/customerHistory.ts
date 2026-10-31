import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import Customer from '../models/Customer.ts';
import { basicCustomer, canViewCustomerProfile } from '../utils/customerAccess.ts';
import { inTeam } from '../utils/teamScope.ts';
import { visiblePeopleOfRequest } from '../services/teamDirectory.ts';
import type { Loose } from '../types/records.ts';

type StaffRequest = Request & { user?: Loose; userId?: string };
const lastVisit = (visits: Loose[] = []) => visits.reduce<string | null>((last, visit) =>
  visit.date && (!last || visit.date > last) ? visit.date : last, null);

/** Used by reads and mutation responses so editing cannot bypass history scope. */
export async function customerHistoryResponse(req: StaffRequest, record: Loose): Promise<Loose> {
  const customer: Loose = record.toObject ? record.toObject() : { ...record };
  delete customer.password;
  if (!canViewCustomerProfile(req.user)) return basicCustomer(customer);
  const people = await visiblePeopleOfRequest(req);
  customer.visits = (customer.visits || []).filter((visit: Loose) => inTeam(people, visit.createdBy));
  customer.resources = (customer.resources || []).filter((resource: Loose) => inTeam(people, resource.uploadedBy || resource.createdBy));
  customer.lastVisitDate = lastVisit(customer.visits);
  customer.associatedCustomers = (customer.associatedCustomers || []).map((partner: Loose) => {
    if (!partner || typeof partner !== 'object' || !('visits' in partner)) return partner;
    const { visits = [], ...publicPartner } = partner;
    return { ...publicPartner, lastVisitDate: lastVisit(visits.filter((v: Loose) => inTeam(people, v.createdBy))) };
  });
  return customer;
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
        const customer = await Customer.findById(req.params.id)
          .populate('associatedCustomers', 'contactName company customerType status phone visits')
          .select('-password').lean() as Loose | null;
        if (!customer) return res.status(404).json({ message: 'Customer not found' });
        res.json(await customerHistoryResponse(req, customer));
      } catch (error) {
        console.error('Customer history read failed:', error);
        res.status(500).json({ message: 'Failed to fetch customer details' });
      }
    });

  for (const kind of ['visits', 'resources'] as const) {
    const singular = kind === 'visits' ? 'visit' : 'resource';
    router.get(`/:customerId/${kind}/:entryId`, ...view, profile, async (req: StaffRequest, res) => {
      try {
        const customer = await Customer.findOne(
          { _id: req.params.customerId, [`${kind}._id`]: req.params.entryId }, { [`${kind}.$`]: 1 }
        ).lean() as Loose | null;
        const entry = customer?.[kind]?.[0];
        const owner = kind === 'visits' ? entry?.createdBy : entry?.uploadedBy || entry?.createdBy;
        if (!entry || !inTeam(await visiblePeopleOfRequest(req), owner)) {
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
