import express from 'express';

import OfficeCheckIn from '../models/OfficeCheckIn.js';
import Location from '../models/Location.js';
import User from '../models/User.js';
import { sendCheckInAlertEmail, sendSelectionSheetEmail } from '../services/emailService.js';
import { stripPhone, formatPhoneForDisplay, maskPhone } from '../utils/phoneUtils.js';
import { letterheadFor } from '../utils/locationForm.js';
import { cleanSelections, repEmailSnapshot } from '../utils/selectionSheet.js';
import { homeLocationOf } from '../utils/locationFilter.js';
import { byBranchClock } from '../utils/checkInClock.js';
import { buildCheckInLogPdf } from '../utils/checkInLogPdf.js';
import { CHECKIN_PDF_MAX_ROWS, checkInExportScope, checkInExportFileName } from '../utils/checkInExport.js';
import rateLimit from 'express-rate-limit';

/**
 * Office Check-In / Visitor Log API.
 *
 * Kept out of server.js deliberately, same reasoning as
 * src/routes/deliveries.js and src/routes/dailyReports.js: a self-contained
 * feature, and server.js is already thousands of lines. Auth middleware is
 * handed in rather than imported, matching those two; everything specific to
 * this feature (the model, the email templates, phone formatting, the
 * timezone-aware day/month math the list and stats routes share) is imported
 * directly here instead.
 *
 *   import createCheckInRouter, { checkinRoomFor, CHECKIN_ROOM_ALL } from './src/routes/checkIn.js';
 *   app.use('/api/checkin', createCheckInRouter({ authenticate, requirePermission }));
 *
 * Every route below is relative to that mount point.
 */

// ── Socket.IO room scoping ───────────────────────────────────────────────
// Same pattern as deliveries.js's deliveryRoomFor/DELIVERY_ROOM_ALL: a
// plain `io.emit('checkin_update')` broadcasts to every connected socket
// company-wide on every check-in create/update/delete, regardless of
// whether that viewer can even see the location involved. A dedicated
// constant (rather than inlining the template literal everywhere) so the
// join side (server.js's io.on('connection') handler) and the emit side
// below can't drift apart on the naming scheme.
const checkinRoomFor = (location) => `checkin-location:${location}`;
// Sockets whose user holds '*' join this instead of every individual branch
// room, so an admin/director keeps seeing every location without the server
// having to know the full list of branches that currently exist.
const CHECKIN_ROOM_ALL = 'checkin-location:*';

const checkinRoomsFor = (location) => {
  const rooms = [CHECKIN_ROOM_ALL];
  if (location) rooms.push(checkinRoomFor(location));
  return rooms;
};

// `req.app.get('io')` rather than a captured module-level `io` — app.set
// ('io', io) runs in server.js before any request reaches this router, so
// it's always populated by the time a route handler needs it.
const emitCheckInUpdate = (req, location) => {
  const io = req.app.get('io');
  if (!io) return;
  for (const room of checkinRoomsFor(location)) {
    io.to(room).emit('checkin_update');
  }
};

// Neutralises regex metacharacters before interpolating user input into a
// RegExp. Duplicated from server.js's own copy (used there by several
// unrelated features) rather than threaded through as a dependency — it's a
// one-line pure function with no state to keep in sync.
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every phone field is stored the way formatPhoneInput renders it —
// "(206) 555-1234" — but a search box that says "Search by name, phone..."
// invites someone to type the digits plain: "2065551234" or "206555". That
// string never appears contiguously inside the punctuated form, so a bare
// substring/regex search against it silently returns nothing. This builds a
// regex that tolerates whatever punctuation formatPhoneInput inserts between
// digits, so digit-only (or partial) input matches the stored format — the
// same trick GET /lookup already relies on by reformatting its query
// instead. Returns null when there aren't enough digits to search on, so a
// short numeric fragment (e.g. a house number in a name) doesn't turn into
// an overly broad match against every phone number.
const digitTolerantPhoneRegex = (search) => {
  const digits = String(search).replace(/\D/g, '');
  if (digits.length < 3) return null;
  return new RegExp(digits.split('').map(escapeRegex).join('[\\s().-]*'), 'i');
};

// "Which day/month does this check-in belong to" is answered on its own
// branch's clock (byBranchClock in src/utils/checkInClock.js), the same way
// the Daily Report counts visitors. It used to be the viewer's zone (?tz=),
// so a Seattle admin filed an Atlanta visit at 12:30 AM Oct 1 under
// September while Atlanta's report counted it on Oct 1. ?tz= is now ignored.

