/**
 * Resource saves on MongoDB: the routes' own code, moved here unchanged
 * (src/routes/customerResources.ts, server.ts's DELETE visit, and the type-list
 * services). Its Postgres twin is resources.postgres.ts; pick through resources.ts.
 */
import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';
import Customer from '../../../models/Customer.ts';
import Schedule from '../../../models/Schedule.ts';
import ActivityLog from '../../../models/ActivityLog.ts';
import { canModifyVisit, canDeleteVisit } from '../../../utils/visitAccess.ts';
import { placementVisit, placementResource } from '../../../services/resourcePlacement.ts';
import {
  unlinkVisitFromSchedule, dropInStartTime, addMinutesToLocal, activityTypeForVisit, DROP_IN_MINUTES
} from '../../../services/visitSchedule.ts';
import User from '../../../models/User.ts';
import { YMD_RE } from '../../../utils/visitDates.ts';
import { loadFamilies, resourcesOf, recountModa, recountForFamilyChange as recountForFamilyChangeMongo } from '../../../services/modaCount.ts';
import {
  countVisitTypeUses as countVisitTypeUsesMongo, countResourceTypeUses as countResourceTypeUsesMongo,
  replaceVisitType as replaceVisitTypeMongo, replaceResourceType as replaceResourceTypeMongo, replaceFamily as replaceFamilyMongo, countFamilyUses as countFamilyUsesMongo
} from '../../../services/typeReplacement.ts';
import type { Loose } from '../../../types/records.ts';
import {
  ResourceError, type AddResourceInput, type UpdateResourceInput, type DeleteResourceInput,
  type DeleteVisitInput, type DeleteVisitResult, type ResourceActor, type ResourceForEdit
} from './resources.rules.ts';

/**
 * services/visitSchedule.ts's linkVisitToSchedule, line for line, except that a new
 * drop-in gets the id the caller made (newId()), so the Postgres twin saves the same
 * one. (That file belongs to the visits group; its own change, if it makes one, can
 * replace this copy.)
 */
async function linkVisitWithId({ customerId, visitId, visitDate, userId, purpose, startTime = undefined, emit, session, dropInId }: Loose) {
  if (!userId || !mongoose.isValidObjectId(userId) || !YMD_RE.test(String(visitDate || ''))) return null;
  const planned = await Schedule.findOneAndUpdate(
    { userId, customerId, status: 'Scheduled', startTime: { $regex: `^${visitDate}` } },
    { $set: { status: 'Completed', linkedVisitId: visitId } },
    { new: true, session }
  );
  if (planned) {
    emit({ type: 'upsert', userId: planned.userId, id: String(planned._id) });
    return planned;
  }
  const user = await User.findById(userId).select('location assignedLocations').session(session).lean();
  if (!user) return null;
  const branch = user.location || user.assignedLocations?.[0] || '';
  const start = startTime || dropInStartTime(visitDate, branch);
  const [dropIn] = await Schedule.create([{
    _id: dropInId, userId, customerId, startTime: start, endTime: addMinutesToLocal(start, DROP_IN_MINUTES),
    activityType: activityTypeForVisit(purpose), notes: purpose || '', status: 'Completed', linkedVisitId: visitId, source: 'visit_log'
  }], { session });
  emit({ type: 'upsert', userId: dropIn.userId, id: String(dropIn._id) });
  return dropIn;
}

/** moveVisitOnSchedule with the same fixed drop-in id. */
async function moveVisitWithId({ customerId, visitId, newDate, userId, purpose, emit, session, dropInId }: Loose) {
  const oldStart = await unlinkVisitFromSchedule({ visitId, emit, session });
  const keptTime = oldStart ? `${newDate}T${String(oldStart).split('T')[1]}` : undefined;
  return linkVisitWithId({ customerId, visitId, visitDate: newDate, userId, purpose, startTime: keptTime, emit, session, dropInId });
}

const asObject = (record: Loose): Loose => record.toObject ? record.toObject() : { ...record };
const ownerOf = (resource: Loose) => ({ createdBy: resource.uploadedBy || resource.createdBy });
const nameOf = (customer: Loose) => customer.company || customer.contactName || '';

