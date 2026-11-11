import { validateScalarRequest, scalarParams } from '../server/scalarRequest.ts';
import type { Loose } from '../types/records.ts';
import type { RequestHandler, Request } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import * as customerData from '../db/customers/index.ts';
import { newId } from '../db/ids.ts';
import { normalizeVisitDate, normalizeOptionalDate } from '../utils/visitDates.ts';
import { canModifyVisit, ANY_EDIT_VISIT_PERMISSIONS } from '../utils/visitAccess.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { cleanVisitFields } from '../utils/visitForm.ts';
import { followUpUpdate } from '../utils/followUpList.ts';

/**
 * Saving a visit (moved out of server.ts 2026-10-23):
 *
 *   POST /api/customers/:customerId/visits            add   → 201 { visit }
 *   PUT  /api/customers/:customerId/visits/:visitId   edit  → 200 { visit }
 *   PATCH /api/customers/:customerId/visits/:visitId/follow-up
 *        { action: done|reopen|snooze|note, today?, until?, outcome? } → 200 { visit }
 *   POST /api/customers/visit-attachments  { data }         → { url }
 *
 * The rules are decided here, not on the form: the visit types are the form's
 * list (a legacy type already on the visit may be kept on edit), a type with no
 * follow-up stores none (`cleanVisitFields`), dates are real days.
 *
 * A POST may carry `_id` (a 24-hex id the form made before sending). Sending
 * the same one again — a retry after the answer was lost — finds the visit it
 * already saved and answers 200 with it, without adding a second or repeating
 * the calendar and log work.
 *
 * The attachments route is what the form calls the moment a photo/PDF is picked,
 * so Save carries links, not megabytes. A save still accepts raw data URLs
 * (older apps; a failed early upload) and processes them as before.
 *
 *   app.use('/api/customers', createVisitsRouter({ authenticate, requirePermission,
 *     requireAnyPermission, processBase64Image, getPerformerInfo, getNowLocalISO,
 *     emitScheduleUpdate }));
 */
