import express from 'express';
import DailyReport from '../models/DailyReport.js';
import { buildDayPdf, buildMonthPdf, dayPdfFileName, monthPdfFileName } from '../utils/dailyReportPdf.js';
import { sendEmail } from '../services/emailService.js';
import Delivery from '../models/Delivery.js';
import { BRANCH_NAMES, branchCode, isBranch } from '../config/branches.js';
import OfficeCheckIn from '../models/OfficeCheckIn.js';
import Location from '../models/Location.js';
import { notifyDailyReportSubmission } from '../utils/dailyReportSubmissionEmail.js';
import { groupContainers, groupSlabs } from '../utils/dailyReportContainers.js';
import { groupTransferTickets, groupTicketSlabs, groupReceived } from '../utils/dailyReportTransfers.js';

/**
 * Daily Work Report API.
 *
 * Kept out of server.js deliberately — this is a self-contained feature and
 * server.js is already six thousand lines. The middleware it needs (auth,
 * permission checks, the activity logger) lives there, so it is handed in
 * rather than imported, which also keeps this module testable on its own.
 *
 *   import createDailyReportsRouter from './src/routes/dailyReports.js';
 *   app.use('/api/daily-reports', createDailyReportsRouter({ authenticate, requirePermission }));
 */

// The branches and their clocks live in one place — the auto-submit job needs
// the same list, and two copies of it would eventually disagree.

const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const isValidMonth = (value) => /^\d{4}-\d{2}$/.test(String(value || ''));

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * A figure nobody has entered stays null rather than becoming 0 — "no payments
 * recorded" and "no money taken" are different statements and the report keeps
 * them apart. Only an empty string, null or undefined means unsaid; a typed 0
 * is a real answer.
 */
const numOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const moneyOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};



/** The branches this user may see. '*' means every branch. */
const allowedLocations = (req) => {
  const assigned = req.user?.assignedLocations || [];
  return assigned.includes('*') ? '*' : assigned;
};

const canSeeLocation = (req, location) => {
  // '*' means every branch we have — not every string. Without this an
  // administrator asking for "Nowhere" got a 200 and an empty sheet.
  if (!isBranch(location)) return false;
  const allowed = allowedLocations(req);
  return allowed === '*' || allowed.includes(location);
};

/**
 * The half of the report the system already knows.
 *
 * Visitors come from the check-in log, which records an instant — so the day is
 * bounded in the branch's own clock via the tz offset the caller passes, rather
 * than assuming the server's.
 */
