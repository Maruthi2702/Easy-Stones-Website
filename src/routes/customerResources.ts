import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import mongoose from 'mongoose';
import Customer from '../models/Customer.ts';
import ResourceType from '../models/ResourceType.ts';
import { canModifyVisit, canDeleteVisit, ANY_EDIT_VISIT_PERMISSIONS, ANY_DELETE_VISIT_PERMISSIONS } from '../utils/visitAccess.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { normalizeVisitDate } from '../utils/visitDates.ts';
import { parseResourceQty, RESOURCE_QTY_MAX } from '../utils/resourceForm.ts';
import { PlacementConflict } from '../services/resourcePlacement.ts';
import { loadFamilies } from '../services/modaCount.ts';
import * as customerData from '../db/customers/index.ts';
import { ResourceError } from '../db/customers/writes/resources.rules.ts';
import { newId } from '../db/ids.ts';
import { modaSummary } from '../utils/modaTotals.ts';
import { canViewCustomerProfile } from '../utils/customerAccess.ts';
import type { Loose } from '../types/records.ts';

type StaffRequest = Request & { user?: Loose; userId?: string; authType?: string };
type Deps = {
  authenticate: RequestHandler;
  requirePermission: (key: string) => RequestHandler;
  requireAnyPermission: (...keys: string[]) => RequestHandler;
  getPerformerInfo: (req: StaffRequest) => Promise<{ id: string; name: string }>;
  getNowLocalISO: () => string;
  processBase64Images: (images: unknown, folder: string) => Promise<unknown>;
  emitScheduleUpdate: (event: Loose) => void;
};
const MUTABLE = ['title', 'date', 'location', 'resourceType', 'qty', 'image', 'description', 'notes', 'status', 'url'] as const;
const actorOf = (req: StaffRequest) => ({ id: req.userId, permissions: req.user?.permissions });
const ownerOf = (resource: Loose) => ({ createdBy: resource.uploadedBy || resource.createdBy });