const zoneFormatters = new Map();
const zoneFormatter = (timeZone) => {
  if (!zoneFormatters.has(timeZone)) {
    zoneFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
  }
  return zoneFormatters.get(timeZone);
};

// How far behind UTC the zone is at a given instant (resolves DST automatically).
// Reading the formatted parts back as if they were UTC keeps this independent of
// the server's own timezone — the round-trip-through-toLocaleString trick this
// replaced silently returned 0 whenever the host was already in that zone.
const zoneOffsetMs = (date, timeZone) => {
  const parts = {};
  for (const { type, value } of zoneFormatter(timeZone).formatToParts(date)) parts[type] = value;
  const wallClockAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return date.getTime() - wallClockAsUtc;
};

// The calendar date it currently is in the given zone.
const zoneDateParts = (date, timeZone) => {
  const parts = {};
  for (const { type, value } of zoneFormatter(timeZone).formatToParts(date)) parts[type] = value;
  return { year: Number(parts.year), monthIndex: Number(parts.month) - 1, day: Number(parts.day) };
};

// The UTC instant of midnight in the given zone on a calendar date. monthIndex is
// 0-based and Date.UTC handles rollover, so month 12 becomes the next January.
const zoneMidnightUtc = (timeZone, year, monthIndex, day = 1) => {
  const naive = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
  const firstGuess = new Date(naive + zoneOffsetMs(new Date(naive), timeZone));
  // Re-derive using the offset actually in force at that instant so dates next
  // to a DST switch don't land an hour out.
  return new Date(naive + zoneOffsetMs(firstGuess, timeZone));
};

// ── Location access ──────────────────────────────────────────────────────
// Every check-in route scopes by the caller's assignedLocations ('*' sees
// everything). This used to be a `!userLocations.includes('*') &&
// !userLocations.includes(x)` copy-pasted into six different routes — which
// is exactly how POST /api/checkin ended up as the one route that silently
// swapped an inaccessible location for a default instead of rejecting it
// (see that route below). One helper now backs all of them.
const hasLocationAccess = (userLocations, location) =>
  userLocations.includes('*') || userLocations.includes(location);

// Builds the `location` clause for a query scoped to what this user can see.
// `requestedLocation` is an explicit ?location= filter the caller asked for;
// with none, the clause covers every location the user is assigned to.
// Returns `{ forbidden: true }` instead of a clause when the caller asked
// for a specific location they can't see, so the route can 403 on it.
const locationFilterFor = (userLocations, requestedLocation) => {
  if (userLocations.includes('*')) {
    return requestedLocation ? { location: requestedLocation } : {};
  }
  if (requestedLocation) {
    return hasLocationAccess(userLocations, requestedLocation)
      ? { location: requestedLocation }
      : { forbidden: true };
  }
  return { location: { $in: userLocations } };
};

/**
 * The Check-In Log's filters as one Mongo query: the branches this user may
 * see (or the one they picked), the month on each check-in's own branch
 * clock, and the search. Shared by the list (GET /) and its PDF
 * (GET /export.pdf) so the PDF is always exactly what the list shows.
 * Returns { forbidden: true } for a branch they can't see.
 */
const checkInListQuery = (userLocations, { search, month, year, location } = {}) => {
  const locFilter = locationFilterFor(userLocations, location);
  if (locFilter.forbidden) return { forbidden: true };
  // Location, month and search clauses, ANDed — the month window and the
  // search can each be an $or of their own.
  const clauses = [];
  const m = parseInt(month);
  const y = parseInt(year);
  if (m >= 1 && m <= 12 && y > 2000) {
    // The month on each check-in's own branch clock, matching GET /stats
    // and the Daily Report.
    clauses.push(byBranchClock(locFilter, (zone) => ({
      $gte: zoneMidnightUtc(zone, y, m - 1, 1),
      $lt: zoneMidnightUtc(zone, y, m, 1)
    })));
  } else if (locFilter.location) {
    clauses.push(locFilter);
  }
  if (search) {
    const searchRegex = new RegExp(escapeRegex(search), 'i');
    const orClauses = [
      { name: searchRegex },
      { phone: searchRegex },
      { fabricatorCompany: searchRegex },
      { fabricatorPhone: searchRegex }
    ];
    const phoneRegex = digitTolerantPhoneRegex(search);
    if (phoneRegex) {
      orClauses.push({ phone: phoneRegex }, { fabricatorPhone: phoneRegex });
    }
    clauses.push({ $or: orClauses });
  }
  return { locFilter, query: clauses.length > 1 ? { $and: clauses } : (clauses[0] || {}) };
};