async function deriveFromSystem(date, location, tzOffsetMinutes = 0) {
  // tzOffsetMinutes is the viewer's UTC offset (-420 for Pacific), so local
  // midnight is that many minutes *behind* UTC midnight — subtract, don't add.
  // Adding it put the window half a day out and undercounted the morning.
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  dayStart.setUTCMinutes(dayStart.getUTCMinutes() - tzOffsetMinutes);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [checkIns, deliveryRows, incomingRows] = await Promise.all([
    OfficeCheckIn.countDocuments({
      location,
      createdAt: { $gte: dayStart, $lt: dayEnd }
    }),
    // A delivery's date is a plain calendar string, so this needs no timezone
    // maths — it is already the branch's day.
    //
    // A will call never carries a truckId — the customer collects it, so it
    // rides on no truck — which is why the board's own week query (server.js)
    // carves out the same exception. Without it every pick-up ticket fails
    // the truckId check and the report's Pick-ups count and slabs sit at 0
    // regardless of how many pickups actually happened that day.
    Delivery.find(
      { date, $or: [{ truckId: { $nin: ['', null] } }, { deliveryType: 'will_call' }] },
      'deliveryType transferDestination location numberOfSlabs'
    ).lean(),
    // Inbound transfers key off a different date (when they're due here, not
    // when they left origin) and the opposite location field — a ticket some
    // other branch owns, addressed to this one.
    Delivery.find(
      { deliveryType: 'transfer', expectedArrivalDate: date, transferDestination: location },
      'id location numberOfSlabs receivedAt receivedBy'
    ).lean()
  ]);

  // Deliveries carry no location on most records yet, so an empty location is
  // treated as belonging to the branch being reported on rather than dropped.
  const mine = deliveryRows.filter(d => !d.location || d.location === location || d.location === '*');
  // A ticket nobody has counted yet contributes nothing rather than blocking
  // the rest of the day's total.
  const slabsOf = (d) => (Number.isFinite(d.numberOfSlabs) ? d.numberOfSlabs : 0);

  const jobsiteRows = mine.filter(d => !d.deliveryType || d.deliveryType === 'jobsite');
  const willCallRows = mine.filter(d => d.deliveryType === 'will_call');

  // One line per counterpart branch, the way the sheet reads: SEA — SLC. The
  // outbound side groups by where it's going; the inbound side groups by
  // where it came from — same shape, so both share groupTransferTickets.
  const outbound = groupTransferTickets(
    mine.filter(d => d.deliveryType === 'transfer'),
    (d) => d.transferDestination
  ).map(g => ({
    fromTo: `${branchCode(location)} — ${branchCode(g.key)}`,
    count: g.tickets.length,
    slabs: groupTicketSlabs(g),
    auto: true,
    direction: 'out'
  }));

  const inbound = groupTransferTickets(incomingRows, (d) => d.location).map(g => {
    // Usually one ticket per line — this just picks the latest confirmation
    // when a couple of tickets from the same origin land on the same day.
    const receivedTicket = g.tickets.reduce((latest, t) => {
      if (!t.receivedAt) return latest;
      return (!latest || t.receivedAt > latest.receivedAt) ? t : latest;
    }, null);
    return {
      fromTo: `${branchCode(g.key)} — ${branchCode(location)}`,
      count: g.tickets.length,
      slabs: groupTicketSlabs(g),
      auto: true,
      direction: 'in',
      received: groupReceived(g),
      receivedAt: receivedTicket?.receivedAt || null,
      receivedBy: receivedTicket?.receivedBy || '',
      // Transient — which ticket(s) this line rolls up, so "mark received" on
      // the report has something to PATCH. Not part of the stored schema: the
      // save route below rebuilds transfer lines field-by-field and never
      // echoes this back, so nothing persists it by accident.
      ticketIds: g.tickets.map(t => t.id).filter(Boolean)
    };
  });

  return {
    visitorCheckIns: checkIns,
    deliveriesAssigned: jobsiteRows.length,
    pickupsAssigned: willCallRows.length,
    deliveriesSlabs: jobsiteRows.reduce((sum, d) => sum + slabsOf(d), 0),
    pickupsSlabs: willCallRows.reduce((sum, d) => sum + slabsOf(d), 0),
    transfers: [...outbound, ...inbound]
  };
}

/**
 * Merge the derived figures into a stored report.
 *
 * A submitted report is never re-derived: its numbers are the record of what
 * was true when it was signed off, and a delivery edited next week must not
 * rewrite last Tuesday.
 */
function applyDerived(report, derived) {
  if (report.status === 'submitted') return report;

  report.visitors.homeowners = derived.visitorCheckIns;
  report.deliveries.assigned = derived.deliveriesAssigned;
  report.pickups.assigned = derived.pickupsAssigned;

  // Slabs starts from what the tickets add up to and stays editable from
  // there — null still means "nobody has counted them", so that's the only
  // case this fills in. Once a figure is on the report, auto-filled or
  // hand-corrected, later loads leave it alone rather than overwriting a
  // correction the next time a ticket on the day changes.
  if (report.deliveries.capacity === null || report.deliveries.capacity === undefined) {
    report.deliveries.capacity = derived.deliveriesSlabs;
  }
  if (report.pickups.capacity === null || report.pickups.capacity === undefined) {
    report.pickups.capacity = derived.pickupsSlabs;
  }

  // Keep any slab counts already on a route that still exists — that covers
  // both a hand correction and a figure that was itself auto-filled earlier,
  // which is why this checks presence rather than truthiness. A route that
  // has never appeared on this report before gets the fresh ticket sum. Keyed
  // by direction as well as the route string — out and in are different lines
  // even when (hypothetically) they'd render the same "SEA — SLC" text.
  const lineKey = (t) => `${t.direction || 'out'}:${t.fromTo}`;
  const typedSlabs = new Map(report.transfers.map(t => [lineKey(t), t.slabs]));
  const manual = report.transfers.filter(t => !t.auto);
  report.transfers = [
    ...derived.transfers.map(t => ({ ...t, slabs: typedSlabs.has(lineKey(t)) ? typedSlabs.get(lineKey(t)) : t.slabs })),
    ...manual
  ];

  return report;
}

