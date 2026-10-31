import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import mongoose from 'mongoose';
import Customer from '../models/Customer.ts';
import Schedule from '../models/Schedule.ts';
import { canModifyVisit, canDeleteVisit, ANY_EDIT_VISIT_PERMISSIONS, ANY_DELETE_VISIT_PERMISSIONS } from '../utils/visitAccess.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { normalizeVisitDate } from '../utils/visitDates.ts';
import { parseResourceQty, RESOURCE_QTY_MAX } from '../utils/resourceForm.ts';
import { placementVisit, PlacementConflict } from '../services/resourcePlacement.ts';
import { linkVisitToSchedule, moveVisitOnSchedule, unlinkVisitFromSchedule } from '../services/visitSchedule.ts';
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
class ResourceError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const MUTABLE = ['title', 'date', 'location', 'resourceType', 'qty', 'image', 'description', 'notes', 'status', 'url'] as const;
const asObject = (record: Loose): Loose => record.toObject ? record.toObject() : { ...record };
const actorOf = (req: StaffRequest) => ({ id: req.userId, permissions: req.user?.permissions });
const ownerOf = (resource: Loose) => ({ createdBy: resource.uploadedBy || resource.createdBy });
const nameOf = (customer: Loose) => customer.company || customer.contactName || '';

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
  const fieldsOf = async (body: Loose, creating: boolean): Promise<Loose> => {
    const fields: Loose = Object.fromEntries(MUTABLE.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
    if (creating || fields.date !== undefined) {
      fields.date = normalizeVisitDate(fields.date || (creating ? getNowLocalISO().slice(0, 10) : ''));
      if (!fields.date) throw new ResourceError(400, 'Resource date must be a date (YYYY-MM-DD)');
    }
    if (creating || fields.qty !== undefined) {
      fields.qty = parseResourceQty(fields.qty);
      if (fields.qty === null) throw new ResourceError(400, `Qty must be a whole number from 1 to ${RESOURCE_QTY_MAX}`);
    }
    if (fields.resourceType && fields.title === undefined) fields.title = fields.resourceType;
    if (creating && !fields.title) throw new ResourceError(400, 'Resource title or type is required');
    if (fields.image !== undefined) fields.image = await processBase64Images(fields.image, 'Resources');
    return fields;
  };

  router.post('/:customerId/resources', authenticate, requirePermission('add_visits'), async (req: StaffRequest, res) => {
    try {
      const fields = await fieldsOf(req.body, true);
      const performer = await getPerformerInfo(req);
      const resourceId = new mongoose.Types.ObjectId(), visitId = new mongoose.Types.ObjectId();
      const result = await mongoose.connection.transaction(async session => {
        const customer = await Customer.findById(req.params.customerId).session(session);
        if (!customer) throw new ResourceError(404, 'Customer not found');
        const createdAt = getNowLocalISO();
        const resource = {
          ...fields, _id: resourceId, visitId, uploadedBy: performer.id,
          customer: nameOf(customer), createdAt, image: fields.image || [], status: fields.status || 'Active'
        };
        const visit = {
          _id: visitId, resourceId, date: fields.date, purpose: `Resource Placement: ${fields.resourceType || fields.title}`,
          notes: fields.notes || fields.description || `Added resource: ${fields.title}`,
          image: resource.image, createdBy: performer.id, createdByName: performer.name,
          customerContactName: nameOf(customer), createdAt, followUp: '', followUpDate: ''
        };
        customer.resources.push(resource);
        customer.visits.push(visit);
        await customer.save({ session });
        const events: Loose[] = [];
        await linkVisitToSchedule({ customerId: customer._id, visitId, visitDate: fields.date,
          userId: req.authType === 'admin' ? performer.id : null, purpose: visit.purpose,
          session, emit: (event: Loose) => { events.push(event); } });
        return { resource, visit, events };
      });
      notify(req, result.events);
      res.status(201).json({ success: true, resource: result.resource, visit: result.visit });
    } catch (error) { fail(res, error); }
  });

  router.put('/:customerId/resources/:resourceId', authenticate, requireAnyPermission(...ANY_EDIT_VISIT_PERMISSIONS), async (req: StaffRequest, res) => {
    try {
      const team = await teamOfRequest(req);
      // Authorize before processing attachments, and recheck inside the transaction.
      const existing = await Customer.findOne({ 'resources._id': req.params.resourceId });
      const before = existing?.resources.id(String(req.params.resourceId));
      if (!before) throw new ResourceError(404, 'Resource not found');
      if (!canModifyVisit(actorOf(req), ownerOf(before), team)) throw new ResourceError(403, 'You do not have permission to edit this resource.');
      const fields = await fieldsOf(req.body, false);
      const result = await mongoose.connection.transaction(async session => {
        const source = await Customer.findOne({ 'resources._id': req.params.resourceId }).session(session);
        const resource = source?.resources.id(String(req.params.resourceId));
        if (!source || !resource) throw new ResourceError(404, 'Resource not found');
        if (!canModifyVisit(actorOf(req), ownerOf(resource), team)) throw new ResourceError(403, 'You do not have permission to edit this resource.');
        const moving = String(source._id) !== String(req.params.customerId);
        const target = moving ? await Customer.findById(req.params.customerId).session(session) : source;
        if (!target) throw new ResourceError(404, 'Customer not found');
        const visit = placementVisit(source, resource);
        if (visit && !canModifyVisit(actorOf(req), visit, team)) throw new ResourceError(403, 'You do not have permission to edit the linked placement visit.');
        const oldDate = visit?.date;
        const carried: Loose = { ...asObject(resource), ...fields, customer: nameOf(target) };
        const carriedVisit: Loose | null = visit ? {
          ...asObject(visit), resourceId: resource._id, date: carried.date,
          purpose: `Resource Placement: ${carried.resourceType || carried.title}`,
          notes: carried.notes || carried.description || `Added resource: ${carried.title}`,
          image: carried.image, customerContactName: nameOf(target)
        } : null;
        if (visit) carried.visitId = visit._id;
        source.resources.pull({ _id: resource._id });
        if (visit) source.visits.pull({ _id: visit._id });
        target.resources.push(carried);
        if (carriedVisit) target.visits.push(carriedVisit);
        // Even when the second save fails, neither removal is published.
        if (moving) await source.save({ session });
        await target.save({ session });
        const events: Loose[] = [];
        if (carriedVisit) {
          const linked = await Schedule.find({ linkedVisitId: carriedVisit._id }).select('_id userId').session(session).lean();
          await Schedule.updateMany({ linkedVisitId: carriedVisit._id },
            { $set: { customerId: target._id, notes: carriedVisit.purpose } }, { session });
          if (oldDate !== carriedVisit.date) {
            await moveVisitOnSchedule({ customerId: target._id, visitId: carriedVisit._id, newDate: carriedVisit.date,
              userId: carriedVisit.createdBy, purpose: carriedVisit.purpose, session,
              emit: (event: Loose) => { events.push(event); } });
          } else {
            for (const entry of linked) events.push({ type: 'upsert', userId: entry.userId, id: String(entry._id) });
          }
        }
        return { moving, events };
      });
      notify(req, result.events);
      res.json({ success: true, message: result.moving ? 'Resource moved to the selected customer' : 'Resource updated successfully', moved: result.moving });
    } catch (error) { fail(res, error); }
  });

  router.delete('/:customerId/resources/:resourceId', authenticate, requireAnyPermission(...ANY_DELETE_VISIT_PERMISSIONS), async (req: StaffRequest, res) => {
    try {
      const team = await teamOfRequest(req);
      const events = await mongoose.connection.transaction(async session => {
        const customer = await Customer.findById(req.params.customerId).session(session);
        const resource = customer?.resources.id(String(req.params.resourceId));
        if (!customer || !resource) throw new ResourceError(404, 'Resource not found');
        if (!canDeleteVisit(actorOf(req), ownerOf(resource), team)) throw new ResourceError(403, 'You do not have permission to delete this resource.');
        const visit = placementVisit(customer, resource);
        if (visit && !canDeleteVisit(actorOf(req), visit, team)) throw new ResourceError(403, 'You do not have permission to delete the linked placement visit.');
        customer.resources.pull({ _id: resource._id });
        if (visit) customer.visits.pull({ _id: visit._id });
        await customer.save({ session });
        const events: Loose[] = [];
        if (visit) await unlinkVisitFromSchedule({ visitId: visit._id, session, emit: (event: Loose) => { events.push(event); } });
        return events;
      });
      notify(req, events);
      res.json({ success: true, message: 'Resource deleted successfully' });
    } catch (error) { fail(res, error); }
  });
  return router;
}