/** A time zone the browser sent (?tz=), or undefined when it isn't a real one. */
const validZone = (tz) => {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(tz) });
    return String(tz);
  } catch {
    return undefined;
  }
};

// A double-tap on a touchscreen kiosk, or a client retrying after a slow/
// ambiguous response, submits the same visit twice. That's not just a
// cosmetic duplicate row — Daily Work Report auto-derives its visitor count
// straight from OfficeCheckIn.countDocuments for the day (src/routes/
// dailyReports.js), so an uncaught duplicate silently inflates a report
// nobody re-checks against reality once it's submitted. Same phone + same
// location within a couple minutes is the same visit, not a second one.
const DUPLICATE_CHECKIN_WINDOW_MS = 2 * 60 * 1000;
async function findRecentDuplicateCheckIn(phone, location) {
  if (!phone || !location) return null;
  return OfficeCheckIn.findOne({
    phone,
    location,
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_CHECKIN_WINDOW_MS) }
  }).sort({ createdAt: -1 }).lean();
}

// The self check-in QR/NFC route is the only unauthenticated write in the
// whole check-in feature — anyone who can reach it can create a record and
// trigger an email, with no login to blame it on. A real visitor submits
// once per physical visit, so this is deliberately far tighter than
// apiLimiter's shared 500/5min.
const selfCheckInLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many check-in attempts. Please ask the front desk for help.' }
});

// The address/contact printed under "EASY STONES" on a selection sheet: the
// check-in's own location's, or the Kent default when it has none yet.
const letterheadForCheckIn = async (checkIn) => {
  try {
    return letterheadFor(await Location.findOne({ name: checkIn.location }).lean());
  } catch {
    return letterheadFor(null);
  }
};

