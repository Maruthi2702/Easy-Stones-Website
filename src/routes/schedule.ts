import { validateScalarRequest, scalarQuery, scalarParams } from '../server/scalarRequest.ts';
import type { Loose } from '../types/records.ts';
import type { RequestHandler, Request, Response } from 'express';
/**
 * Calendar (Schedule) routes: a rep's planner entries, the route planner's
 * day-at-a-time writes, the private .ics feed, and the Google Calendar /
 * iCloud sync integrations. Moved out of server.ts as one self-contained
 * feature, same pattern as dailyReports.js and deliveries.js — handed the
 * middleware it needs, mounted at '/api' so every URL is unchanged.
 *
 * Visits put entries on the calendar too, from server.ts's visit routes, via
 * src/services/visitSchedule.ts — those keep living with the visit routes.
 */
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import Schedule from '../models/Schedule.ts';
import Customer, { type CustomerData } from '../models/Customer.ts';
import User from '../models/User.ts';
import { calendarFeedToken, validCalendarFeedToken } from '../services/calendarFeed.ts';
import { zonedTimeToUtc } from '../utils/dateUtils.ts';
import { cleanScheduleFields, isObjectId, DEFAULT_VISIT_MINUTES } from '../utils/scheduleRecord.ts';
import { calendarPeopleOf, idVariants } from '../services/teamDirectory.ts';
import { ALL_PEOPLE } from '../utils/teamScope.ts';
import { discoverICloudCalendars, syncICloudCalendar } from '../services/icloudSyncService.ts';
import * as calendarData from '../db/customers/writes/schedule.ts';
import { newId } from '../db/ids.ts';

/**
 * Tell every open planner that this user's schedule moved.
 *
 * A schedule belongs to one user, but that user can have the planner open in
 * two browsers, on a phone, and be running a calendar sync at the same time —
 * so the write has to be announced, not just answered. Clients filter on
 * userId and refetch the range they are actually looking at; the payload
 * deliberately carries no schedule contents, since it crosses to sockets that
 * belong to other people.
 */
export const createScheduleEmitter = (io: Loose) => (payload: Loose) => {
  if (!payload || !payload.userId) return;
  try {
    io.emit('schedule_update', { ...payload, userId: String(payload.userId) });
  } catch (err) {
    console.warn('[schedule] broadcast failed:', (err as Error).message);
  }
};

/**
 * `emitScheduleUpdate` comes from createScheduleEmitter above — created once in
 * server.ts, since the visit routes there announce calendar changes too.
 */
