/**
 * Visit saves on MongoDB: the routes' own code (src/routes/visits.ts, the reaction route
 * in server.ts), moved here unchanged. Its Postgres twin is visits.postgres.ts; pick
 * between them through visits.ts.
 */
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import VisitType from '../../../models/VisitType.ts';
import { linkVisitToSchedule, moveVisitOnSchedule } from '../../../services/visitSchedule.ts';
import { logActivityMongo, type ActivityEntry } from './activityLog.ts';
import type { Loose } from '../../../types/records.ts';
import type {
  Id, AddVisitInput, AddVisitResult, EditVisitInput, AfterAnswer, FollowUpInput, ReactionInput, ReactionResult
} from './visits.types.ts';

/** One visit as stored (lean), or null. */
export async function findVisit(customerId: string, visitId: Id): Promise<Loose | null> {
  const doc = await Customer.findOne({ _id: customerId, 'visits._id': visitId }, { 'visits.$': 1 }).lean();
  return doc?.visits?.[0] || null;
}

/** The visit type of that name (Admin → Visit Types), or null. */
export async function visitTypeByName(name: string): Promise<Loose | null> {
  return VisitType.findOne({ name }).lean();
}

/** The customer a new visit is logged on (its name goes on the visit), or null. */
export async function visitCustomer(customerId: string): Promise<Loose | null> {
  return Customer.findById(customerId).select('contactName company').lean();
}

/** A reacting customer's name (contactName || email), or null when there is no such customer. */
export async function reactorCustomerName(customerId: string): Promise<string | null> {
  const customer = await Customer.findById(customerId);
  return customer ? (customer.contactName || customer.email) : null;
}

const logLine = (e: Omit<ActivityEntry, 'performedByRole'> & { performedByRole?: unknown }) =>
  logActivityMongo(e as ActivityEntry);

/** POST /api/customers/:customerId/visits — the write, after the route's checks. */
export async function addVisit({ customerId, visit, calendar, log, now }: AddVisitInput): Promise<AddVisitResult> {
  const visitId = visit._id;
  // $ne on the id: two tries racing can't both push.
  const result = await Customer.updateOne(
    { _id: customerId, 'visits._id': { $ne: visitId } },
    { $push: { visits: visit } }
  );
  if (result.matchedCount === 0) {
    const existing = await findVisit(customerId, visitId);
    return existing ? { kind: 'alreadySaved', visit: existing } : { kind: 'notFound' };
  }

  const afterAnswer: AfterAnswer = async (emit) => {
    // Background: put the visit on the logger's calendar — completing their
    // own Scheduled entry for this customer that day, or adding a drop-in if
    // they had nothing planned (see src/services/visitSchedule.ts). Only
    // 'Scheduled' entries are completed, so this can't resurrect a Cancelled
    // stop or relink an already-Completed one.
    try {
      await linkVisitToSchedule({
        customerId, visitId, visitDate: visit.date,
        userId: calendar.userId,
        purpose: visit.purpose, emit, dropInId: calendar.dropInId
      });
    } catch (linkError) {
      console.error('Failed to link visit to schedule:', linkError);
    }

    try {
      await logLine({
        ...log,
        entityType: 'Visit',
        entityId: String(visitId),
        customerId,
        action: 'CREATE',
        timestamp: now()
      });
    } catch (logError) {
      console.error('Failed to log visit creation:', logError);
    }
  };
  return { kind: 'saved', afterAnswer };
}

/** PUT /api/customers/:customerId/visits/:visitId — null when there is no such visit. */
export async function editVisit({ customerId, visitId, before, set, calendar, log, now }: EditVisitInput): Promise<{ visit: Loose | null; afterAnswer: AfterAnswer } | null> {
  const updateData = Object.fromEntries(Object.entries(set).map(([k, v]) => [`visits.$.${k}`, v]));
  const result = await Customer.updateOne(
    { _id: customerId, 'visits._id': visitId },
    { $set: updateData }
  );
  if (result.matchedCount === 0) return null;

  // The stored visit (image links and all), as POST answers.
  const saved = await findVisit(customerId, visitId);

  const afterAnswer: AfterAnswer = async (emit) => {
    // Background: a visit moved to another day takes its calendar entry along.
    if (updateData['visits.$.date'] && before.date !== updateData['visits.$.date']) {
      try {
        await moveVisitOnSchedule({
          customerId, visitId, newDate: updateData['visits.$.date'] as string,
          userId: calendar.userId as Id, purpose: calendar.purpose as string, emit, dropInId: calendar.dropInId
        });
      } catch (moveError) {
        console.error('Failed to move visit on schedule:', moveError);
      }
    }

    try {
      await logLine({
        ...log,
        entityType: 'Visit',
        entityId: visitId,
        customerId,
        action: 'UPDATE',
        timestamp: now()
      });
    } catch (logError) {
      console.error('Failed to log visit update:', logError);
    }
  };
  return { visit: saved, afterAnswer };
}

/** PATCH …/visits/:visitId/follow-up — the stored visit after, or null when there is no such visit. */
export async function setFollowUp({ customerId, visitId, set, event, log }: FollowUpInput): Promise<{ visit: Loose | null; afterAnswer: AfterAnswer } | null> {
  const fields = Object.fromEntries(Object.entries(set).map(([k, v]) => [`visits.$.${k}`, v]));
  const write = event ? { $set: fields, $push: { 'visits.$.followUpHistory': event } } : { $set: fields };
  const result = await Customer.updateOne({ _id: customerId, 'visits._id': visitId }, write);
  if (result.matchedCount === 0) return null;
  const visit = await findVisit(customerId, visitId);

  const afterAnswer: AfterAnswer = async () => {
    try {
      await logLine({ ...log, entityType: 'Visit', entityId: visitId, customerId, action: 'UPDATE' });
    } catch (logError) {
      console.error('Failed to log follow-up change:', logError);
    }
  };
  return { visit, afterAnswer };
}

/** POST …/visits/:visitId/react — one reaction per person, the same type again takes it off. */
export async function toggleReaction({ customerId, visitId, type, userId, userName, reactionId, createdAt }: ReactionInput): Promise<ReactionResult> {
  // Find the customer and specific visit
  const customer = await Customer.findById(customerId);
  if (!customer) return { kind: 'noCustomer' };

  const visit = customer.visits.id(visitId);
  if (!visit) return { kind: 'noVisit' };

  // Initialize reactions array if it doesn't exist (legacy support)
  if (!visit.reactions) {
    visit.reactions = [];
  }

  // Check if user already reacted with this type
  const existingIndex = visit.reactions.findIndex(
    (r: Loose) => r.userId === userId.toString() && r.type === type
  );

  if (existingIndex > -1) {
    // Remove reaction (toggle off)
    visit.reactions.splice(existingIndex, 1);
  } else {
    // Add reaction (toggle on). Reactions are mutually exclusive: a person's
    // other reaction on this visit is taken off first.
    const otherReactionIndex = visit.reactions.findIndex((r: Loose) => r.userId === userId.toString());
    if (otherReactionIndex > -1) {
      visit.reactions.splice(otherReactionIndex, 1);
    }

    visit.reactions.push({ _id: new mongoose.Types.ObjectId(reactionId),
      type,
      userId: userId.toString(),
      userName,
      createdAt
    } as never);
  }

  await customer.save();
  return { kind: 'saved', reactions: visit.reactions };
}