/** POST /api/customers/:customerId/resources: the resource, its placement visit and calendar entry, together. */
export async function addResource({ customerId, fields, performer, scheduleUserId, now, ids }: AddResourceInput) {
  const resourceId = new mongoose.Types.ObjectId(ids.resourceId), visitId = new mongoose.Types.ObjectId(ids.visitId);
  return mongoose.connection.transaction(async session => {
    const customer = await Customer.findById(customerId).session(session);
    if (!customer) throw new ResourceError(404, 'Customer not found');
    const createdAt = now();
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
    const before = resourcesOf(customer);
    customer.resources.push(resource);
    customer.visits.push(visit);
    recountModa(customer, before, await loadFamilies(session));
    await customer.save({ session });
    const events: Loose[] = [];
    await linkVisitWithId({ customerId: customer._id as mongoose.Types.ObjectId, visitId, visitDate: fields.date,
      userId: scheduleUserId, purpose: visit.purpose, dropInId: ids.dropInId,
      session, emit: (event: Loose) => { events.push(event); } });
    return { resource: resource as Loose, visit: visit as Loose, events };
  });
}

/** PUT …/resources/:resourceId, before attachments are processed: the resource's type and owner. */
export async function resourceForEdit(resourceId: string): Promise<ResourceForEdit | null> {
  const existing = await Customer.findOne({ 'resources._id': resourceId });
  const before = existing?.resources.id(String(resourceId));
  return before ? { resourceType: before.resourceType, uploadedBy: before.uploadedBy, createdBy: (before as Loose).createdBy } : null;
}

/** PUT /api/customers/:customerId/resources/:resourceId: an edit, or a move to another customer. */
export async function updateResource({ customerId, resourceId, fields, actor, team, dropInId }: UpdateResourceInput) {
  return mongoose.connection.transaction(async session => {
    const source = await Customer.findOne({ 'resources._id': resourceId }).session(session);
    const resource = source?.resources.id(String(resourceId));
    if (!source || !resource) throw new ResourceError(404, 'Resource not found');
    if (!canModifyVisit(actor, ownerOf(resource), team)) throw new ResourceError(403, 'You do not have permission to edit this resource.');
    const moving = String(source._id) !== String(customerId);
    const target = moving ? await Customer.findById(customerId).session(session) : source;
    if (!target) throw new ResourceError(404, 'Customer not found');
    const visit = placementVisit(source, resource);
    if (visit && !canModifyVisit(actor, visit, team)) throw new ResourceError(403, 'You do not have permission to edit the linked placement visit.');
    const oldDate = visit?.date;
    const carried: Loose = { ...asObject(resource), ...fields, customer: nameOf(target) };
    const carriedVisit: Loose | null = visit ? {
      ...asObject(visit), resourceId: resource._id, date: carried.date,
      purpose: `Resource Placement: ${carried.resourceType || carried.title}`,
      notes: carried.notes || carried.description || `Added resource: ${carried.title}`,
      image: carried.image, customerContactName: nameOf(target)
    } : null;
    if (visit) carried.visitId = visit._id;
    const sourceBefore = resourcesOf(source), targetBefore = resourcesOf(target);
    source.resources.pull({ _id: resource._id });
    if (visit) source.visits.pull({ _id: visit._id });
    target.resources.push(carried);
    if (carriedVisit) target.visits.push(carriedVisit);
    const families = await loadFamilies(session);
    if (moving) recountModa(source, sourceBefore, families);
    recountModa(target, targetBefore, families);
    // Even when the second save fails, neither removal is published.
    if (moving) await source.save({ session });
    await target.save({ session });
    const events: Loose[] = [];
    if (carriedVisit) {
      const linked = await Schedule.find({ linkedVisitId: carriedVisit._id }).select('_id userId').session(session).lean();
      await Schedule.updateMany({ linkedVisitId: carriedVisit._id },
        { $set: { customerId: target._id, notes: carriedVisit.purpose } }, { session });
      if (oldDate !== carriedVisit.date) {
        await moveVisitWithId({ customerId: target._id as mongoose.Types.ObjectId, visitId: carriedVisit._id, newDate: carriedVisit.date,
          userId: carriedVisit.createdBy, purpose: carriedVisit.purpose, session, dropInId,
          emit: (event: Loose) => { events.push(event); } });
      } else {
        for (const entry of linked) events.push({ type: 'upsert', userId: entry.userId, id: String(entry._id) });
      }
    }
    return { moving, events };
  });
}

