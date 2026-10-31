import type { Loose } from '../types/records.ts';
import type { RequestHandler } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import Customer from '../models/Customer.ts';
import ActivityLog from '../models/ActivityLog.ts';
import { normalizeVisitDate, normalizeOptionalDate } from '../utils/visitDates.ts';
import { canModifyVisit, ANY_EDIT_VISIT_PERMISSIONS } from '../utils/visitAccess.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import VisitType from '../models/VisitType.ts';
import { cleanVisitFields } from '../utils/visitForm.ts';
import { linkVisitToSchedule, moveVisitOnSchedule } from '../services/visitSchedule.ts';

/**
 * Saving a visit (moved out of server.ts 2026-10-23):
 *
 *   POST /api/customers/:customerId/visits            add   → 201 { visit }
 *   PUT  /api/customers/:customerId/visits/:visitId   edit  → 200 { visit }
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
}: { authenticate: RequestHandler; requirePermission: (permission: string) => RequestHandler; requireAnyPermission: (...permissions: string[]) => RequestHandler; processBase64Image: Loose; getPerformerInfo: Loose; getNowLocalISO: Loose; emitScheduleUpdate: Loose }) {
  const router = express.Router();

  const processImages = async (image: Loose) => {
    if (Array.isArray(image)) return Promise.all(image.map((img) => processBase64Image(img, 'visits')));
    if (typeof image === 'string') return processBase64Image(image, 'visits');
    return image;
  };

  const visitOf = async (customerId: string, visitId: string) => {
    const doc = await Customer.findOne({ _id: customerId, 'visits._id': visitId }, { 'visits.$': 1 }).lean();
    return doc?.visits?.[0] || null;
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

  router.post('/:customerId/visits', authenticate, requirePermission('add_visits'), async (req, res) => {
    try {
      const { customerId } = req.params;
      const { date, purpose, notes, outcome, managerComment, headquartersComment, image } = req.body;

      // Only a real YYYY-MM-DD date is stored — these feed date-range queries and
      // the calendar link (src/utils/visitDates.ts has why).
      const processedDate = normalizeVisitDate(date);
      const processedFollowUpDate = normalizeOptionalDate(req.body.followUpDate);
      if (!processedDate || !purpose) {
        return res.status(400).json({ message: 'A visit date (YYYY-MM-DD) and a purpose are required' });
      }
      // The list is Admin → Visit Types; a hidden type can't start a new visit.
      const visitType = await VisitType.findOne({ name: String(purpose) }).lean();
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
      const visitId = new mongoose.Types.ObjectId(sentId || undefined);

      // The customer and who is saving are independent reads.
      const [customerInfo, performer] = await Promise.all([
        Customer.findById(customerId).select('contactName company').lean(),
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

      // $ne on the id: two tries racing can't both push.
      const updateStart = Date.now();
      const result = await Customer.updateOne(
        { _id: customerId, 'visits._id': { $ne: visitId } },
        { $push: { visits: visitData } }
      );
      if (result.matchedCount === 0) {
        const existing = await visitOf(customerId, visitId);
        if (existing) return res.status(200).json({ success: true, visit: existing, alreadySaved: true });
        console.error(`[Add Visit] Atomic update matched zero docs for customer: ${customerId}`);
        return res.status(404).json({ message: 'Customer not found during update' });
      }

      console.log(`[Add Visit] Success in ${Date.now() - updateStart}ms for customer ${customerId}`);
      req.app.get('io').emit('visit_updated', { customerId });
      res.status(201).json({ success: true, visit: visitData });

      // Background: put the visit on the logger's calendar — completing their
      // own Scheduled entry for this customer that day, or adding a drop-in if
      // they had nothing planned (see src/services/visitSchedule.ts). Only
      // 'Scheduled' entries are completed, so this can't resurrect a Cancelled
      // stop or relink an already-Completed one.
      try {
        await linkVisitToSchedule({
          customerId, visitId, visitDate: processedDate,
          userId: req.authType === 'admin' ? createdBy : null,
          purpose, emit: emitScheduleUpdate
        });
      } catch (linkError) {
        console.error('Failed to link visit to schedule:', linkError);
      }

      try {
        await ActivityLog.create({
          entityType: 'Visit',
          entityId: visitId,
          customerId,
          action: 'CREATE',
          performedBy: createdBy,
          performedByName: createdByName,
          performedByRole: req.authType,
          timestamp: getNowLocalISO(),
          details: { purpose: visitData.purpose, date: visitData.date }
        });
      } catch (logError) {
        console.error('Failed to log visit creation:', logError);
      }
    } catch (error) {
      console.error('Add visit error:', error);
      if (!res.headersSent) res.status(500).json({ message: 'Failed to add visit: ' + error.message });
    }
  });

  router.put('/:customerId/visits/:visitId', authenticate, requireAnyPermission(...ANY_EDIT_VISIT_PERMISSIONS), async (req, res) => {
    try {
      const { customerId, visitId } = req.params;
      const { date, purpose, notes, outcome, managerComment, headquartersComment, image } = req.body;

      const updateData: Loose = {};
      if (date) {
        const processedDate = normalizeVisitDate(date);
        if (!processedDate) return res.status(400).json({ message: 'Visit date must be a date (YYYY-MM-DD)' });
        updateData['visits.$.date'] = processedDate;
      }
      let followUpDate;
      if (req.body.followUpDate !== undefined) {
        followUpDate = normalizeOptionalDate(req.body.followUpDate);
        if (followUpDate === null) return res.status(400).json({ message: 'Follow-up date must be a date (YYYY-MM-DD)' });
      }

      // Who may change this visit (src/utils/visitAccess.ts) — checked before
      // any image upload or write. The same read tells the calendar sync below
      // whether the date moved and who logged the visit.
      const existing = await Customer.findOne(
        { _id: customerId, 'visits._id': visitId },
        { 'visits.$': 1, location: 1 }
      ).lean();
      const before = existing?.visits?.[0];
      if (!before) return res.status(404).json({ message: 'Customer or visit not found' });
      if (!canModifyVisit({ id: req.userId, permissions: req.user?.permissions }, before, await teamOfRequest(req))) {
        return res.status(403).json({ message: "You don't have permission to edit this visit. You can edit visits you logged; anything else needs a Visits permission under Users & Roles." });
      }
      // A type that has since been hidden or removed stays valid on the visit that has it.
      const typeName = String(purpose ?? before.purpose ?? '');
      const visitType = await VisitType.findOne({ name: typeName }).lean();
      if (purpose !== undefined && purpose !== before.purpose && (!visitType || visitType.active === false)) {
        return res.status(400).json({ message: 'Choose one of the visit types.' });
      }

      const clean = cleanVisitFields(visitType, { followUp: req.body.followUp, followUpDate });
      const { id: updatedBy, name: updatedByName } = await getPerformerInfo(req);

      if (clean.followUpDate !== undefined) updateData['visits.$.followUpDate'] = clean.followUpDate;
      if (purpose !== undefined) updateData['visits.$.purpose'] = purpose;
      if (notes !== undefined) updateData['visits.$.notes'] = notes;
      if (outcome !== undefined) updateData['visits.$.outcome'] = outcome;
      if (clean.followUp !== undefined) updateData['visits.$.followUp'] = clean.followUp;
      if (managerComment !== undefined) updateData['visits.$.managerComment'] = managerComment;
      if (headquartersComment !== undefined) updateData['visits.$.headquartersComment'] = headquartersComment;
      if (image !== undefined) updateData['visits.$.image'] = await processImages(image);

      updateData['visits.$.updatedBy'] = updatedBy;
      updateData['visits.$.updatedByName'] = updatedByName;
      updateData['visits.$.updatedAt'] = getNowLocalISO();

      const result = await Customer.updateOne(
        { _id: customerId, 'visits._id': visitId },
        { $set: updateData }
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ message: 'Customer or visit not found' });
      }

      // The stored visit (image links and all), as POST answers — the screen
      // shows this, not a guess from what it sent.
      const saved = await visitOf(customerId, visitId);
      res.json({ success: true, message: 'Visit updated successfully', visit: saved });

      // Background: a visit moved to another day takes its calendar entry along.
      if (updateData['visits.$.date'] && before.date !== updateData['visits.$.date']) {
        try {
          await moveVisitOnSchedule({
            customerId, visitId, newDate: updateData['visits.$.date'],
            userId: before.createdBy, purpose: purpose ?? before.purpose, emit: emitScheduleUpdate
          });
        } catch (moveError) {
          console.error('Failed to move visit on schedule:', moveError);
        }
      }

      try {
        await ActivityLog.create({
          entityType: 'Visit',
          entityId: visitId,
          customerId,
          action: 'UPDATE',
          performedBy: updatedBy,
          performedByName: updatedByName,
          performedByRole: req.authType,
          timestamp: getNowLocalISO(),
          details: { fields: Object.keys(req.body) }
        });
      } catch (logError) {
        console.error('Failed to log visit update:', logError);
      }
    } catch (error) {
      console.error('Update visit error:', error);
      if (!res.headersSent) res.status(500).json({ message: 'Failed to update visit' });
    }
  });

  return router;
}