/**
 * What a slab count usually looks like, so a slipped finger can be questioned.
 *
 * A container is around a hundred slabs, which is the anchor when a branch has
 * no history yet. Once it has filed enough container lines, its own median
 * takes over — Spokane should not be measured against Seattle's volumes.
 *
 * The band is deliberately wide. This asks a question; it never refuses a
 * figure, so the cost of a false alarm is a glance and the cost of a miss is a
 * wrong number in a director's inbox.
 */
const TYPICAL_CONTAINER_SLABS = 100;

async function slabExpectation(locations) {
  const docs = await DailyReport.find(
    { location: { $in: locations } },
    'containers.poNumber containers.slabs'
  ).sort({ date: -1 }).limit(60).lean();

  // Grouped back into physical containers first — a container split across a
  // few colors would otherwise contribute several small per-line samples
  // instead of the one real container-sized figure, dragging the "typical"
  // size down and making every split shipment look odd going forward too.
  const seen = docs
    .flatMap(d => groupContainers(d.containers || []).map(groupSlabs))
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  // Under a handful of lines a median is noise, so hold the anchor.
  const centre = seen.length >= 6
    ? seen[Math.floor(seen.length / 2)]
    : TYPICAL_CONTAINER_SLABS;

  return {
    centre,
    low: Math.max(1, Math.round(centre / 5)),
    high: Math.round(centre * 3),
    fromHistory: seen.length >= 6,
    sampled: seen.length
  };
}

/** Everything the month view needs, without shipping whole documents. */
const summarise = (r) => ({
  date: r.date,
  location: r.location,
  status: r.status,
  visitors: (r.visitors?.homeowners || 0) + (r.visitors?.fabricators || 0) + (r.visitors?.designers || 0),
  deliveries: r.deliveries?.assigned || 0,
  pickups: r.pickups?.assigned || 0,
  // A transfer line is a route, and its `count` is how many went down it — the
  // figure the tiles quote is the transfers, not the lines they are grouped on.
  // Outbound only — a report's own transfer figures have always meant "what
  // this branch shipped"; inbound lines are a newer, separate concept and
  // folding them in here would quietly inflate a number month views and the
  // CSV export already rely on meaning one direction.
  transferCount: (r.transfers || []).filter(t => t.direction !== 'in').reduce((sum, t) => sum + (t.count || 0), 0),
  transferSlabs: (r.transfers || []).filter(t => t.direction !== 'in').reduce((sum, t) => sum + (t.slabs || 0), 0),
  // A container line with a blank PO# continues the one above it (a container
  // that arrived with a couple of different colors on it), so the count is
  // the number of distinct containers, not the number of lines.
  containerCount: groupContainers(r.containers || []).length,
  containerSlabs: (r.containers || []).reduce((sum, c) => sum + (c.slabs || 0), 0),
  payments: ['cash', 'card', 'check'].reduce((sum, k) => sum + (r.payments?.[k]?.amount || 0), 0),
  submittedBy: r.submittedBy || '',
  autoSubmitted: Boolean(r.autoSubmitted)
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Recipients arrive as a comma/space separated string or an array. */
const parseRecipients = (input) => {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,;\s]+/);
  return [...new Set(list.map(x => String(x).trim().toLowerCase()).filter(x => EMAIL_RE.test(x)))];
};