/** DELETE /api/customers/:customerId/resources/:resourceId, with its placement visit and calendar entry. */
export async function deleteResource({ customerId, resourceId, actor, team }: DeleteResourceInput) {
  return mongoose.connection.transaction(async session => {
    const customer = await Customer.findById(customerId).session(session);
    const resource = customer?.resources.id(String(resourceId));
    if (!customer || !resource) throw new ResourceError(404, 'Resource not found');
    if (!canDeleteVisit(actor, ownerOf(resource), team)) throw new ResourceError(403, 'You do not have permission to delete this resource.');
    const visit = placementVisit(customer, resource);
    if (visit && !canDeleteVisit(actor, visit, team)) throw new ResourceError(403, 'You do not have permission to delete the linked placement visit.');
    const before = resourcesOf(customer);
    customer.resources.pull({ _id: resource._id });
    if (visit) customer.visits.pull({ _id: visit._id });
    recountModa(customer, before, await loadFamilies(session));
    await customer.save({ session });
    const events: Loose[] = [];
    if (visit) await unlinkVisitFromSchedule({ visitId: visit._id, session, emit: (event: Loose) => { events.push(event); } });
    return events;
  });
}

/**
 * DELETE /api/customers/:customerId/visits/:visitId (server.ts), with a placement
 * visit's resource. The calendar and the log line follow the answer, as before.
 */
export async function deleteVisitWithResource({ customerId, visitId, actor, team, performer, performedByRole, logId }: DeleteVisitInput): Promise<DeleteVisitResult> {
  const customer = await Customer.findById(customerId);
  if (!customer) return { outcome: 'no-customer' };

  const visit = customer.visits ? customer.visits.id(visitId) : null;
  // Delete has its own permissions (src/utils/visitAccess.ts).
  if (visit && !canDeleteVisit(actor as Loose, visit, await team())) return { outcome: 'forbidden-visit' };
  const resource = visit && /^Resource Placement:/i.test(visit.purpose || '')
    ? placementResource(customer, visit) : null;
  if (resource && !canDeleteVisit(actor as Loose, { createdBy: resource.uploadedBy || resource.createdBy }, await team())) {
    return { outcome: 'forbidden-resource' };
  }
  const resourcesBefore = resourcesOf(customer);
  customer.visits.pull({ _id: visitId });
  if (resource) {
    customer.resources.pull({ _id: resource._id });
    recountModa(customer, resourcesBefore, await loadFamilies());
  }

  await customer.save();

  return {
    outcome: 'deleted',
    async after(emit) {
      // Background: its drop-in comes off the calendar; a planned entry it had
      // completed goes back to Scheduled.
      try {
        await unlinkVisitFromSchedule({ visitId, emit });
      } catch (unlinkError) {
        console.error('Failed to unlink visit from schedule:', unlinkError);
      }

      // Background: Log the activity
      try {
        await ActivityLog.create({
          _id: logId,
          entityType: 'Visit',
          entityId: visitId,
          customerId: customerId,
          action: 'DELETE',
          performedBy: performer.id,
          performedByName: performer.name,
          performedByRole: performedByRole as 'admin' | 'customer' | null,
          details: { visitDate: visit ? visit.date : null, purpose: visit ? visit.purpose : null }
        });
      } catch (logError) {
        console.error('Failed to log visit deletion:', logError);
      }
    }
  };
}

// Type lists (src/routes/typeLists.ts): the services are the MongoDB code as they are.
export const countVisitTypeUses = countVisitTypeUsesMongo;
export const countResourceTypeUses = countResourceTypeUsesMongo;
export const replaceVisitType = (from: string, to: string, session: ClientSession) => replaceVisitTypeMongo(from, to, session);
export const replaceResourceType = (from: string, to: string, session: ClientSession) => replaceResourceTypeMongo(from, to, session);
export const replaceFamily = (from: string, to: string, session: ClientSession) => replaceFamilyMongo(from, to, session);
export const recountForFamilyChange = (typeName: string, from: string | undefined, to: string | undefined, session: ClientSession) =>
  recountForFamilyChangeMongo(typeName, from, to, session);

export const countFamilyUses = countFamilyUsesMongo;

export type { ResourceActor };