export default function createVisitsRouter({
  authenticate, requirePermission, requireAnyPermission,
  processBase64Image, getPerformerInfo, getNowLocalISO, emitScheduleUpdate
}: { authenticate: RequestHandler; requirePermission: (permission: string) => RequestHandler; requireAnyPermission: (...permissions: string[]) => RequestHandler; processBase64Image: (image: string, folder?: string) => Promise<unknown>; getPerformerInfo: (req: Request) => Promise<Loose>; getNowLocalISO: () => string; emitScheduleUpdate: (event: Loose) => void }) {
  const router = express.Router();

  const processImages = async (image: Loose) => {
    if (Array.isArray(image)) return Promise.all(image.map((img) => processBase64Image(img, 'visits')));
    if (typeof image === 'string') return processBase64Image(image, 'visits');
    return image;
  };

  // The data layer (src/db/customers/writes/visits.ts) does every read and write of a
  // visit: MongoDB, or Postgres once DB_CUSTOMERS=postgres.
  const visitOf = (customerId: string, visitId: string | mongoose.Types.ObjectId) =>
    customerData.savedVisit(customerId, visitId);

  const announceVisit = (req: Request, customerId: string, visitId: string | mongoose.Types.ObjectId) => {
    const mutationId = typeof req.body?._mutationId === 'string' && /^[0-9a-f]{24}$/i.test(req.body._mutationId)
      ? req.body._mutationId : undefined;
    req.app.get('io')?.emit('customer_update', { kind: 'visit', customerId, visitId: String(visitId), mutationId });
  };

  router.post('/visit-attachments', authenticate,
    requireAnyPermission('add_visits', ...ANY_EDIT_VISIT_PERMISSIONS), async (req, res) => {
      const data = req.body?.data;
      if (typeof data !== 'string' || !/^data:(image\/|application\/pdf)/.test(data)) {
        return res.status(400).json({ message: 'Send a photo or PDF.' });
      }
      try {
        const url = await processBase64Image(data, 'visits');
        // processBase64Image hands the data back when the upload fails.
        if (typeof url !== 'string' || url.startsWith('data:')) {
          return res.status(502).json({ message: 'Could not store the attachment.' });
        }
        res.json({ url });
      } catch (error) {
        console.error('Visit attachment error:', error);
        res.status(502).json({ message: 'Could not store the attachment.' });
      }
    });

  router.post('/:customerId/visits', authenticate, requirePermission('add_visits'), validateScalarRequest, async (req, res) => {
  const requestParams = scalarParams(req);
    try {
      const { customerId } = requestParams;
      const { date, purpose, notes, outcome, managerComment, headquartersComment, image } = req.body;

      // Only a real YYYY-MM-DD date is stored — these feed date-range queries and
      // the calendar link (src/utils/visitDates.ts has why).
      const processedDate = normalizeVisitDate(date);
      const processedFollowUpDate = normalizeOptionalDate(req.body.followUpDate);
      if (!processedDate || !purpose) {
        return res.status(400).json({ message: 'A visit date (YYYY-MM-DD) and a purpose are required' });
      }
      // The list is Admin → Visit Types; a hidden type can't start a new visit.
      const visitType = await customerData.visitTypeNamed(String(purpose));
      if (!visitType || visitType.active === false) {
        return res.status(400).json({ message: 'Choose one of the visit types.' });
      }
      if (processedFollowUpDate === null) {
        return res.status(400).json({ message: 'Follow-up date must be a date (YYYY-MM-DD)' });
      }
      const { followUp, followUpDate } = cleanVisitFields(visitType, { followUp: req.body.followUp, followUpDate: processedFollowUpDate });

      // The form's own id, so a repeat of this request can be told from a new visit.
      const sentId = String(req.body._id || '');
      if (sentId && !/^[0-9a-f]{24}$/i.test(sentId)) {
        return res.status(400).json({ message: 'Visit id is not valid.' });
      }
      const visitId = sentId ? sentId.toLowerCase() : newId();

      // The customer and who is saving are independent reads.
      const [customerInfo, performer] = await Promise.all([
        customerData.visitCustomer(customerId),
        getPerformerInfo(req)
      ]);
      if (!customerInfo) {
        console.error(`[Add Visit] Customer not found: ${customerId}`);
        return res.status(404).json({ message: 'Customer not found' });
      }
      const { id: createdBy, name: createdByName } = performer;

      // Already saved by an earlier try of this same request: answer with it.
      if (sentId) {
        const existing = await visitOf(customerId, visitId);
        if (existing) return res.status(200).json({ success: true, visit: existing, alreadySaved: true });
      }

      const visitData = {
        _id: visitId,
        date: processedDate,
        purpose,
        notes,
        outcome,
        followUp,
        followUpDate,
        managerComment,
        headquartersComment,
        image: await processImages(image),
        createdBy,
        createdByName,
        customerContactName: customerInfo.company || customerInfo.contactName || '',
        createdAt: getNowLocalISO()
      };

      const updateStart = Date.now();
      const saved = await customerData.addVisit({
        customerId, visit: visitData,
        calendar: { userId: req.authType === 'admin' ? createdBy : null, dropInId: newId() },
        log: {
          id: newId(), performedBy: createdBy, performedByName: createdByName, performedByRole: req.authType,
          details: { purpose: visitData.purpose, date: visitData.date }
        },
        now: getNowLocalISO
      });
      if (saved.kind === 'alreadySaved') return res.status(200).json({ success: true, visit: saved.visit, alreadySaved: true });
      if (saved.kind === 'notFound') {
        console.error(`[Add Visit] Atomic update matched zero docs for customer: ${customerId}`);
        return res.status(404).json({ message: 'Customer not found during update' });
      }

      console.log(`[Add Visit] Success in ${Date.now() - updateStart}ms for customer ${customerId}`);
      req.app.get('io').emit('visit_updated', { customerId });
      announceVisit(req, customerId, visitId);
      res.status(201).json({ success: true, visit: visitData });

      // After answering: on MongoDB the visit goes on the logger's calendar (completing
      // their own Scheduled entry that day, else a drop-in; src/services/visitSchedule.ts)
      // and the log line is written; on Postgres both were saved with the visit.
      await saved.afterAnswer(emitScheduleUpdate);
    } catch (error) {
      console.error('Add visit error:', error);
      if (!res.headersSent) res.status(500).json({ message: 'Failed to add visit: ' + (error as Error).message });
    }
  });

  router.put('/:customerId/visits/:visitId', authenticate, requireAnyPermission(...ANY_EDIT_VISIT_PERMISSIONS), validateScalarRequest, async (req, res) => {
  const requestParams = scalarParams(req);
    try {
      const { customerId, visitId } = requestParams;
      const { date, purpose, notes, outcome, managerComment, headquartersComment, image } = req.body;

      const updateData: Loose = {};
      if (date) {
        const processedDate = normalizeVisitDate(date);
        if (!processedDate) return res.status(400).json({ message: 'Visit date must be a date (YYYY-MM-DD)' });
        updateData.date = processedDate;
      }
      let followUpDate!: string | null;
      if (req.body.followUpDate !== undefined) {
        followUpDate = normalizeOptionalDate(req.body.followUpDate);
        if (followUpDate === null) return res.status(400).json({ message: 'Follow-up date must be a date (YYYY-MM-DD)' });
      }

      // Who may change this visit (src/utils/visitAccess.ts) — checked before
      // any image upload or write. The same read tells the calendar sync below
      // whether the date moved and who logged the visit.
      const before = await visitOf(customerId, visitId);
      if (!before) return res.status(404).json({ message: 'Customer or visit not found' });
      if (!canModifyVisit({ id: req.userId, permissions: req.user?.permissions }, before, await teamOfRequest(req))) {
        return res.status(403).json({ message: "You don't have permission to edit this visit. You can edit visits you logged; anything else needs a Visits permission under Users & Roles." });
      }
      // A type that has since been hidden or removed stays valid on the visit that has it.
      const typeName = String(purpose ?? before.purpose ?? '');
      const visitType = await customerData.visitTypeNamed(typeName);
      if (purpose !== undefined && purpose !== before.purpose && (!visitType || visitType.active === false)) {
        return res.status(400).json({ message: 'Choose one of the visit types.' });
      }

      const clean = cleanVisitFields(visitType, { followUp: req.body.followUp, followUpDate });
      const { id: updatedBy, name: updatedByName } = await getPerformerInfo(req);

      if (clean.followUpDate !== undefined) updateData.followUpDate = clean.followUpDate;
      if (purpose !== undefined) updateData.purpose = purpose;
      if (notes !== undefined) updateData.notes = notes;
      if (outcome !== undefined) updateData.outcome = outcome;
      if (clean.followUp !== undefined) updateData.followUp = clean.followUp;
      if (managerComment !== undefined) updateData.managerComment = managerComment;
      if (headquartersComment !== undefined) updateData.headquartersComment = headquartersComment;
      if (image !== undefined) updateData.image = await processImages(image);

      updateData.updatedBy = updatedBy;
      updateData.updatedByName = updatedByName;
      updateData.updatedAt = getNowLocalISO();

      const result = await customerData.editVisit({
        customerId, visitId, before, set: updateData,
        calendar: { userId: before.createdBy, purpose: purpose ?? before.purpose, dropInId: newId() },
        log: {
          id: newId(), performedBy: updatedBy, performedByName: updatedByName, performedByRole: req.authType,
          details: { fields: Object.keys(req.body) }
        },
        now: getNowLocalISO
      });
      if (!result) {
        return res.status(404).json({ message: 'Customer or visit not found' });
      }

      // The stored visit (image links and all), as POST answers — the screen
      // shows this, not a guess from what it sent.
      announceVisit(req, customerId, visitId);
      res.json({ success: true, message: 'Visit updated successfully', visit: result.visit });

      // After answering: a visit moved to another day takes its calendar entry along
      // (MongoDB; Postgres did it with the save), and the log line is written.
      await result.afterAnswer(emitScheduleUpdate);
    } catch (error) {
      console.error('Update visit error:', error);
      if (!res.headersSent) res.status(500).json({ message: 'Failed to update visit' });
    }
  });

  // Dashboard → Follow-ups: tick a visit's follow-up done, reopen it, snooze it
  // to another day, or add what happened to a done one. Who may: whoever may
  // edit the visit (canModifyVisit). What it writes: followUpUpdate in
  // src/utils/followUpList.ts, plus a line in the visit's followUpHistory for a
  // snooze, tick or reopen. Answers with the stored visit.
  router.patch('/:customerId/visits/:visitId/follow-up', authenticate, requireAnyPermission(...ANY_EDIT_VISIT_PERMISSIONS), async (req, res) => {
    try {
      const customerId = String(req.params.customerId);
      const visitId = String(req.params.visitId);
      if (!mongoose.isValidObjectId(customerId) || !mongoose.isValidObjectId(visitId)) {
        return res.status(404).json({ message: 'Customer or visit not found' });
      }
      const before = await visitOf(customerId, visitId);
      if (before && !canModifyVisit({ id: req.userId, permissions: req.user?.permissions }, before, await teamOfRequest(req))) {
        return res.status(403).json({ message: "You don't have permission to change this follow-up. You can change follow-ups on visits you logged; anything else needs a Visits permission under Users & Roles." });
      }
      const { id: userId, name: userName } = await (getPerformerInfo as (r: unknown) => Promise<{ id: string; name: string }>)(req);
      const now = (getNowLocalISO as () => string)();
      const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.today || '')) ? req.body.today : now.slice(0, 10);
      const update = followUpUpdate(before, req.body || {}, { now, today, userId: String(userId || ''), userName: userName || '' });
      if (!update.ok) return res.status(update.status).json({ message: update.message });

      const result = await customerData.setFollowUp({
        customerId, visitId, set: update.set, event: update.event as Record<string, string> | undefined,
        log: {
          id: newId(), performedBy: userId, performedByName: userName, performedByRole: (req as Loose).authType,
          details: { followUp: req.body.action, ...(req.body.action === 'snooze' ? { until: update.set.followUpDate } : {}) },
          timestamp: now
        }
      });
      if (!result) return res.status(404).json({ message: 'Customer or visit not found' });
      req.app.get('io')?.emit('customer_update');
      res.json({ visit: result.visit });

      await result.afterAnswer(emitScheduleUpdate);
    } catch (error) {
      console.error('Follow-up change error:', error);
      if (!res.headersSent) res.status(500).json({ message: 'Failed to change the follow-up' });
    }
  });

  return router;
}
