/**
 * Calendar (Schedule) routes: a rep's planner entries, the route planner's
 * day-at-a-time writes, the private .ics feed, and the Google Calendar /
 * iCloud sync integrations. Moved out of server.js as one self-contained
 * feature, same pattern as dailyReports.js and deliveries.js — handed the
 * middleware it needs, mounted at '/api' so every URL is unchanged.
 *
 * Visits put entries on the calendar too, from server.js's visit routes, via
 * src/services/visitSchedule.js — those keep living with the visit routes.
 */
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import Schedule from '../models/Schedule.js';
import Customer from '../models/Customer.js';
import User from '../models/User.js';
import { zonedTimeToUtc } from '../utils/dateUtils.js';
import { discoverICloudCalendars, syncICloudCalendar } from '../services/icloudSyncService.js';

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
export const createScheduleEmitter = (io) => (payload) => {
  if (!payload || !payload.userId) return;
  try {
    io.emit('schedule_update', { ...payload, userId: String(payload.userId) });
  } catch (err) {
    console.warn('[schedule] broadcast failed:', err.message);
  }
};

/**
 * `emitScheduleUpdate` comes from createScheduleEmitter above — created once in
 * server.js, since the visit routes there announce calendar changes too.
 */
export default function createScheduleRouter({ authenticate, requirePermission, emitScheduleUpdate, jwtSecret }) {
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
      const pending = await Schedule.find({ status: 'Scheduled' }).select('_id customerId startTime userId');
      let linked = 0;
      for (const entry of pending) {
        const day = String(entry.startTime).slice(0, 10);
        const customerWithVisit = await Customer.findOne(
          { _id: entry.customerId, 'visits.date': day },
          { 'visits.$': 1 }
        ).lean();
        const visit = customerWithVisit?.visits?.[0];
        if (!visit) continue;

        const updated = await Schedule.findOneAndUpdate(
          { _id: entry._id, status: 'Scheduled' },
          { $set: { status: 'Completed', linkedVisitId: visit._id } },
          { new: true }
        );
        if (updated) {
          linked++;
          emitScheduleUpdate({ type: 'upsert', userId: updated.userId, id: String(updated._id) });
        }
      }
      res.json({ success: true, checked: pending.length, linked });
    } catch (error) {
      console.error('Schedule backfill error:', error);
      res.status(500).json({ message: `Backfill failed: ${error.message}` });
    }
  });

  // Get user's schedule
  router.get('/schedule', verifyAnyAuth, async (req, res) => {

    try {
      const userId = req.userId || req.customerId;
      const { start, end } = req.query;

      let query = { userId };

      if (start && end) {
        query.startTime = { $gte: start, $lte: end };
      }

      const schedule = await Schedule.find(query)
        .populate('customerId', 'contactName company')
        .sort({ startTime: 1 });

      res.json(schedule);
    } catch (error) {
      console.error('Fetch schedule error:', error);
      res.status(500).json({ message: 'Failed to fetch schedule' });
    }
  });

  // Create schedule item
  router.post('/schedule', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      const { customerId, startTime, endTime, activityType, notes } = req.body;

      if (!customerId || !startTime) {
        return res.status(400).json({ message: 'Missing required schedule fields' });
      }

      const newItem = new Schedule({
        userId,
        customerId,
        startTime,
        endTime,
        activityType,
        notes
      });

      await newItem.save();

      // Populate customer info for the response
      const populatedItem = await Schedule.findById(newItem._id).populate('customerId', 'contactName company');

      emitScheduleUpdate({ type: 'upsert', userId, id: String(newItem._id) });

      res.status(201).json(populatedItem);
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
   * Written with insertMany so the day either lands or it does not.
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

      const known = await Customer.find({ _id: { $in: wanted } }).select('_id').lean();
      if (known.length !== new Set(wanted.map(String)).size) {
        return res.status(400).json({ message: 'One or more stops name a customer that no longer exists' });
      }

      // Only ever the planner's own stops for that date, never a meeting someone
      // typed in by hand — re-planning a day is not permission to erase the rest
      // of it. The date is matched on the stored 'YYYY-MM-DDTHH:mm:ss.000' prefix.
      // `date` goes into a startTime prefix $regex: only ever a real date.
      if (replace && date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        return res.status(400).json({ message: 'A date (YYYY-MM-DD) is required to replace a day' });
      }

      let replaced = 0;
      if (replace && date) {
        const { deletedCount } = await Schedule.deleteMany({
          userId,
          source: 'route_planner',
          startTime: { $regex: `^${date}` }
        });
        replaced = deletedCount;
      }

      const created = await Schedule.insertMany(
        items.map(item => ({
          userId,
          customerId: item.customerId,
          startTime: item.startTime,
          endTime: item.endTime,
          activityType: item.activityType || 'Visit',
          notes: item.notes || '',
          source: 'route_planner'
        })),
        { ordered: true }
      );

      // One signal for the day rather than one per stop: every open planner
      // reloads the range once instead of redrawing twelve times.
      emitScheduleUpdate({ type: 'bulk', userId, count: created.length });

      const populated = await Schedule.find({ _id: { $in: created.map(item => item._id) } })
        .populate('customerId', 'contactName company')
        .sort({ startTime: 1 });

      console.log(`🗺️ Route planned: ${created.length} stops for user ${userId}${replaced ? ` (replaced ${replaced})` : ''}`);
      res.status(201).json({ stops: populated, replaced });
    } catch (error) {
      console.error('Bulk schedule error:', error);
      res.status(500).json({ message: 'Failed to schedule the route', error: error.message });
    }
  });

  /**
   * Clear a planned day.
   *
   * Removes only what the route planner put on that date, leaving anything
   * entered by hand alone — the same rule the replace path follows, for the same
   * reason: undoing a plan is not permission to empty a calendar.
   */
  router.delete('/schedule/route', authenticate, requirePermission('delete_route_plan'), async (req, res) => {
    try {
      const userId = req.userId;
      const { date } = req.query;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
        return res.status(400).json({ message: 'A date (YYYY-MM-DD) is required' });
      }

      const { deletedCount } = await Schedule.deleteMany({
        userId,
        source: 'route_planner',
        startTime: { $regex: `^${date}` }
      });

      emitScheduleUpdate({ type: 'bulk', userId, count: deletedCount });
      console.log(`🗺️ Route cleared: ${deletedCount} planned stops on ${date} for user ${userId}`);
      res.json({ deleted: deletedCount, date });
    } catch (error) {
      console.error('Clear route error:', error);
      res.status(500).json({ message: 'Failed to clear the planned day', error: error.message });
    }
  });

  // Update schedule item
  router.put('/schedule/:id', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      const { id } = req.params;
      const updates = req.body;

      const item = await Schedule.findOneAndUpdate(
        { _id: id, userId },
        updates,
        { new: true }
      ).populate('customerId', 'contactName company');

      if (!item) {
        return res.status(404).json({ message: 'Schedule item not found' });
      }

      emitScheduleUpdate({ type: 'upsert', userId, id: String(item._id) });

      res.json(item);
    } catch (error) {
      console.error('Update schedule error:', error);
      res.status(500).json({ message: 'Failed to update schedule entry' });
    }
  });

  // Delete schedule item
  router.delete('/schedule/:id', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      const { id } = req.params;

      const result = await Schedule.deleteOne({ _id: id, userId });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: 'Schedule item not found' });
      }

      emitScheduleUpdate({ type: 'delete', userId, id: String(id) });

      res.json({ success: true });
    } catch (error) {
      console.error('Delete schedule error:', error);
      res.status(500).json({ message: 'Failed to delete schedule entry' });
    }
  });

  // Private, read-only calendar feed in iCalendar (.ics) format
  router.get('/calendar/feed/:userId.ics', async (req, res) => {
    try {
      const { userId } = req.params;

      // Validate ObjectId
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).send('Invalid user ID');
      }

      // A deactivated user's calendar subscription stops with their account
      // (Users & Roles); so does one for an account that no longer exists.
      const owner = await User.findById(userId).select('isActive').lean();
      if (!owner || owner.isActive === false) {
        return res.status(404).send('Calendar not found');
      }

      // Find all scheduled activities for this user (exclude cancelled ones)
      const schedules = await Schedule.find({
        userId,
        status: { $ne: 'Cancelled' }
      })
        .populate('customerId', 'contactName company')
        .lean();

      // Helper to format Date objects / strings to iCal date format (YYYYMMDDTHHmmssZ)
      const formatIcsDate = (dateVal) => {
        if (!dateVal) return '';
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return '';

        const pad = (n) => String(n).padStart(2, '0');
        const year = d.getUTCFullYear();
        const month = pad(d.getUTCMonth() + 1);
        const day = pad(d.getUTCDate());
        const hours = pad(d.getUTCHours());
        const minutes = pad(d.getUTCMinutes());
        const seconds = pad(d.getUTCSeconds());

        return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
      };

      // Build iCalendar string
      let icsContent = [
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
        // Default to 1 hour meeting if endTime is not set or invalid
        let endStr = formatIcsDate(item.endTime);
        if (!endStr && item.startTime) {
          const startDateObj = new Date(item.startTime);
          startDateObj.setHours(startDateObj.getHours() + 1);
          endStr = formatIcsDate(startDateObj);
        }

        const uid = `${item._id}@easystones.com`;
        const createdStr = formatIcsDate(item.createdAt || new Date());
        const modifiedStr = formatIcsDate(item.updatedAt || new Date());

        // Clean text fields of newlines and commas for ICS spec
        const cleanText = (str) => {
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
  const getRedirectUri = (req) => {
    const host = req.get('host');
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? 'http' : 'https';
    return `${protocol}://${host}/api/auth/google/calendar/callback`;
  };

  // Helper: Refresh expired Google Access Token using the user's Refresh Token
  const refreshGoogleAccessToken = async (user) => {
    if (!user.googleRefreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
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
  const syncGoogleCalendar = async (userId, timeZone) => {
    try {
      const user = await User.findById(userId);
      if (!user || !user.googleCalendarSyncEnabled || !user.googleAccessToken) {
        return;
      }

      let accessToken = user.googleAccessToken;

      const fetchGoogleEvents = async (token) => {
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

        const existingImport = await Schedule.findOne({
          userId,
          notes: new RegExp(`Google ID: ${gEvent.id}`)
        });

        if (gEvent.status === 'cancelled') {
          if (existingImport) {
            await Schedule.deleteOne({ _id: existingImport._id });
            plannerChanged = true;
          }
          continue;
        }

        const startTime = gEvent.start.dateTime || gEvent.start.date;
        const endTime = gEvent.end.dateTime || gEvent.end.date;

        if (!startTime) continue;

        if (existingImport) {
          const notes = `Google Calendar Event\n[Google ID: ${gEvent.id}]\n\n${gEvent.description || ''}`;
          if (
            String(existingImport.startTime) !== String(startTime) ||
            String(existingImport.endTime) !== String(endTime) ||
            existingImport.notes !== notes
          ) {
            existingImport.startTime = startTime;
            existingImport.endTime = endTime;
            existingImport.notes = notes;
            await existingImport.save();
            plannerChanged = true;
          }
        } else {
          let syncCustomer = await Customer.findOne({ company: 'Google Calendar Sync' });
          if (!syncCustomer) {
            syncCustomer = new Customer({
              company: 'Google Calendar Sync',
              contactName: 'Google Event Sync',
              phone: '000-000-0000',
              email: 'sync@easystones.com',
              status: 'Lead'
            });
            await syncCustomer.save();
          }

          const newItem = new Schedule({
            userId,
            customerId: syncCustomer._id,
            startTime,
            endTime,
            activityType: 'Other',
            notes: `Google Calendar Event\n[Google ID: ${gEvent.id}]\n\n${gEvent.description || ''}`,
            status: 'Scheduled'
          });
          await newItem.save();
          plannerChanged = true;
        }
      }

      // 2. Sales Planner -> Google Sync
      const appSchedules = await Schedule.find({
        userId,
        notes: { $not: /Google ID:/ },
        status: { $ne: 'Cancelled' }
      }).populate('customerId', 'contactName company');

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
          : new Date(startUtc.getTime() + 3600000);

        const eventPayload = {
          summary: `${schedule.activityType || 'Visit'} - ${clientName}`,
          description: `${schedule.notes || ''}\n\n[EasyStones ID: ${schedule._id}]`,
          start: { dateTime: startUtc.toISOString(), timeZone: zone },
          end: { dateTime: endUtc.toISOString(), timeZone: zone }
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
            await schedule.save();
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
  router.get('/auth/google/calendar', async (req, res) => {
    try {
      const { token } = req.query;
      if (!token) {
        return res.status(401).send('Authentication token is required');
      }

      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch {
        return res.status(401).send('Invalid or expired authentication token');
      }

      const userId = decoded.id;
      if (!userId) {
        return res.status(401).send('Invalid token payload');
      }

      const client_id = process.env.GOOGLE_CLIENT_ID;
      const client_secret = process.env.GOOGLE_CLIENT_SECRET;

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
  router.get('/auth/google/calendar/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;

      if (error) {
        console.error('Google OAuth callback error:', error);
        return res.redirect('/sales?error=google_auth_failed');
      }

      if (!code || !state) {
        return res.status(400).send('Missing authorization code or state');
      }

      let decoded;
      try {
        decoded = jwt.verify(state, JWT_SECRET);
      } catch {
        return res.status(401).send('Invalid or expired state token');
      }

      const userId = decoded.id;
      if (!userId) {
        return res.status(401).send('Invalid state payload');
      }

      const client_id = process.env.GOOGLE_CLIENT_ID;
      const client_secret = process.env.GOOGLE_CLIENT_SECRET;
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
  router.post('/auth/google/calendar/sync', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      await syncGoogleCalendar(userId, req.query.tz);
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
        if (await syncICloudCalendar(userId, tz)) {
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
      res.status(500).json({ message: error.message || 'Failed to connect to iCloud' });
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
  router.post('/auth/icloud/sync', verifyAnyAuth, async (req, res) => {
    try {
      const userId = req.userId || req.customerId;
      if (await syncICloudCalendar(userId, req.query.tz)) {
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