export default function createScheduleRouter({ authenticate, requirePermission, emitScheduleUpdate, jwtSecret }: { authenticate: RequestHandler; requirePermission: (permission: string) => RequestHandler; emitScheduleUpdate: (event: Loose) => void; jwtSecret: string }) {
  const router = express.Router();
  const verifyAnyAuth = authenticate;
  const JWT_SECRET = jwtSecret;

  // One-time backfill for schedule entries created before the visit↔schedule
  // link above existed: a rep may have already logged a visit for a stop that
  // was scheduled before this feature shipped, and that Schedule doc has been
  // sitting at the 'Scheduled' default ever since with nothing to correct it
  // retroactively. Same matching rule as the live hook in POST .../visits —
  // same-customer, same-day. Only touches entries still 'Scheduled', so this
  // is safe to run more than once; nothing already Completed or Cancelled is
  // revisited.
  router.post('/admin/schedule/backfill-completed', authenticate, requirePermission('manage_customers'), async (req, res) => {
    try {
      // src/db/customers: MongoDB, or Postgres once DB_CUSTOMERS=postgres.
      const { checked, linked: linkedEntries } = await calendarData.backfillCompletedEntries();
      for (const entry of linkedEntries) emitScheduleUpdate({ type: 'upsert', userId: entry.userId, id: entry.id });
      const linked = linkedEntries.length;
      res.json({ success: true, checked, linked });
    } catch (error) {
      console.error('Schedule backfill error:', error);
      res.status(500).json({ message: `Backfill failed: ${(error as Error).message}` });
    }
  });

  // Get user's schedule. ?scope=team (staff only) is the team calendar
  // (src/utils/teamScope.ts, 2026-10-31): the entries of everyone whose
  // calendar this person may see — their own, plus their teammates' with
  // Users & Roles → Visits → Team calendar — narrowed by ?reps= (the
  // dashboard's People filter) and ?location=, each with `ownerName`. Read
  // only: PUT and DELETE below still match on the signed-in user's id.
  router.get('/schedule', verifyAnyAuth, validateScalarRequest, async (req, res) => {
  const requestQuery = scalarQuery(req);

    try {
      const userId = req.userId || req.customerId;
      const { start, end } = requestQuery;

      let query: Loose = { userId };
      let nameOf = null;
      if (requestQuery.scope === 'team' && req.userId && req.user?.type !== 'customer') {
        const team = await calendarPeopleOf(req);
        nameOf = team.nameOf;
        query = team.people === ALL_PEOPLE ? {} : { userId: { $in: [...team.people].flatMap(idVariants) } };
      }

      if (start && end) {
        query.startTime = { $gte: start, $lte: end };
      }

      const schedule = await Schedule.find(query)
        .populate<{ customerId: Pick<CustomerData, 'company' | 'contactName'> | null }>('customerId', 'contactName company')
        .sort({ startTime: 1 });

      if (!nameOf) return res.json(schedule);
      res.json(schedule.map((item) => {
        const doc = item.toObject();
        return { ...doc, ownerName: nameOf.get(String(doc.userId)) || '' };
      }));
    } catch (error) {
      console.error('Fetch schedule error:', error);
      res.status(500).json({ message: 'Failed to fetch schedule' });
    }
  });

  // Create schedule item. The rules are the server's (utils/scheduleRecord.js):
  // a real customer, real times with the end after the start, a known type. A
  // client that sends its own `_id` can repeat the same POST safely — the second
  // answers 200 with the entry it already saved, so a double tap or a retry on a
  // bad connection never books twice.
  router.post('/schedule', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      const { fields, error } = cleanScheduleFields(req.body);
      if (error) return res.status(400).json({ message: error });

      const wantedId = req.body._id;
      if (wantedId !== undefined && !isObjectId(wantedId)) {
        return res.status(400).json({ message: 'That entry id is not valid' });
      }
      const saved = await calendarData.createCalendarEntry(String(userId), wantedId !== undefined ? wantedId : newId(), fields!, wantedId !== undefined);
      if (saved.kind === 'noCustomer') return res.status(400).json({ message: 'That customer no longer exists' });
      if (saved.kind === 'idTaken') return res.status(409).json({ message: 'That entry id is already used' });
      if (saved.kind === 'alreadySaved') return res.status(200).json({ ...saved.entry, alreadySaved: true });

      emitScheduleUpdate({ type: 'upsert', userId, id: String(saved.entry._id) });

      res.status(201).json(saved.entry);
    } catch (error) {
      console.error('Create schedule error:', error);
      res.status(500).json({ message: 'Failed to create schedule entry' });
    }
  });

  /**
   * Create a whole day of stops in one call.
   *
   * Planning a route is a single decision — these twelve customers, Tuesday, in
   * this order — and one request per stop turns it into twelve chances to half-fail.
   * Validated before any write, then committed in one transaction so a failed
   * insert cannot erase the previous plan or leave a partial new day.
   *
   * The order and the times come from the client because that is where the route
   * was laid out; what the server will not accept is a stop for a customer that
   * does not exist, so the ids are checked before anything is written.
   */
  router.post('/schedule/bulk', authenticate, requirePermission('create_route_plan'), async (req, res) => {
    try {
      const userId = req.userId;
      const { items, replace = false, date = '' } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'No stops to schedule' });
      }

      // Replacing a day is an edit of what is already there, so it is gated
      // separately from creating one: someone may be trusted to plan a day
      // without being trusted to overwrite one already planned.
      if (replace && !req.user.permissions.includes('edit_route_plan')) {
        return res.status(403).json({
          message: 'Access denied. Replacing a planned day needs the "edit_route_plan" permission.'
        });
      }
      // A day is a day. A four-figure paste is a bug or a misuse, and either way
      // should not become four thousand documents.
      if (items.length > 50) {
        return res.status(400).json({ message: 'A single day cannot hold more than 50 stops' });
      }

      const wanted = items.map(item => item.customerId).filter(Boolean);
      if (wanted.length !== items.length) {
        return res.status(400).json({ message: 'Every stop needs a customer' });
      }
      if (items.some(item => !item.startTime)) {
        return res.status(400).json({ message: 'Every stop needs a start time' });
      }
      // Real times, the end after the start, a known type — the same rules as a
      // single entry. Cleaned here so what's stored is only what was checked.
      const cleaned: Loose[] = [];
      for (const item of items) {
        const result = cleanScheduleFields(item);
        if (result.error) return res.status(400).json({ message: result.error });
        cleaned.push(result.fields!);
      }
      // One stop sent with its own `_id` can be repeated safely (a double tap):
      // the second answers with the entry already saved.
      const wantedId = items.length === 1 ? items[0]._id : undefined;
      if (wantedId !== undefined && !isObjectId(wantedId)) return res.status(400).json({ message: 'That entry id is not valid' });

      const saved = await calendarData.planRouteDay(String(userId), {
        stops: cleaned.map(fields => ({ id: wantedId !== undefined ? wantedId : newId(), fields })),
        replace: !!replace, date, retry: wantedId !== undefined
      });
      if (saved.kind === 'idTaken') return res.status(409).json({ message: 'That entry id is already used' });
      if (saved.kind === 'alreadySaved') return res.status(200).json({ stops: saved.stops, replaced: 0, alreadySaved: true });
      if (saved.kind === 'unknownCustomer') return res.status(400).json({ message: 'One or more stops name a customer that no longer exists' });
      if (saved.kind === 'needDate') return res.status(400).json({ message: 'A date (YYYY-MM-DD) is required to replace a day' });
      if (saved.kind === 'offDate') return res.status(400).json({ message: 'Every replacement stop must be on the selected date' });
      const { stops: populated, replaced, created } = saved;

      // One signal for the day rather than one per stop: every open planner
      // reloads the range once instead of redrawing twelve times.
      emitScheduleUpdate({ type: 'bulk', userId, count: created });

      console.log(`🗺️ Route planned: ${created} stops for user ${userId}${replaced ? ` (replaced ${replaced})` : ''}`);
      res.status(201).json({ stops: populated, replaced });
    } catch (error) {
      console.error('Bulk schedule error:', error);
      if ((error as Error).name === 'ValidationError' || (error as Error).name === 'CastError') {
        return res.status(400).json({ message: 'Invalid route stops', error: (error as Error).message });
      }
      res.status(500).json({ message: 'Failed to schedule the route', error: (error as Error).message });
    }
  });

  /**
   * Clear a planned day.
   *
   * Removes only what the route planner put on that date, leaving anything
   * entered by hand alone — the same rule the replace path follows, for the same
   * reason: undoing a plan is not permission to empty a calendar.
   */
  router.delete('/schedule/route', authenticate, requirePermission('delete_route_plan'), validateScalarRequest, async (req, res) => {
  const requestQuery = scalarQuery(req);
    try {
      const userId = req.userId;
      const { date } = requestQuery;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
        return res.status(400).json({ message: 'A date (YYYY-MM-DD) is required' });
      }

      const deletedCount = await calendarData.clearPlannedDay(String(userId), String(date));

      emitScheduleUpdate({ type: 'bulk', userId, count: deletedCount });
      console.log(`🗺️ Route cleared: ${deletedCount} planned stops on ${date} for user ${userId}`);
      res.json({ deleted: deletedCount, date });
    } catch (error) {
      console.error('Clear route error:', error);
      res.status(500).json({ message: 'Failed to clear the planned day', error: (error as Error).message });
    }
  });

  // Update schedule item: only the fields a write may set (never userId or
  // source), checked the same way as a create, with a start sent alone checked
  // against the entry's stored end.
  router.put('/schedule/:id', verifyAnyAuth, validateScalarRequest, async (req, res) => {
  const requestParams = scalarParams(req);
    try {
      const userId = req.userId || req.customerId;
      const { id } = requestParams;
      if (!isObjectId(id)) return res.status(404).json({ message: 'Schedule item not found' });

      const saved = await calendarData.updateCalendarEntry(String(userId), id, req.body);
      if (saved.kind === 'notFound') return res.status(404).json({ message: 'Schedule item not found' });
      if (saved.kind === 'invalid') return res.status(400).json({ message: saved.message });
      if (saved.kind === 'noCustomer') return res.status(400).json({ message: 'That customer no longer exists' });
      const item = saved.entry;

      emitScheduleUpdate({ type: 'upsert', userId, id: String(item._id) });

      res.json(item);
    } catch (error) {
      console.error('Update schedule error:', error);
      res.status(500).json({ message: 'Failed to update schedule entry' });
    }
  });

  // Delete schedule item
  router.delete('/schedule/:id', verifyAnyAuth, validateScalarRequest, async (req, res) => {
  const requestParams = scalarParams(req);
    try {
      const userId = req.userId || req.customerId;
      const { id } = requestParams;

      if (!(await calendarData.deleteCalendarEntry(String(userId), id))) {
        return res.status(404).json({ message: 'Schedule item not found' });
      }

      emitScheduleUpdate({ type: 'delete', userId, id: String(id) });

      res.json({ success: true });
    } catch (error) {
      console.error('Delete schedule error:', error);
      res.status(500).json({ message: 'Failed to delete schedule entry' });
    }
  });

  // The authenticated owner can retrieve or rotate their subscription link.
  // Creating the seed conditionally keeps concurrent first reads on one link.
  const subscription = (rotate: boolean) => async (req: Request, res: Response) => {
    if (!req.userId || req.user?.type === 'customer') return res.status(403).json({ message: 'Staff access required' });
    try {
      let owner = await User.findOneAndUpdate(
        { _id: req.userId, ...(rotate ? {} : { calendarFeedKey: null }) },
        { $set: { calendarFeedKey: randomBytes(32).toString('hex') } },
        { returnDocument: 'after' }
      ).select('+calendarFeedKey').lean();
      if (!owner) owner = await User.findById(req.userId).select('+calendarFeedKey').lean();
      if (!owner || !owner.calendarFeedKey || owner.isActive === false || owner.mustChangePassword) return res.sendStatus(403);
      const token = calendarFeedToken(String(owner._id), owner.calendarFeedKey, JWT_SECRET);
      res.json({ path: `/api/calendar/feed/${owner._id}.ics?token=${token}` });
    } catch (error) {
      console.error('Calendar subscription error:', error);
      res.status(500).json({ message: 'Could not load the calendar subscription link' });
    }
  };
  router.get('/calendar/subscription', authenticate, subscription(false));
  router.post('/calendar/subscription/rotate', authenticate, subscription(true));

  // Read-only feed for calendar clients, using its own revocable credential.
  router.get('/calendar/feed/:userId.ics', validateScalarRequest, async (req, res) => {
  const requestParams = scalarParams(req);
  const requestQuery = scalarQuery(req);
    try {
      const { userId } = requestParams;

      // Validate ObjectId
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).send('Invalid user ID');
      }

      // A deactivated user's calendar subscription stops with their account
      // (Users & Roles); so does one for an account that no longer exists.
      const owner = await User.findById(userId).select('isActive mustChangePassword +calendarFeedKey').lean();
      if (!owner || owner.isActive === false || owner.mustChangePassword
          || !validCalendarFeedToken(requestQuery.token, userId, owner.calendarFeedKey, JWT_SECRET)) {
        return res.status(404).send('Calendar not found');
      }

      // Find all scheduled activities for this user (exclude cancelled ones)
      const schedules = await Schedule.find({
        userId,
        status: { $ne: 'Cancelled' }
      })
        .populate<{ customerId: Pick<CustomerData, 'company' | 'contactName'> | null }>('customerId', 'contactName company')
        .lean();

      // Helper to format Date objects / strings to iCal date format (YYYYMMDDTHHmmssZ)
      const formatIcsDate = (dateVal: Date | string | null | undefined) => {
        if (!dateVal) return '';
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return '';

        const pad = (n: number) => String(n).padStart(2, '0');
        const year = d.getUTCFullYear();
        const month = pad(d.getUTCMonth() + 1);
        const day = pad(d.getUTCDate());
        const hours = pad(d.getUTCHours());
        const minutes = pad(d.getUTCMinutes());
        const seconds = pad(d.getUTCSeconds());

        return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
      };

      // Build iCalendar string
      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//EasyStones//CalendarFeed//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Easy Stones Schedule',
        'X-WR-TIMEZONE:UTC',
        'X-WR-CALDESC:Meetings, calls, and visits scheduled in Easy Stones website.'
      ];

      schedules.forEach((item) => {
        const clientName = item.customerId 
          ? (item.customerId.company || item.customerId.contactName || 'Unnamed Customer') 
          : 'Unknown Customer';

        const startStr = formatIcsDate(item.startTime);
        // An entry with no end time lasts DEFAULT_VISIT_MINUTES, the same as the
        // planners assume when they look for a free slot.
        let endStr = formatIcsDate(item.endTime);
        if (!endStr && item.startTime) {
          const startDateObj = new Date(item.startTime);
          startDateObj.setMinutes(startDateObj.getMinutes() + DEFAULT_VISIT_MINUTES);
          endStr = formatIcsDate(startDateObj);
        }

        const uid = `${item._id}@easystones.com`;
        const createdStr = formatIcsDate(item.createdAt || new Date());
        const modifiedStr = formatIcsDate(item.updatedAt || new Date());

        // Clean text fields of newlines and commas for ICS spec
        const cleanText = (str: string) => {
          if (!str) return '';
          return str.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
        };

        const summary = cleanText(`${item.activityType || 'Visit'} - ${clientName}`);
        const notes = cleanText(item.notes || '');

        icsContent.push('BEGIN:VEVENT');
        icsContent.push(`UID:${uid}`);
        icsContent.push(`DTSTAMP:${createdStr}`);
        icsContent.push(`LAST-MODIFIED:${modifiedStr}`);
        if (startStr) icsContent.push(`DTSTART:${startStr}`);
        if (endStr) icsContent.push(`DTEND:${endStr}`);
        icsContent.push(`SUMMARY:${summary}`);
        if (notes) icsContent.push(`DESCRIPTION:${notes}`);
        icsContent.push('STATUS:CONFIRMED');
        icsContent.push('END:VEVENT');
      });

      icsContent.push('END:VCALENDAR');

      // Join with CRLF lines according to iCal specifications
      const responseText = icsContent.join('\r\n');

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline; filename="calendar.ics"');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.send(responseText);
    } catch (error) {
      console.error('Error generating calendar feed:', error);
      res.status(500).send('Error generating calendar feed');
    }
  });

  // Helper to determine the standard OAuth callback redirect URI
  const getRedirectUri = (req: Request) => {
    const host = req.get('host')!;
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? 'http' : 'https';
    return `${protocol}://${host}/api/auth/google/calendar/callback`;
  };

  // Helper: Refresh expired Google Access Token using the user's Refresh Token
  const refreshGoogleAccessToken = async (user: Loose) => {
    if (!user.googleRefreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: user.googleRefreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Token refresh failed for user ${user.username}:`, errText);
      throw new Error('Failed to refresh Google access token');
    }

    const data = await response.json();
    user.googleAccessToken = data.access_token;
    await user.save();
    return data.access_token;
  };

  // Core Helper: Perform Two-Way synchronization between MongoDB Schedules and Google Calendar
  const syncGoogleCalendar = async (userId: string | undefined, timeZone: string | undefined) => {
    try {
      const user = await User.findById(userId);
      if (!user || !user.googleCalendarSyncEnabled || !user.googleAccessToken) {
        return;
      }

      const accessToken = user.googleAccessToken;

      const fetchGoogleEvents = async (token: string) => {
        const timeMin = new Date();
        timeMin.setDate(timeMin.getDate() - 30);
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + 90);

        const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
          `timeMin=${encodeURIComponent(timeMin.toISOString())}` +
          `&timeMax=${encodeURIComponent(timeMax.toISOString())}` +
          `&singleEvents=true`;

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.status === 401) {
          const newToken = await refreshGoogleAccessToken(user);
          return fetchGoogleEvents(newToken);
        }

        if (!res.ok) {
          throw new Error(`Google Calendar API error: ${res.statusText}`);
        }

        return res.json();
      };

      const data = await fetchGoogleEvents(accessToken);
      const googleEvents = data.items || [];

      // A sync that pulled nothing new should not make every open planner refetch,
      // so the broadcast at the end waits on this.
      let plannerChanged = false;

      // 1. Google -> Sales Planner Sync
      for (const gEvent of googleEvents) {
        const isSyncedFromApp = gEvent.description && gEvent.description.includes('EasyStones ID:');
        if (isSyncedFromApp) {
          continue;
        }

        const startTime = gEvent.start?.dateTime || gEvent.start?.date;
        const endTime = gEvent.end?.dateTime || gEvent.end?.date;

        // src/db/customers: MongoDB, or Postgres once DB_CUSTOMERS=postgres.
        if (await calendarData.importGoogleEvent(String(userId), {
          id: gEvent.id, status: gEvent.status, description: gEvent.description, startTime, endTime
        }, { entryId: newId(), customerId: newId() })) plannerChanged = true;
      }

      // 2. Sales Planner -> Google Sync
      const appSchedules = await calendarData.entriesToSync(String(userId), 'google');

      // schedule.startTime/endTime are naive wall-clock strings (no zone) —
      // whatever time the rep meant in THEIR OWN zone, not the server's. This
      // function runs server-side, so `new Date(schedule.startTime)` would
      // read that clock face as if it were the server's zone (UTC in
      // production) instead, shifting every synced event by however many
      // hours separate the two — see zonedTimeToUtc's own comment
      // (dateUtils.js) for the full story. `timeZone` is the rep's own IANA
      // zone, sent by the client alongside the sync request (viewerTimeZone
      // in SalesPage.jsx); falls back to the company's own default (Seattle —
      // see User.js's assignedLocations) if a caller doesn't supply one.
      const zone = timeZone || 'America/Los_Angeles';

      for (const schedule of appSchedules) {
        const syncedMatch = schedule.notes && schedule.notes.match(/Synced to Google ID: ([a-zA-Z0-9_]+)/);
        const clientName = schedule.customerId
          ? (schedule.customerId.company || schedule.customerId.contactName || 'Unnamed Customer')
          : 'Unknown Customer';

        const startUtc = zonedTimeToUtc(schedule.startTime, zone);
        const endUtc = schedule.endTime
          ? zonedTimeToUtc(schedule.endTime, zone)
          : new Date(startUtc!.getTime() + 3600000);

        const eventPayload = {
          summary: `${schedule.activityType || 'Visit'} - ${clientName}`,
          description: `${schedule.notes || ''}\n\n[EasyStones ID: ${schedule._id}]`,
          start: { dateTime: startUtc!.toISOString(), timeZone: zone },
          end: { dateTime: endUtc!.toISOString(), timeZone: zone }
        };

        if (syncedMatch) {
          const googleEventId = syncedMatch[1];
          const updateUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleEventId}`;
          await fetch(updateUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventPayload)
          });
        } else {
          const createUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
          const createRes = await fetch(createUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventPayload)
          });

          if (createRes.ok) {
            const createdEvent = await createRes.json();
            schedule.notes = `${schedule.notes || ''}\n\n[Synced to Google ID: ${createdEvent.id}]`;
            await calendarData.markEntrySynced(String(schedule._id), schedule.notes);
            plannerChanged = true;
          }
        }
      }

      if (plannerChanged) {
        emitScheduleUpdate({ type: 'sync', userId });
      }
    } catch (err) {
      console.error(`Error in syncGoogleCalendar for user ${userId}:`, err);
    }
  };

  // Route: Initiate Google OAuth Redirection for Calendar Sync
  router.get('/auth/google/calendar', validateScalarRequest, async (req, res) => {
  const requestQuery = scalarQuery(req);
    try {
      const { token } = requestQuery;
      if (!token) {
        return res.status(401).send('Authentication token is required');
      }

      let decoded!: Loose;
      try {
        decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
      } catch {
        return res.status(401).send('Invalid or expired authentication token');
      }

      const userId = decoded.id;
      if (!userId) {
        return res.status(401).send('Invalid token payload');
      }

      const client_id = process.env.GOOGLE_CLIENT_ID!;
      const client_secret = process.env.GOOGLE_CLIENT_SECRET!;

      if (!client_id || !client_secret) {
        return res.status(400).send('Google Client credentials are not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment variables.');
      }

      const redirect_uri = getRedirectUri(req);
      const scope = 'https://www.googleapis.com/auth/calendar';
      const state = token;

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(client_id)}` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scope)}` +
        `&access_type=offline` +
        `&prompt=consent` +
        `&state=${encodeURIComponent(state)}`;

      res.redirect(authUrl);
    } catch (error) {
      console.error('Google calendar auth redirect error:', error);
      res.status(500).send('Error initiating Google Calendar authorization');
    }
  });

  // Route: Google OAuth Redirect callback to parse code and save user tokens
  router.get('/auth/google/calendar/callback', validateScalarRequest, async (req, res) => {
  const requestQuery = scalarQuery(req);
    try {
      const { code, state, error } = requestQuery;

      if (error) {
        console.error('Google OAuth callback error:', error);
        return res.redirect('/sales?error=google_auth_failed');
      }

      if (!code || !state) {
        return res.status(400).send('Missing authorization code or state');
      }

      let decoded!: Loose;
      try {
        decoded = jwt.verify(state, JWT_SECRET) as Loose;
      } catch {
        return res.status(401).send('Invalid or expired state token');
      }

      const userId = decoded.id;
      if (!userId) {
        return res.status(401).send('Invalid state payload');
      }

      const client_id = process.env.GOOGLE_CLIENT_ID!;
      const client_secret = process.env.GOOGLE_CLIENT_SECRET!;
      const redirect_uri = getRedirectUri(req);

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id,
          client_secret,
          redirect_uri,
          grant_type: 'authorization_code'
        })
      });

      if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
        console.error('Google token exchange failed:', errText);
        return res.status(500).send('Failed to exchange authorization code for tokens');
      }

      const tokens = await tokenResponse.json();
      const { access_token, refresh_token } = tokens;

      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      let googleEmail = null;
      if (profileResponse.ok) {
        const profile = await profileResponse.json();
        googleEmail = profile.email;
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).send('User not found');
      }

      user.googleAccessToken = access_token;
      if (refresh_token) {
        user.googleRefreshToken = refresh_token;
      }
      user.googleEmail = googleEmail;
      user.googleCalendarSyncEnabled = true;
      await user.save();

      console.log(`✅ Google Calendar linked for user: ${user.username} (${googleEmail})`);

      // Redirect to sales page with confirmation
      res.redirect('/sales?google_sync=success');
    } catch (error) {
      console.error('Google calendar OAuth callback error:', error);
      res.status(500).send('Error completing Google Calendar integration');
    }
  });

  // Route: Get current user's Google Calendar integration status
  router.get('/auth/google/calendar/status', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      const user = await User.findById(userId).select('googleEmail googleCalendarSyncEnabled').lean();
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json({
        connected: !!user.googleEmail && user.googleCalendarSyncEnabled,
        email: user.googleEmail
      });
    } catch (error) {
      console.error('Google calendar status error:', error);
      res.status(500).json({ message: 'Failed to fetch status' });
    }
  });

  // Route: Trigger manual synchronization cycle
  router.post('/auth/google/calendar/sync', verifyAnyAuth, validateScalarRequest, async (req, res) => {
  const requestQuery = scalarQuery(req);
    try {
      const userId = req.userId || req.customerId;
      await syncGoogleCalendar(userId, requestQuery.tz);
      res.json({ success: true, message: 'Google Calendar synchronized successfully' });
    } catch (error) {
      console.error('Google calendar sync trigger error:', error);
      res.status(500).json({ message: 'Failed to synchronize Google Calendar' });
    }
  });

  // Route: Disconnect calendar integration
  router.post('/auth/google/calendar/disconnect', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      user.googleAccessToken = null;
      user.googleRefreshToken = null;
      user.googleEmail = null;
      user.googleCalendarSyncEnabled = false;
      await user.save();

      res.json({ success: true, message: 'Google Calendar disconnected successfully' });
    } catch (error) {
      console.error('Google calendar disconnect error:', error);
      res.status(500).json({ message: 'Failed to disconnect Google Calendar' });
    }
  });

  // Route: Connect Apple iCloud Calendar (Discover or Save)
  router.post('/auth/icloud/connect', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      const { appleId, appSpecificPassword, calendarUrl, calendarName, tz } = req.body;

      if (!appleId || !appSpecificPassword) {
        return res.status(400).json({ message: 'Apple ID and App-Specific Password are required' });
      }

      if (!calendarUrl) {
        // Step 1: Discover available calendars
        const calendars = await discoverICloudCalendars(appleId, appSpecificPassword);
        return res.json({ success: true, calendars });
      } else {
        // Step 2: Save the user's selected calendar url & name
        const user = await User.findById(userId);
        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }

        user.icloudUsername = appleId;
        user.icloudPassword = appSpecificPassword;
        user.icloudCalendarUrl = calendarUrl;
        user.icloudCalendarName = calendarName || 'Primary Calendar';
        user.icloudSyncEnabled = true;
        await user.save();

        // Trigger initial sync cycle
        if (await syncICloudCalendar(userId!, tz)) {
          emitScheduleUpdate({ type: 'sync', userId });
        }

        return res.json({
          success: true,
          message: 'iCloud Calendar connected successfully',
          calendarName: user.icloudCalendarName
        });
      }
    } catch (error) {
      console.error('iCloud calendar connection error:', error);
      res.status(500).json({ message: (error as Error).message || 'Failed to connect to iCloud' });
    }
  });

  // Route: Get iCloud Sync status
  router.get('/auth/icloud/status', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      const user = await User.findById(userId).select('icloudUsername icloudCalendarName icloudSyncEnabled').lean();
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json({
        connected: !!user.icloudUsername && user.icloudSyncEnabled,
        email: user.icloudUsername,
        calendarName: user.icloudCalendarName
      });
    } catch (error) {
      console.error('iCloud status error:', error);
      res.status(500).json({ message: 'Failed to fetch iCloud status' });
    }
  });

  // Route: Trigger manual iCloud Sync
  router.post('/auth/icloud/sync', verifyAnyAuth, validateScalarRequest, async (req, res) => {
  const requestQuery = scalarQuery(req);
    try {
      const userId = req.userId || req.customerId;
      if (await syncICloudCalendar(userId!, requestQuery.tz)) {
        emitScheduleUpdate({ type: 'sync', userId });
      }
      res.json({ success: true, message: 'iCloud Calendar synchronized successfully' });
    } catch (error) {
      console.error('iCloud sync trigger error:', error);
      res.status(500).json({ message: 'Failed to synchronize iCloud Calendar' });
    }
  });

  // Route: Disconnect iCloud Sync
  router.post('/auth/icloud/disconnect', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      user.icloudUsername = null;
      user.icloudPassword = null;
      user.icloudCalendarUrl = null;
      user.icloudCalendarName = null;
      user.icloudSyncEnabled = false;
      await user.save();

      res.json({ success: true, message: 'iCloud Calendar disconnected successfully' });
    } catch (error) {
      console.error('iCloud disconnect error:', error);
      res.status(500).json({ message: 'Failed to disconnect iCloud Calendar' });
    }
  });

  return router;
}