/** Resource, placement history and linked calendar changes commit together. */
export default function createCustomerResourcesRouter(deps: Deps) {
  const { authenticate, requirePermission, requireAnyPermission, getPerformerInfo, getNowLocalISO, processBase64Images, emitScheduleUpdate } = deps;
  const router = Router();
  const notify = (req: StaffRequest, events: Loose[]) => {
    for (const event of events) emitScheduleUpdate(event);
    req.app.get('io')?.emit('customer_update');
    req.app.get('io')?.emit('visit_updated', {});
  };
  const fail = (res: Response, error: unknown) => {
    if (error instanceof PlacementConflict || error instanceof ResourceError) return res.status(error.status).json({ message: error.message });
    console.error('Resource write failed:', error);
    return res.status(500).json({ message: 'Could not save the resource. Nothing was changed; please try again.' });
  };
  // A resource's type must be on the Resource Types list (Admin → Resource Types)
  // and not hidden; the type a resource already has can stay (`current`).
  const checkType = async (type: unknown, current: unknown) => {
    const name = String(type || '').trim();
    if (!name || name === String(current || '')) return;
    const found = await ResourceType.findOne({ name }).select('active').lean();
    if (!found || found.active === false) throw new ResourceError(400, 'Choose one of the resource types.');
  };
  const fieldsOf = async (body: Loose, creating: boolean, currentType?: unknown): Promise<Loose> => {
    const fields: Loose = Object.fromEntries(MUTABLE.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
    if (creating || fields.date !== undefined) {
      fields.date = normalizeVisitDate(fields.date || (creating ? getNowLocalISO().slice(0, 10) : ''));
      if (!fields.date) throw new ResourceError(400, 'Resource date must be a date (YYYY-MM-DD)');
    }
    if (creating || fields.qty !== undefined) {
      fields.qty = parseResourceQty(fields.qty);
      if (fields.qty === null) throw new ResourceError(400, `Qty must be a whole number from 1 to ${RESOURCE_QTY_MAX}`);
    }
    if (fields.resourceType !== undefined) await checkType(fields.resourceType, currentType);
    if (fields.resourceType && fields.title === undefined) fields.title = fields.resourceType;
    if (creating && !fields.title) throw new ResourceError(400, 'Resource title or type is required');
    if (fields.image !== undefined) fields.image = await processBase64Images(fields.image, 'Resources');
    return fields;
  };

  // The profile's Moda Resources tiles and breakdown, and what the Add / Edit
  // resource form needs to show the change a save makes (src/utils/modaTotals.ts).
  // Counted from every resource, whoever logged it, like the stored totals.
  router.get('/:customerId/moda', authenticate, async (req: StaffRequest, res) => {
    try {
      const permissions: string[] = req.user?.permissions || [];
      const allowed = canViewCustomerProfile(req.user) || ['add_visits', ...ANY_EDIT_VISIT_PERMISSIONS].some(key => permissions.includes(key));
      if (!allowed) return res.status(403).json({ message: 'You do not have access to this customer.' });
      if (!mongoose.isValidObjectId(req.params.customerId)) return res.status(404).json({ message: 'Customer not found' });
      const customer = await Customer.findById(req.params.customerId)
        .select('modaDisplay modaBinder modaEarlier resources._id resources.resourceType resources.title resources.qty resources.status resources.date').lean();
      if (!customer) return res.status(404).json({ message: 'Customer not found' });
      res.json(modaSummary(customer as Loose, (customer as Loose).resources, await loadFamilies()));
    } catch (error) {
      console.error('Moda summary failed:', error);
      res.status(500).json({ message: 'Could not load the Moda counts.' });
    }
  });

  router.post('/:customerId/resources', authenticate, requirePermission('add_visits'), async (req: StaffRequest, res) => {
    try {
      const fields = await fieldsOf(req.body, true);
      const performer = await getPerformerInfo(req);
      // src/db/customers: MongoDB, or Postgres once DB_CUSTOMERS=postgres.
      const result = await customerData.addResource({
        customerId: String(req.params.customerId), fields, performer, now: getNowLocalISO,
        scheduleUserId: req.authType === 'admin' ? performer.id : null,
        ids: { resourceId: newId(), visitId: newId(), dropInId: newId() }
      });
      notify(req, result.events);
      res.status(201).json({ success: true, resource: result.resource, visit: result.visit });
    } catch (error) { fail(res, error); }
  });

  router.put('/:customerId/resources/:resourceId', authenticate, requireAnyPermission(...ANY_EDIT_VISIT_PERMISSIONS), async (req: StaffRequest, res) => {
    try {
      const team = await teamOfRequest(req);
      // Authorize before processing attachments, and recheck inside the transaction.
      const before = await customerData.resourceForEdit(String(req.params.resourceId));
      if (!before) throw new ResourceError(404, 'Resource not found');
      if (!canModifyVisit(actorOf(req), ownerOf(before), team)) throw new ResourceError(403, 'You do not have permission to edit this resource.');
      const fields = await fieldsOf(req.body, false, before.resourceType);
      const result = await customerData.updateResource({
        customerId: String(req.params.customerId), resourceId: String(req.params.resourceId), fields,
        actor: actorOf(req), team, dropInId: newId()
      });
      notify(req, result.events);
      res.json({ success: true, message: result.moving ? 'Resource moved to the selected customer' : 'Resource updated successfully', moved: result.moving });
    } catch (error) { fail(res, error); }
  });

  router.delete('/:customerId/resources/:resourceId', authenticate, requireAnyPermission(...ANY_DELETE_VISIT_PERMISSIONS), async (req: StaffRequest, res) => {
    try {
      const team = await teamOfRequest(req);
      const events = await customerData.deleteResource({
        customerId: String(req.params.customerId), resourceId: String(req.params.resourceId), actor: actorOf(req), team
      });
      notify(req, events);
      res.json({ success: true, message: 'Resource deleted successfully' });
    } catch (error) { fail(res, error); }
  });
  return router;
}