const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default function createDailyReportsRouter({ authenticate, requirePermission, logActivity }) {
  const router = express.Router();

  const canView = [authenticate, requirePermission('view_daily_report')];
  const canEdit = [authenticate, requirePermission('edit_daily_report')];
  const canSubmit = [authenticate, requirePermission('submit_daily_report')];
  const canReopen = [authenticate, requirePermission('reopen_daily_report')];

  /** The branches this user may pick between — drives the location selector. */
  router.get('/locations', canView, async (req, res) => {
    try {
      const allowed = allowedLocations(req);
      // Every branch the company has — not scoped to assignedLocations, and
      // deliberately so. A transfer's From/To picker is answering "where is
      // this going", not "whose report may I open"; a Seattle-only rep still
      // needs to pick Atlanta as a destination even though Atlanta's own
      // report is none of their business. This is names only, the same list
      // the delivery board already hands to every logged-in user for the
      // same reason (see GET /api/admin/locations in server.js) — no figures
      // or report data from those branches comes with it.
      const allLocationDocs = await Location.find().sort({ name: 1 }).lean();
      res.json({
        locations: allowed === '*' ? BRANCH_NAMES : allowed,
        allLocations: allLocationDocs.map(l => l.name),
        canExportAll: allowed === '*'
      });
    } catch (error) {
      console.error('[daily-reports] locations failed:', error);
      res.status(500).json({ message: 'Could not load branches.' });
    }
  });

  /** GET /api/daily-reports?month=YYYY-MM&location=Seattle — the month view. */
  router.get('/', canView, async (req, res) => {
    try {
      const { month, location } = req.query;
      if (!isValidMonth(month)) {
        return res.status(400).json({ message: 'Provide a month as YYYY-MM.' });
      }

      const allowed = allowedLocations(req);
      let locations;
      if (location && location !== 'all') {
        if (!canSeeLocation(req, location)) {
          return res.status(403).json({ message: 'That branch is not assigned to you.' });
        }
        locations = [location];
      } else {
        locations = allowed === '*' ? BRANCH_NAMES : allowed;
      }

      const rows = await DailyReport.find({
        location: { $in: locations },
        date: { $regex: `^${month}-` }
      }).sort({ date: -1 }).lean();

      res.json({ month, locations, reports: rows.map(summarise) });
    } catch (error) {
      console.error('[daily-reports] month view failed:', error);
      res.status(500).json({ message: 'Could not load the month.' });
    }
  });

  /**
   * GET /api/daily-reports/overview/:date — one day across every branch this
   * user may see. What the selector's "All locations" reads.
   *
   * Branches with nothing saved are included rather than omitted: a day missing
   * from the list looks like a branch that took no visitors, and the difference
   * between "nobody came in" and "nobody filled it in" is the reason to open
   * this view at all. Those rows still carry the system's own figures, so a
   * branch that hasn't started shows the deliveries it was assigned.
   */
  router.get('/overview/:date', canView, async (req, res) => {
    try {
      const { date } = req.params;
      const tz = Number(req.query.tzOffset) || 0;
      if (!isValidDate(date)) return res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' });

      const allowed = allowedLocations(req);
      // Filtered to branches we have, so a stale name on a user's record can't
      // put a branch in the list that doesn't exist.
      const locations = (allowed === '*' ? BRANCH_NAMES : allowed).filter(isBranch);

      const saved = await DailyReport.find({ date, location: { $in: locations } });
      const byLocation = new Map(saved.map(r => [r.location, r]));

      const rows = await Promise.all(locations.map(async (location) => {
        const stored = byLocation.get(location);
        const report = stored || new DailyReport({ date, location });
        applyDerived(report, await deriveFromSystem(date, location, tz));
        return { ...summarise(report), status: stored ? report.status : 'none' };
      }));

      res.json({ date, rows });
    } catch (error) {
      console.error('[daily-reports] overview failed:', error);
      res.status(500).json({ message: 'Could not load that day.' });
    }
  });

  /** GET /api/daily-reports/:date?location=Seattle — one day, ready to edit. */
  router.get('/:date', canView, async (req, res) => {
    try {
      const { date } = req.params;
      const location = req.query.location;
      const tz = Number(req.query.tzOffset) || 0;

      if (!isValidDate(date)) return res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' });
      if (!location) return res.status(400).json({ message: 'Provide a branch.' });
      if (!canSeeLocation(req, location)) {
        return res.status(403).json({ message: 'That branch is not assigned to you.' });
      }

      let report = await DailyReport.findOne({ date, location });
      if (!report) {
        // Not saved yet — build the day in memory so it opens pre-filled without
        // writing a row for a day nobody ends up reporting on.
        report = new DailyReport({ date, location });
      }

      const derived = await deriveFromSystem(date, location, tz);
      applyDerived(report, derived);

      res.json({
        report: report.toObject({ depopulate: true }),
        derived: {
          visitorCheckIns: derived.visitorCheckIns,
          deliveriesAssigned: derived.deliveriesAssigned,
          pickupsAssigned: derived.pickupsAssigned,
          deliveriesSlabs: derived.deliveriesSlabs,
          pickupsSlabs: derived.pickupsSlabs
        },
        // The band a slab count is sane within, so the rule lives on the server
        // rather than being reinvented in the form.
        slabRange: await slabExpectation([location]),
        isNew: report.isNew
      });
    } catch (error) {
      console.error('[daily-reports] load failed:', error);
      res.status(500).json({ message: 'Could not load that day.' });
    }
  });

  /** PUT /api/daily-reports/:date — save the draft. */
  router.put('/:date', canEdit, async (req, res) => {
    try {
      const { date } = req.params;
      const { location } = req.body;

      if (!isValidDate(date)) return res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' });
      if (!location) return res.status(400).json({ message: 'Provide a branch.' });
      if (!canSeeLocation(req, location)) {
        return res.status(403).json({ message: 'That branch is not assigned to you.' });
      }

      const existing = await DailyReport.findOne({ date, location });
      if (existing && existing.status === 'submitted') {
        return res.status(409).json({ message: 'This day has been submitted. Reopen it to make changes.' });
      }

      const body = req.body;
      const update = {
        date,
        location,
        status: body.status === 'closed' ? 'closed' : 'draft',
        visitors: {
          homeowners: num(body.visitors?.homeowners),
          fabricators: numOrNull(body.visitors?.fabricators),
          designers: numOrNull(body.visitors?.designers)
        },
        deliveries: { assigned: num(body.deliveries?.assigned), capacity: numOrNull(body.deliveries?.capacity) },
        pickups: { assigned: num(body.pickups?.assigned), capacity: numOrNull(body.pickups?.capacity) },
        returns: numOrNull(body.returns),
        sinks: numOrNull(body.sinks),
        transfers: (body.transfers || []).map(t => ({
          fromTo: String(t.fromTo || '').trim(),
          count: num(t.count),
          slabs: num(t.slabs),
          auto: Boolean(t.auto),
          direction: t.direction === 'in' ? 'in' : 'out',
          // Mirrored back from what the last load derived — this endpoint
          // never sets receipt itself, that's PATCH /api/deliveries/:id/receive.
          received: Boolean(t.received),
          receivedAt: t.receivedAt ? new Date(t.receivedAt) : null,
          receivedBy: String(t.receivedBy || '').trim()
        })).filter(t => t.fromTo || t.count || t.slabs),
        containers: (body.containers || []).map(c => ({
          poNumber: String(c.poNumber || '').trim(),
          material: String(c.material || '').trim(),
          slabs: num(c.slabs)
        })).filter(c => c.poNumber || c.material || c.slabs),
        payments: {
          cash: { count: numOrNull(body.payments?.cash?.count), amount: moneyOrNull(body.payments?.cash?.amount) },
          card: { count: numOrNull(body.payments?.card?.count), amount: moneyOrNull(body.payments?.card?.amount) },
          check: { count: numOrNull(body.payments?.check?.count), amount: moneyOrNull(body.payments?.check?.amount) }
        },
        notes: String(body.notes || '').trim(),
        updatedBy: req.user?.displayName || req.user?.username || ''
      };

      const saved = await DailyReport.findOneAndUpdate(
        { date, location },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      res.json({ report: saved.toObject() });
    } catch (error) {
      console.error('[daily-reports] save failed:', error);
      res.status(500).json({ message: 'Could not save this day.' });
    }
  });

  /** POST /api/daily-reports/:date/submit — lock the day. */
  router.post('/:date/submit', canSubmit, async (req, res) => {
    try {
      const { date } = req.params;
      const { location } = req.body;
      if (!isValidDate(date) || !location) {
        return res.status(400).json({ message: 'Provide a date and a branch.' });
      }
      if (!canSeeLocation(req, location)) {
        return res.status(403).json({ message: 'That branch is not assigned to you.' });
      }

      const report = await DailyReport.findOne({ date, location });
      if (!report) return res.status(404).json({ message: 'Save the day before submitting it.' });
      if (report.status === 'submitted') {
        return res.status(409).json({ message: 'This day was already submitted.' });
      }

      report.status = 'submitted';
      report.submittedBy = req.user?.displayName || req.user?.username || '';
      report.submittedAt = new Date();
      report.autoSubmitted = false;
      await report.save();

      if (logActivity) {
        logActivity(req, 'daily_report_submitted', `${location} · ${date}`);
      }

      // Not awaited — the person submitting shouldn't wait on an email round
      // trip, and a failed send shouldn't turn a successful submit into an
      // error. notifyDailyReportSubmission no-ops for every branch but Seattle.
      notifyDailyReportSubmission(report.toObject());

      res.json({ report: report.toObject() });
    } catch (error) {
      console.error('[daily-reports] submit failed:', error);
      res.status(500).json({ message: 'Could not submit this day.' });
    }
  });

  /** POST /api/daily-reports/:date/reopen — unlock, with a reason on the record. */
  router.post('/:date/reopen', canReopen, async (req, res) => {
    try {
      const { date } = req.params;
      const { location, reason } = req.body;
      if (!isValidDate(date) || !location) {
        return res.status(400).json({ message: 'Provide a date and a branch.' });
      }
      if (!canSeeLocation(req, location)) {
        return res.status(403).json({ message: 'That branch is not assigned to you.' });
      }
      if (String(reason || '').trim().length < 4) {
        return res.status(400).json({ message: 'Give a reason for reopening this day.' });
      }

      const report = await DailyReport.findOne({ date, location });
      if (!report) return res.status(404).json({ message: 'No report for that day.' });

      report.status = 'draft';
      report.autoSubmitted = false;
      report.reopenedBy = req.user?.displayName || req.user?.username || '';
      report.reopenedAt = new Date();
      report.reopenReason = String(reason).trim();
      await report.save();

      if (logActivity) {
        logActivity(req, 'daily_report_reopened', `${location} · ${date} — ${report.reopenReason}`);
      }

      res.json({ report: report.toObject() });
    } catch (error) {
      console.error('[daily-reports] reopen failed:', error);
      res.status(500).json({ message: 'Could not reopen this day.' });
    }
  });

  /**
   * GET /api/daily-reports/export/:month?location=Seattle|all
   * CSV, because it opens in the spreadsheet everyone already has. Managers get
   * their own branches; anyone assigned to all four can take the company sheet.
   */
  router.get('/export/:month', canView, async (req, res) => {
    try {
      const { month } = req.params;
      const { location } = req.query;
      if (!isValidMonth(month)) return res.status(400).json({ message: 'Provide a month as YYYY-MM.' });

      const allowed = allowedLocations(req);
      let locations;
      if (location && location !== 'all') {
        if (!canSeeLocation(req, location)) {
          return res.status(403).json({ message: 'That branch is not assigned to you.' });
        }
        locations = [location];
      } else {
        locations = allowed === '*' ? BRANCH_NAMES : allowed;
      }

      const rows = await DailyReport.find({
        location: { $in: locations },
        date: { $regex: `^${month}-` }
      }).sort({ location: 1, date: 1 }).lean();

      const head = [
        'Date', 'Branch', 'Status',
        'Homeowners', 'Fabricators', 'Designers', 'Visitors total',
        'Deliveries count', 'Deliveries slabs',
        'Pick-ups count', 'Pick-ups slabs',
        'Returns', 'Sinks',
        'Transfer routes', 'Transfer count', 'Transfer slabs',
        'Container lines', 'Container slabs',
        'Cash count', 'Cash amount', 'Card count', 'Card amount',
        'Check count', 'Check amount', 'Payments total',
        'Submitted by'
      ];

      const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const lines = rows.map(r => {
        const s = summarise(r);
        return [
          r.date, r.location, r.status,
          r.visitors?.homeowners || 0, r.visitors?.fabricators || 0, r.visitors?.designers || 0, s.visitors,
          r.deliveries?.assigned || 0, r.deliveries?.capacity || 0,
          r.pickups?.assigned || 0, r.pickups?.capacity || 0,
          r.returns || 0, r.sinks || 0,
          (r.transfers || []).filter(t => t.direction !== 'in').map(t => t.fromTo).join(' / '),
          (r.transfers || []).filter(t => t.direction !== 'in').reduce((n, t) => n + (t.count || 0), 0),
          s.transferSlabs,
          (r.containers || []).length, s.containerSlabs,
          r.payments?.cash?.count || 0, (r.payments?.cash?.amount || 0).toFixed(2),
          r.payments?.card?.count || 0, (r.payments?.card?.amount || 0).toFixed(2),
          r.payments?.check?.count || 0, (r.payments?.check?.amount || 0).toFixed(2),
          s.payments.toFixed(2),
          r.submittedBy || ''
        ].map(esc).join(',');
      });

      const scope = locations.length === 1 ? locations[0].replace(/\s+/g, '_') : 'all_branches';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="daily_report_${month}_${scope}.csv"`);
      res.send([head.join(','), ...lines].join('\n'));
    } catch (error) {
      console.error('[daily-reports] export failed:', error);
      res.status(500).json({ message: 'Could not build the export.' });
    }
  });

  // ── PDF ────────────────────────────────────────────────────────────────────
  // Download and email share one resolver each, so the file a manager opens and
  // the file that lands in an inbox can never be built from different rules.

  const resolveDay = async (req, res) => {
    const { date } = req.params;
    const location = req.query.location || req.body?.location;
    if (!isValidDate(date)) { res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' }); return null; }
    if (!location) { res.status(400).json({ message: 'Provide a branch.' }); return null; }
    if (!canSeeLocation(req, location)) { res.status(403).json({ message: 'That branch is not assigned to you.' }); return null; }

    let report = await DailyReport.findOne({ date, location }).lean();
    if (!report) {
      // A day nobody has saved still prints — as an empty sheet marked draft,
      // which is more useful than an error when someone asks for yesterday.
      const blank = new DailyReport({ date, location });
      const derived = await deriveFromSystem(date, location, Number(req.query.tzOffset) || 0);
      applyDerived(blank, derived);
      report = blank.toObject();
    }
    return report;
  };

  const resolveMonth = async (req, res) => {
    const { month } = req.params;
    const location = req.query.location || req.body?.location;
    if (!isValidMonth(month)) { res.status(400).json({ message: 'Provide a month as YYYY-MM.' }); return null; }

    const allowed = allowedLocations(req);
    let locations;
    let scopeLabel;
    if (location && location !== 'all') {
      if (!canSeeLocation(req, location)) { res.status(403).json({ message: 'That branch is not assigned to you.' }); return null; }
      locations = [location];
      scopeLabel = location;
    } else {
      locations = allowed === '*' ? BRANCH_NAMES : allowed;
      scopeLabel = locations.length === 1 ? locations[0] : 'All branches';
    }

    const docs = await DailyReport.find({
      location: { $in: locations },
      date: { $regex: `^${month}-` }
    }).sort({ location: 1, date: 1 }).lean();

    return { month, rows: docs.map(summarise), scopeLabel };
  };

  /** GET /api/daily-reports/:date/pdf?location=Seattle */
  router.get('/:date/pdf', canView, async (req, res) => {
    try {
      const report = await resolveDay(req, res);
      if (!report) return;
      const bytes = await buildDayPdf(report);
      const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${dayPdfFileName(report)}"`);
      res.send(Buffer.from(bytes));
    } catch (error) {
      console.error('[daily-reports] day pdf failed:', error);
      res.status(500).json({ message: 'Could not build the PDF.' });
    }
  });

  /** GET /api/daily-reports/export/:month/pdf?location=Seattle|all */
  router.get('/export/:month/pdf', canView, async (req, res) => {
    try {
      const data = await resolveMonth(req, res);
      if (!data) return;
      const bytes = await buildMonthPdf(data);
      const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${monthPdfFileName(data.month, data.scopeLabel)}"`);
      res.send(Buffer.from(bytes));
    } catch (error) {
      console.error('[daily-reports] month pdf failed:', error);
      res.status(500).json({ message: 'Could not build the PDF.' });
    }
  });

  const mailReport = async (req, res, { subject, heading, lines, filename, bytes }) => {
    const to = parseRecipients(req.body?.to);
    if (!to.length) return res.status(400).json({ message: 'Add at least one valid email address.' });
    if (to.length > 20) return res.status(400).json({ message: 'That is more recipients than this is meant for — 20 at most.' });

    const sender = req.user?.displayName || req.user?.username || 'Easy Stones';
    const note = String(req.body?.message || '').trim();

    const html = `
      <div style="font-family:Helvetica,Arial,sans-serif;color:#1b1a17;line-height:1.55">
        <h2 style="margin:0 0 4px;font-size:17px">${escapeHtml(heading)}</h2>
        <p style="margin:0 0 14px;color:#6b6b6b;font-size:13px">${lines.map(escapeHtml).join(' &middot; ')}</p>
        ${note ? `<p style="margin:0 0 14px;font-size:14px;white-space:pre-wrap">${escapeHtml(note)}</p>` : ''}
        <p style="margin:0 0 6px;font-size:13px">The report is attached as a PDF.</p>
        <p style="margin:18px 0 0;font-size:12px;color:#8a857a">Sent by ${escapeHtml(sender)} from the Easy Stones portal.</p>
      </div>`;

    const result = await sendEmail({
      to,
      subject,
      html,
      replyTo: req.user?.email || undefined,
      defaultSenderName: 'Easy Stones',
      attachments: [{ filename, content: Buffer.from(bytes) }]
    });

    if (!result.success) {
      return res.status(502).json({ message: `Could not send the email. ${result.error || ''}`.trim() });
    }

    if (logActivity) logActivity(req, 'daily_report_emailed', `${filename} → ${to.join(', ')}`);
    res.json({ sent: to });
  };

  /** POST /api/daily-reports/:date/email  { location, to, message } */
  router.post('/:date/email', canView, async (req, res) => {
    try {
      const report = await resolveDay(req, res);
      if (!report) return;
      const bytes = await buildDayPdf(report);
      await mailReport(req, res, {
        subject: `Daily Work Report — ${report.location}, ${report.date}${report.status === 'draft' ? ' (draft)' : ''}`,
        heading: `Daily Work Report — ${report.location}`,
        lines: [report.date, report.status === 'submitted' ? 'Submitted' : 'Draft'],
        filename: dayPdfFileName(report),
        bytes
      });
    } catch (error) {
      console.error('[daily-reports] day email failed:', error);
      res.status(500).json({ message: 'Could not send the report.' });
    }
  });

  /** POST /api/daily-reports/export/:month/email  { location, to, message } */
  router.post('/export/:month/email', canView, async (req, res) => {
    try {
      const data = await resolveMonth(req, res);
      if (!data) return;
      const bytes = await buildMonthPdf(data);
      await mailReport(req, res, {
        subject: `Daily Work Report — ${data.scopeLabel}, ${data.month}`,
        heading: `Daily Work Report — month summary`,
        lines: [data.scopeLabel, data.month, `${data.rows.length} day${data.rows.length === 1 ? '' : 's'}`],
        filename: monthPdfFileName(data.month, data.scopeLabel),
        bytes
      });
    } catch (error) {
      console.error('[daily-reports] month email failed:', error);
      res.status(500).json({ message: 'Could not send the report.' });
    }
  });

  return router;
}