export default function createCheckInRouter({ authenticate, requirePermission }) {
  const router = express.Router();

  // Submit check-in (requires authenticated kiosk/staff session)
  // Gated on manage_checkins — every role that can view the check-in log and
  // actually work the front desk (csr, sales_rep, manager, director, admin)
  // holds it, but a role with no check-in permissions at all (e.g. driver)
  // used to be able to create records here with just a login, since this was
  // the one check-in route with no requirePermission check.
  router.post('/', authenticate, requirePermission('manage_checkins'), async (req, res) => {
    try {
      const {
        name,
        phone,
        email,
        fabricatorCompany,
        fabricatorName,
        fabricatorPhone,
        location: bodyLocation
      } = req.body;

      if (!name || !phone) {
        return res.status(400).json({ message: 'Name and phone number are required' });
      }

      // Canonicalized to the same (XXX) XXX-XXXX form the UI always sends, so a
      // phone submitted in some other shape (a direct API call bypassing the
      // form's own formatting) still matches this visitor's other records for
      // duplicate detection, lookup and search instead of silently reading as
      // a different person. formatPhoneForDisplay no-ops on anything that
      // isn't a clean 10-digit number, so this never corrupts odd input.
      const normalizedPhone = formatPhoneForDisplay(stripPhone(phone)) || phone;

      // Same access check every other check-in route enforces. A requested
      // location the user isn't assigned to used to be silently swapped for
      // their own default location instead of rejected — the check-in still
      // saved, just filed under a branch nobody chose, with no error shown.
      const userLocations = req.user?.assignedLocations || [];
      let kioskLocation;
      if (bodyLocation) {
        if (!hasLocationAccess(userLocations, bodyLocation)) {
          return res.status(403).json({ message: 'Access denied to this location' });
        }
        kioskLocation = bodyLocation;
      } else {
        // Their home location (Users & Roles), the same branch the check-in
        // page opens on. It used to be the first assigned branch, so a CSR
        // based in Dallas who also covers Seattle filed visitors under Seattle.
        kioskLocation = homeLocationOf({ location: req.authUserDoc?.location, assignedLocations: userLocations })
          || userLocations.find(l => l !== '*')
          || 'Seattle';
      }

      const duplicate = await findRecentDuplicateCheckIn(normalizedPhone, kioskLocation);
      if (duplicate) {
        return res.status(200).json({
          success: true,
          message: 'Check-in successful! Welcome to Easy Stones.',
          data: duplicate,
          duplicate: true
        });
      }

      const checkIn = new OfficeCheckIn({
        name,
        phone: normalizedPhone,
        email,
        fabricatorCompany,
        fabricatorName,
        fabricatorPhone,
        location: kioskLocation,
        loggedBy: {
          userId: req.user?.id,
          displayName: req.user?.displayName || '',
          username: req.user?.username
        }
      });

      await checkIn.save();
      console.log(`✅ New office check-in ${checkIn._id} at ${checkIn.location} (logged by ${req.user?.displayName || req.user?.username}), phone ${maskPhone(normalizedPhone)}`);

      // Send email alert to staff with priority fallback logic
      (async () => {
        try {
          await sendCheckInAlertEmail(checkIn);
        } catch (err) {
          console.error('❌ Check-in email dispatch exception:', err.message);
        }
      })();

      emitCheckInUpdate(req, checkIn.location);

      res.status(201).json({
        success: true,
        message: 'Check-in successful! Welcome to Easy Stones.',
        data: checkIn
      });
    } catch (error) {
      console.error('❌ Check-in error:', error);
      res.status(500).json({ message: 'Check-in failed. Please try again.' });
    }
  });

  // Public QR/NFC self check-in — a visitor's own phone, never logged in, so
  // this is the one write in the whole feature that deliberately has no
  // `authenticate`. It used to POST to the route above, which 401'd every
  // single real visitor (their phone has no session token or cookie) — this
  // existed for months without ever recording one genuine self-check-in.
  // Because it's unauthenticated it can't trust req.user for location or
  // anti-abuse the way the staff route does, so both are re-derived here:
  // location is checked against real Location documents instead of an
  // assignedLocations array, and the honeypot/minimum-fill-time checks the
  // frontend already had client-side (trivially bypassed by anyone posting to
  // this URL directly) are re-enforced server-side too.
  router.post('/self', selfCheckInLimiter, async (req, res) => {
    try {
      const {
        name,
        phone,
        email,
        fabricatorCompany,
        fabricatorName,
        fabricatorPhone,
        location: bodyLocation,
        honeypot,
        formLoadTime
      } = req.body;

      if (!name || !phone) {
        return res.status(400).json({ error: 'Name and phone number are required' });
      }

      // Same canonicalization as the staff route above — a visitor's own phone
      // is never guaranteed to arrive pre-formatted the way the kiosk UI does.
      const normalizedPhone = formatPhoneForDisplay(stripPhone(phone)) || phone;

      // A filled honeypot field means a bot filled in every input it found,
      // including ones no human sees. Report success without writing anything,
      // so a scraper has no signal that it was caught rather than throttled.
      if (honeypot) {
        return res.status(201).json({ success: true, message: 'Check-in successful! Welcome to Easy Stones.' });
      }
      // Mirrors the client's own 1200ms floor (CheckInPage.jsx) — a human takes
      // several seconds to click through the wizard; a direct API hit with a
      // fabricated or missing timestamp doesn't get the benefit of the doubt.
      if (typeof formLoadTime !== 'number' || Date.now() - formLoadTime < 1200) {
        return res.status(400).json({ error: 'Please try again.' });
      }

      if (!bodyLocation) {
        return res.status(400).json({ error: 'A location is required.' });
      }
      const realLocation = await Location.findOne({ name: { $regex: new RegExp(`^${escapeRegex(bodyLocation)}$`, 'i') } }).lean();
      if (!realLocation) {
        return res.status(400).json({ error: 'Invalid location.' });
      }

      const duplicate = await findRecentDuplicateCheckIn(normalizedPhone, realLocation.name);
      if (duplicate) {
        return res.status(201).json({
          success: true,
          message: 'Check-in successful! Welcome to Easy Stones.',
          data: duplicate,
          duplicate: true
        });
      }

      const checkIn = new OfficeCheckIn({
        name,
        phone: normalizedPhone,
        email,
        fabricatorCompany,
        fabricatorName,
        fabricatorPhone,
        location: realLocation.name,
        loggedBy: {
          displayName: 'Self Check-In (QR/NFC)',
          username: 'self-checkin'
        }
      });

      await checkIn.save();
      console.log(`✅ New self check-in ${checkIn._id} at ${checkIn.location}, phone ${maskPhone(normalizedPhone)}`);

      (async () => {
        try {
          await sendCheckInAlertEmail(checkIn);
        } catch (err) {
          console.error('❌ Check-in email dispatch exception:', err.message);
        }
      })();

      emitCheckInUpdate(req, checkIn.location);

      res.status(201).json({
        success: true,
        message: 'Check-in successful! Welcome to Easy Stones.',
        data: checkIn
      });
    } catch (error) {
      console.error('❌ Self check-in error:', error);
      res.status(500).json({ error: 'Check-in failed. Please try again.' });
    }
  });

  // GET /lookup?phone=... — has this phone number checked in before?
  // Powers the staff form's autofill: type a returning visitor's number and
  // their name/fabricator info comes back instead of being retyped. Open to
  // anyone who can submit a check-in (same `authenticate`-only gate as the POST
  // above) rather than gated behind view_checkins, since this is part of
  // filling the form out, not the check-in log/report those permissions guard.
  // Registered ahead of GET /:id so 'lookup' is never read as an id.
  router.get('/lookup', authenticate, async (req, res) => {
    try {
      const digits = stripPhone(req.query.phone);
      if (digits.length < 10) {
        return res.json({ found: false });
      }
      // Every number this form has ever saved went through formatPhoneInput on
      // the way in, so the last 10 digits reformatted the same way is an exact
      // match — no fuzzy matching needed.
      const formatted = formatPhoneForDisplay(digits.slice(-10));

      // Scoped the same way every other check-in route is — this returns a
      // name/fabricator autofill, but it's still someone's visit history, and
      // nothing else here lets a branch see another branch's check-ins either.
      const userLocations = req.user.assignedLocations || [];
      const lookupQuery = { phone: formatted, ...locationFilterFor(userLocations, null) };

      const lastVisit = await OfficeCheckIn.findOne(
        lookupQuery,
        'name fabricatorCompany fabricatorPhone location createdAt'
      ).sort({ createdAt: -1 }).lean();

      if (!lastVisit) {
        return res.json({ found: false });
      }

      res.json({
        found: true,
        name: lastVisit.name || '',
        fabricatorCompany: lastVisit.fabricatorCompany || '',
        fabricatorPhone: lastVisit.fabricatorPhone || '',
        lastVisit: { location: lastVisit.location, date: lastVisit.createdAt }
      });
    } catch (error) {
      console.error('❌ Check-in lookup error:', error);
      res.status(500).json({ message: 'Could not look up that number.' });
    }
  });

  router.get('/', authenticate, requirePermission('view_checkins'), async (req, res) => {
    try {
      const { page, limit, search, month, year, location } = req.query;

      const userLocations = req.user.assignedLocations || [];
      const built = checkInListQuery(userLocations, { search, month, year, location });
      if (built.forbidden) {
        return res.status(403).json({ message: 'Access denied to this location' });
      }
      const { locFilter, query } = built;

      // If query parameters are not supplied, return standard raw array for backward compatibility
      if (!page && !limit && !search && !month && !year) {
        const checkIns = await OfficeCheckIn.find(locFilter)
          .sort({ createdAt: -1 })
          .limit(50);
        return res.json(checkIns);
      }

      // Otherwise, support full pagination, search, and date filters
      const pageNum = parseInt(page) || 1;
      // Capped so a client-supplied limit can't force one query/response to
      // pull the entire collection — 1000 comfortably covers exporting a full
      // filtered month at any single location.
      const limitNum = Math.min(parseInt(limit) || 20, 1000);

      const total = await OfficeCheckIn.countDocuments(query);
      const checkIns = await OfficeCheckIn.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum);

      res.json({
        checkIns,
        totalPages: Math.ceil(total / limitNum),
        total
      });
    } catch (error) {
      console.error('❌ Error fetching check-ins:', error);
      res.status(500).json({ message: 'Failed to fetch check-ins' });
    }
  });

  // The log as a PDF for its current filters (More menu → View as PDF /
  // Download as PDF, 2026-10-08). Opened by a plain link, so the login cookie
  // signs it in and errors come back as a short readable page, not JSON.
  // ?download=1 saves it; otherwise it opens in the browser's PDF viewer.
  // Registered before GET /:id, which would otherwise take "export.pdf".
  router.get('/export.pdf', authenticate, requirePermission('view_checkins'), async (req, res) => {
    const fail = (status, message) => res.status(status).type('text/plain; charset=utf-8').send(message);
    try {
      const { search, month, year, location, download, tz } = req.query;
      const built = checkInListQuery(req.user.assignedLocations || [], { search, month, year, location });
      if (built.forbidden) return fail(403, 'You don’t have access to that branch’s check-ins.');

      const [total, list] = await Promise.all([
        OfficeCheckIn.countDocuments(built.query),
        OfficeCheckIn.find(built.query).sort({ createdAt: -1 }).limit(CHECKIN_PDF_MAX_ROWS).lean()
      ]);
      const viewerZone = validZone(tz);
      const generated = `Generated ${new Intl.DateTimeFormat('en-US', {
        timeZone: viewerZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(new Date())}${req.user.name ? ` by ${req.user.name}` : ''}`;

      const bytes = await buildCheckInLogPdf({
        list, total, viewerZone, generated,
        scope: checkInExportScope({ search, month, year, location })
      });
      const fileName = checkInExportFileName(location, new Date(), 'pdf');
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);
      res.set('Cache-Control', 'no-store');
      res.send(Buffer.from(bytes));
    } catch (error) {
      console.error('❌ Error building check-in PDF:', error);
      fail(500, 'Couldn’t make the PDF. Close this tab and try again.');
    }
  });

  // Check-in stats: today count + this month count (viewer-timezone aware)
  router.get('/stats', authenticate, requirePermission('view_checkins'), async (req, res) => {
    try {
      const now = new Date();

      // Today and this month on each branch's own clock — the same windows
      // the list's month filter and the Daily Report use, so "Today" for
      // Atlanta starts at Atlanta's midnight whoever is looking.
      const startOf = (zone, wholeMonth) => {
        const { year, monthIndex, day } = zoneDateParts(now, zone);
        return { $gte: zoneMidnightUtc(zone, year, monthIndex, wholeMonth ? 1 : day) };
      };

      const userLocations = req.user.assignedLocations || [];
      const locFilter = locationFilterFor(userLocations, req.query.location);
      if (locFilter.forbidden) {
        return res.status(403).json({ message: 'Access denied to this location' });
      }

      const queryToday = byBranchClock(locFilter, (zone) => startOf(zone, false));
      const queryMonth = byBranchClock(locFilter, (zone) => startOf(zone, true));
      const queryAllTime = { ...locFilter };

      const [todayCount, monthCount, allTimeCount] = await Promise.all([
        OfficeCheckIn.countDocuments(queryToday),
        OfficeCheckIn.countDocuments(queryMonth),
        OfficeCheckIn.countDocuments(queryAllTime)
      ]);

      res.json({ todayCount, monthCount, allTimeCount });
    } catch (error) {
      console.error('❌ Error fetching check-in stats:', error);
      res.status(500).json({ message: 'Failed to fetch stats' });
    }
  });

  // Get specific check-in
  router.get('/:id', authenticate, requirePermission('view_checkins'), async (req, res) => {
    try {
      const checkIn = await OfficeCheckIn.findById(req.params.id);
      if (!checkIn) {
        return res.status(404).json({ message: 'Check-in not found' });
      }
      const userLocations = req.user.assignedLocations || [];
      if (!hasLocationAccess(userLocations, checkIn.location)) {
        return res.status(403).json({ message: 'Access denied to this check-in' });
      }
      res.json(checkIn);
    } catch (error) {
      console.error('❌ Error fetching check-in details:', error);
      res.status(500).json({ message: 'Failed to fetch check-in details' });
    }
  });

  // Update specific check-in
  // Previously unauthenticated — allowing anyone to tamper with visitor records and,
  // via salesRepEmail, use the endpoint as an open relay for our email provider.
  // Gated on manage_checkins alone (not view_checkins) so "View" in Users & Roles
  // is actually read-only, matching its label — view_checkins used to also be
  // accepted here, which meant granting "View" silently granted edit too. CSRs
  // and sales reps edit selections as part of their normal workflow, so they
  // hold manage_checkins by default alongside view_checkins.
  router.put('/:id', authenticate, requirePermission('manage_checkins'), async (req, res) => {
    try {
      const {
        name,
        phone,
        email,
        fabricatorCompany,
        fabricatorName,
        fabricatorPhone,
        builderName,
        builderPhone,
        selections,
        specialNotes,
        internalNotes,
        salesRep,
        salesRepEmail,
        location,
        expectedUpdatedAt
      } = req.body;
      const checkIn = await OfficeCheckIn.findById(req.params.id);
      if (!checkIn) {
        return res.status(404).json({ message: 'Check-in not found' });
      }

      // Same location scoping the GET/:id and DELETE routes already enforce
      const userLocations = req.user.assignedLocations || [];
      if (!hasLocationAccess(userLocations, checkIn.location)) {
        return res.status(403).json({ message: 'Access denied to this check-in' });
      }

      // Two people with the same selection sheet open: the second save used
      // to silently overwrite the first. The sheet sends the updatedAt it
      // loaded; if the record has moved on since, answer 409 with what's
      // there now so the person can choose whose version to keep. Callers
      // that don't send it (other edit screens) are unaffected.
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null) {
        const expected = new Date(expectedUpdatedAt).getTime();
        const current = checkIn.updatedAt ? checkIn.updatedAt.getTime() : null;
        if (Number.isNaN(expected) || expected !== current) {
          return res.status(409).json({
            code: 'conflict',
            message: 'Someone else saved this selection sheet while you had it open.',
            data: checkIn
          });
        }
      }
      // The room a live update needs to reach before this save can change it —
      // captured up front so a location move still notifies viewers on the
      // branch the record is leaving, not just the one it lands on.
      const previousLocation = checkIn.location;
      // The sheet as it was before this save — the sales rep is only emailed
      // when what their email shows actually changes (materials, prices,
      // printed notes, the rep), not on every save of the same sheet. Internal
      // notes are in no email, so editing only those records the edit below
      // but doesn't re-send.
      const repEmailBefore = repEmailSnapshot(checkIn);
      const internalBefore = checkIn.internalNotes || '';

      if (name) checkIn.name = name;
      if (phone) checkIn.phone = phone;
      // Same access check as reading it in the first place — otherwise an
      // editor scoped to one branch could move a record to another branch (or
      // to a nonexistent location string), orphaning it from every
      // location-scoped view except a '*' admin's.
      if (location !== undefined && location !== checkIn.location) {
        if (!hasLocationAccess(userLocations, location)) {
          return res.status(403).json({ message: 'Access denied to this location' });
        }
        checkIn.location = location;
      }
      if (email !== undefined) checkIn.email = email;
      if (fabricatorCompany !== undefined) checkIn.fabricatorCompany = fabricatorCompany;
      if (fabricatorName !== undefined) checkIn.fabricatorName = fabricatorName;
      if (fabricatorPhone !== undefined) checkIn.fabricatorPhone = fabricatorPhone;
      if (builderName !== undefined) checkIn.builderName = builderName;
      if (builderPhone !== undefined) checkIn.builderPhone = builderPhone;
      if (selections !== undefined) {
        // Only reachable by calling the API directly (the sheet always sends
        // a well-formed array with whole-cent prices), but a malformed body
        // used to throw here and surface as an opaque 500 instead of a 400.
        const cleaned = cleanSelections(selections);
        if (cleaned.error) return res.status(400).json({ message: cleaned.error });
        checkIn.selections = cleaned.selections;
      }
      if (specialNotes !== undefined) checkIn.specialNotes = specialNotes;
      if (internalNotes !== undefined) checkIn.internalNotes = String(internalNotes ?? '');
      if (salesRep !== undefined) checkIn.salesRep = salesRep;
      if (salesRepEmail !== undefined) {
        // The rep is picked from staff accounts (the Selection Sheet's list),
        // so a new address has to be one of ours. Without this, anyone who
        // could edit a check-in could have the sheet — the customer's name,
        // phone and selections — emailed to any address (the auto-alert below).
        // An address already on the record (a rep since deactivated) is kept.
        const next = String(salesRepEmail || '').trim();
        if (next && next.toLowerCase() !== String(checkIn.salesRepEmail || '').trim().toLowerCase()) {
          const isStaff = await User.exists({ email: new RegExp(`^${escapeRegex(next)}$`, 'i') });
          if (!isStaff) return res.status(400).json({ message: 'Pick the sales rep from the list.' });
        }
        checkIn.salesRepEmail = next;
      }

      const repEmailChanged = repEmailSnapshot(checkIn) !== repEmailBefore;
      const sheetChanged = repEmailChanged || (checkIn.internalNotes || '') !== internalBefore;
      if (sheetChanged) {
        checkIn.sheetEditedBy = req.user?.username || '';
        checkIn.sheetEditedAt = new Date();
      }
      await checkIn.save();
      console.log(`✅ Office check-in ${checkIn._id} updated by ${req.user?.displayName || req.user?.username}`);

      // Background alert to the sales rep — only when the selections, prices,
      // printed notes or the rep themselves changed. It used to fire on every
      // save, so re-saving an unchanged sheet emailed the rep again each time.
      // The rep's copy always shows prices; it never shows internal notes.
      // …only to an active staff account (never someone deactivated in Users &
      // Roles, who may still be named on an old sheet, and never an outside
      // address), and only when the editor may send selection sheets at all —
      // the same permission POST /:id/send-email requires.
      const canSendSheet = (req.user?.permissions || []).includes('send_checkin_email');
      const repIsActiveStaff = checkIn.salesRepEmail
        ? await User.exists({ email: new RegExp(`^${escapeRegex(checkIn.salesRepEmail)}$`, 'i'), isActive: { $ne: false } })
        : null;
      if (checkIn.salesRepEmail && repIsActiveStaff && canSendSheet && repEmailChanged) {
        (async () => {
          try {
            console.log(`📡 Automatically sending selection sheet alert to sales rep: ${checkIn.salesRepEmail}`);
            await sendSelectionSheetEmail(checkIn, checkIn.salesRepEmail, await letterheadForCheckIn(checkIn), { showPrices: true });
          } catch (err) {
            console.error('❌ Failed to auto-send selection sheet email to sales rep:', err.message);
          }
        })();
      }

      emitCheckInUpdate(req, previousLocation);
      if (checkIn.location !== previousLocation) emitCheckInUpdate(req, checkIn.location);

      res.json({ success: true, message: 'Check-in updated successfully', data: checkIn });
    } catch (error) {
      console.error('❌ Error updating check-in:', error);
      res.status(500).json({ message: 'Failed to update check-in' });
    }
  });

  // Send selection sheet email
  router.post('/:id/send-email', authenticate, requirePermission('send_checkin_email'), async (req, res) => {
    try {
      // withPrices: the "Send with prices" button. Off unless asked for, so a
      // visitor's copy never carries prices by accident.
      const { email, withPrices } = req.body;
      if (!email) {
        return res.status(400).json({ message: 'Recipient email is required' });
      }

      const checkIn = await OfficeCheckIn.findById(req.params.id);
      if (!checkIn) {
        return res.status(404).json({ message: 'Check-in record not found' });
      }
      // The one :id route here missing this check — send_checkin_email is held
      // by every role that can view check-ins, so without it any staff member
      // could email another branch's customer data (name, phone, notes, stone
      // selections) to any address they typed in.
      const userLocations = req.user.assignedLocations || [];
      if (!hasLocationAccess(userLocations, checkIn.location)) {
        return res.status(403).json({ message: 'Access denied to this check-in' });
      }

      const emailResult = await sendSelectionSheetEmail(checkIn, email, await letterheadForCheckIn(checkIn), { showPrices: withPrices === true });

      if (!emailResult.success) {
        return res.status(500).json({ message: `Failed to send selection sheet email. Details: ${emailResult.error || 'Unknown error'}` });
      }

      res.json({ success: true, message: 'Selection sheet email sent successfully' });
    } catch (error) {
      console.error('❌ Error sending selection sheet email:', error);
      res.status(500).json({ message: 'Failed to send selection sheet email' });
    }
  });

  // Delete specific check-in
  router.delete('/:id', authenticate, requirePermission('delete_checkins'), async (req, res) => {
    try {
      const checkIn = await OfficeCheckIn.findById(req.params.id);
      if (!checkIn) {
        return res.status(404).json({ message: 'Check-in not found' });
      }
      const userLocations = req.user.assignedLocations || [];
      if (!hasLocationAccess(userLocations, checkIn.location)) {
        return res.status(403).json({ message: 'Access denied to delete this check-in' });
      }
      await OfficeCheckIn.findByIdAndDelete(req.params.id);
      console.log(`🗑️ Office check-in ${checkIn._id} deleted by ${req.user?.displayName || req.user?.username}`);
      emitCheckInUpdate(req, checkIn.location);

      res.json({ success: true, message: 'Check-in deleted successfully' });
    } catch (error) {
      console.error('❌ Error deleting check-in:', error);
      res.status(500).json({ message: 'Failed to delete check-in' });
    }
  });

  return router;
}

// Read by server.js's io.on('connection') handler — see the comment on
// deliveryRoomFor in deliveries.js for why they have to stay in sync.
export { checkinRoomFor, CHECKIN_ROOM_ALL };
