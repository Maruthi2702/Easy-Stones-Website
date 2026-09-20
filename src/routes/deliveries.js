import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';

import Delivery from '../models/Delivery.js';
import Truck from '../models/Truck.js';
import User from '../models/User.js';
import ActivityLog from '../models/ActivityLog.js';

import { stampSignaturesOnPdfBytes } from '../utils/pdfSigner.js';
import { signedPackingListFileName } from '../utils/packingList.js';
import {
  isWillCall, THIRD_PARTY_TRUCK_ID, THIRD_PARTY_NAME,
  PICKUP_WORDING, DELIVERY_WORDING, RETURN_WORDING
} from '../utils/deliveryPickup.js';
import { DELIVERY_TYPES, isReturn } from '../utils/deliveryTypes.js';

/**
 * Delivery Schedule + Truck API.
 *
 * Kept out of server.js deliberately, same reasoning as
 * src/routes/dailyReports.js: a self-contained feature, and server.js is
 * already thousands of lines. A few generic, cross-feature helpers
 * (getPerformerInfo, processBase64Images, getNowLocalISO) are handed in
 * rather than imported, since other features that also live in server.js
 * share them.
 *
 *   import createDeliveriesRouter from './src/routes/deliveries.js';
 *   app.use('/api', createDeliveriesRouter({
 *     authenticate, requirePermission, requireAnyPermission,
 *     getPerformerInfo, processBase64Images, getNowLocalISO
 *   }));
 *
 * Mounted at '/api' (not '/api/deliveries') because this file also owns
 * GET/POST /api/trucks — every route below spells out its own full path
 * from there, matching how they read in server.js before this file existed.
 *
 * For everything else touching this feature — the board UI, the schedule
 * cache, pure scheduling math — see the map in
 * src/components/sales/delivery/README.md.
 */

// ── Cloudinary / POD asset helpers ──────────────────────────────────────────
// Packing lists, signatures and signed PDFs are keyed on the delivery id
// rather than a timestamp. Re-signing therefore overwrites in place instead
// of leaving the previous copy stranded in Cloudinary with nothing pointing
// at it, so a delivery costs a fixed number of assets no matter how often it
// is re-signed, and deleting one is a direct address rather than a search.
const cloudinaryReady = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

// Cloudinary public_ids allow a limited character set; delivery ids are
// generated strings but may carry separators we shouldn't pass through raw.
const safeIdSegment = (value) => String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');

const podAssetIds = (deliveryId) => {
  const key = safeIdSegment(deliveryId);
  return {
    packingList: `deliveries/packing_lists/${key}`,
    signedPdf: `deliveries/pod/${key}/signed`,
    custSig: `deliveries/pod/${key}/sig_customer`,
    driverSig: `deliveries/pod/${key}/sig_driver`
  };
};

const uploadBufferToCloudinary = (buffer, publicId, resourceType = 'raw') =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: resourceType, overwrite: true, invalidate: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

const destroyCloudinaryAsset = async (publicId, resourceType = 'raw') => {
  if (!publicId || !cloudinaryReady()) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  } catch (err) {
    console.warn(`[pod] could not destroy ${publicId}:`, err.message);
  }
};

// Writes a PDF buffer and returns { url, publicId }. Without Cloudinary
// configured this falls back to disk so local dev still works — but on Render
// that directory is wiped by every deploy, which is why the warning is loud.
const storeDeliveryPdf = async (buffer, publicId, diskName) => {
  if (cloudinaryReady()) {
    const result = await uploadBufferToCloudinary(buffer, publicId, 'raw');
    return { url: result.secure_url, publicId: result.public_id };
  }

  console.warn('⚠️ Cloudinary not configured — writing delivery PDF to disk (lost on restart)');
  const dir = path.join(process.cwd(), 'public/uploads/packing_lists');
  if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, diskName), buffer);
  return { url: `/uploads/packing_lists/${diskName}`, publicId: '' };
};

// Signature pads produce 340x130 line art on transparency. The shared image
// helper re-encodes everything to WebP at up to 1200px, which is the wrong
// trade here — trimming the empty margin and keeping PNG is both smaller and
// keeps the clean alpha that stamping depends on.
const storeSignaturePng = async (dataUrl, publicId) => {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl || '';

  let buffer = Buffer.from(dataUrl.split(';base64,').pop(), 'base64');
  try {
    const sharp = (await import('sharp')).default;
    buffer = await sharp(buffer).trim({ threshold: 10 }).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    // A pad with no strokes trims to nothing and throws — keep the raw canvas PNG.
  }

  if (!cloudinaryReady()) return dataUrl;
  const result = await uploadBufferToCloudinary(buffer, publicId, 'image');
  return result.secure_url;
};

// The board's list fetch strips signatures and photos for speed, so any save
// that echoes a delivery straight back — a status change, a reschedule, a drag
// between trucks — carries a pod with those fields missing. Because $set
// replaces the whole subdocument, that used to wipe the signatures off a signed
// delivery. Absent means "unchanged" here; erasing a proof is what
// DELETE /api/deliveries/:id/pod is for.
const POD_PRESERVED_KEYS = [
  'customerSignature', 'driverSignature', 'photos', 'signeeName', 'driverName',
  'customerSignedAt', 'driverSignedAt', 'signedAt',
  'signedPdfUrl', 'signedPdfFilename', 'signedPdfPublicId',
  'clearedAt', 'clearedBy', 'clearReason'
];

const mergePodOntoExisting = (incoming = {}, existing = {}) => {
  const merged = { ...existing, ...incoming };
  for (const key of POD_PRESERVED_KEYS) {
    const value = incoming[key];
    // An explicit empty array still counts as intent (removing every photo);
    // a missing, null or blank value does not.
    const omitted = !(key in incoming) || value === undefined || value === null || value === '';
    if (omitted && existing[key] !== undefined) merged[key] = existing[key];
  }
  return merged;
};

// An ePOD counts as real only with a named signee and both signatures. Where a
// packing list exists it must also have produced a stamped copy — otherwise the
// card would advertise proof that leads to no document. A delivery with no
// packing list to begin with is still proven by the signatures alone; requiring
// a PDF there would leave it permanently reading "No ePOD" after a valid signing.
const derivePodVerified = (pod, hasPackingList) => Boolean(
  pod &&
  String(pod.signeeName || '').trim() &&
  pod.customerSignature &&
  pod.driverSignature &&
  (!hasPackingList || pod.signedPdfUrl)
);

/**
 * Which captions the stamped certificate carries.
 *
 * An order the customer collected was signed for by whoever came for it and
 * whoever released it at the counter — printing "Driver" on that certificate
 * would name a role nobody filled. Derived here rather than taken from the
 * browser: this text is stamped into a document that is then treated as proof.
 *
 * Will calls say so on the delivery. Contract freight does not — its column is
 * a driver user account, so the only way to recognise it is by the name on the
 * account the ticket was filed under.
 */
const certificateWordingFor = async ({ deliveryType, truckId }) => {
  // Checked before anything else: a return is a return whether a driver went
  // out for it or the customer brought it back, and its certificate names the
  // two parties the opposite way round from every other ticket.
  if (isReturn({ deliveryType })) return RETURN_WORDING;
  if (isWillCall({ deliveryType })) return PICKUP_WORDING;

  const id = String(truckId || '');
  if (!id) return DELIVERY_WORDING;
  if (id === THIRD_PARTY_TRUCK_ID) return PICKUP_WORDING;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return DELIVERY_WORDING;

  const truckUser = await User.findById(id, 'name username').lean();
  return THIRD_PARTY_NAME.test(`${truckUser?.name || ''} ${truckUser?.username || ''}`)
    ? PICKUP_WORDING
    : DELIVERY_WORDING;
};

// ── Location-scoping ─────────────────────────────────────────────────────
// Restrict a delivery query to the branches a user is assigned to.
//
// Deliveries whose location is unset stay visible to everyone, which is the
// rule the board applied client-side and the only safe one today: every
// existing delivery has location: '' because nothing populates the field yet.
// Scoping strictly would empty the board for all users. Once deliveries start
// carrying a location, this filter narrows them automatically.
//
// `dateRange` ({ start, end }) is only supplied by the week-range list query
// below. When present, each location-matching clause gets its own date field
// instead of one shared condition applied outside the $or — a transfer's ship
// date is what the origin branch's week view means, but its expected-arrival
// date is what the destination branch's week view means, and they can fall in
// different weeks entirely.
//
// `requestedLocation` (from the board's location filter — see the 'location'
// query param on GET /api/deliveries) narrows the view to just one branch
// instead of every branch this user can already reach. The caller must
// validate it against userCanRequestLocation first — this function just
// treats the narrowed set as if it were the user's whole assignedLocations,
// which naturally keeps the transfer-destination rule below working the same
// way it does for an ordinary single-location user.
const scopeDeliveryQueryToLocations = (query, req, dateRange, requestedLocation) => {
  const userLocations = requestedLocation ? [requestedLocation] : (req.user?.assignedLocations || []);
  const inRange = (field) => dateRange ? { [field]: { $gte: dateRange.start, $lte: dateRange.end } } : {};

  if (userLocations.includes('*')) {
    if (!dateRange) return query;
    // Sees every branch, but a transfer still needs its own date lens for a
    // week view to be complete — otherwise one shipping next week but landing
    // this week would be invisible from an admin's view either way.
    return { ...query, $or: [inRange('date'), { deliveryType: 'transfer', ...inRange('expectedArrivalDate') }] };
  }

  return {
    ...query,
    $or: [
      { location: { $in: [...userLocations, '', '*'] }, ...inRange('date') },
      { location: { $exists: false }, ...inRange('date') },
      { location: null, ...inRange('date') },
      // An inbound transfer belongs to the branch it's headed to as much as
      // the branch that shipped it — visible (and, via every route that
      // shares this helper, editable/deletable) from both sides, so a
      // receiving branch isn't stuck waiting on the shipper to fix a wrong
      // date or cancel it themselves. Matched by expected-arrival date, not
      // ship date — see the list route below for how that's also reflected
      // in which day the card renders on.
      { deliveryType: 'transfer', transferDestination: { $in: userLocations }, ...inRange('expectedArrivalDate') }
    ]
  };
};

// Plain true/false mirror of scopeDeliveryQueryToLocations's access rule, for
// write paths that need to check a location before a record necessarily
// exists in the DB (a brand-new delivery, or an edit that reassigns
// location/transferDestination) rather than filtering an existing query.
// Keep this in sync with scopeDeliveryQueryToLocations above.
const userCanAccessDeliveryLocation = (req, { location, deliveryType, transferDestination } = {}) => {
  const userLocations = req.user?.assignedLocations || [];
  if (userLocations.includes('*')) return true;
  if (!location || location === '*') return true;
  if (userLocations.includes(location)) return true;
  return deliveryType === 'transfer' && !!transferDestination && userLocations.includes(transferDestination);
};

// Whether this user is allowed to narrow their own view to one specific
// branch via the board's location filter (?location=). An admin can pick
// any real branch; everyone else can only narrow to a branch already inside
// their own assignedLocations. Explicitly rejects '*' from a non-admin —
// without this, scopeDeliveryQueryToLocations would treat a request for
// location='*' as if the caller actually held it, handing back every
// branch's deliveries to someone assigned to just one.
const userCanRequestLocation = (req, requestedLocation) => {
  if (!requestedLocation) return true;
  const userLocations = req.user?.assignedLocations || [];
  if (userLocations.includes('*')) return true;
  return userLocations.includes(requestedLocation);
};

// ── Socket.IO room scoping ───────────────────────────────────────────────
// Socket.IO room name for a branch's delivery updates. A dedicated constant
// (rather than inlining the template literal everywhere) so the join side
// (server.js's io.on('connection') handler) and the emit side below can't
// drift apart on the naming scheme.
const deliveryRoomFor = (location) => `delivery-location:${location}`;
// Sockets whose user holds '*' join this instead of every individual branch
// room, so an admin/director keeps seeing every location without the server
// having to know the full list of branches that currently exist.
const DELIVERY_ROOM_ALL = 'delivery-location:*';

// Which room(s) an update to this delivery needs to reach — mirrors
// scopeDeliveryQueryToLocations's read-side rule: a transfer belongs to both
// the shipping branch and the destination branch.
const deliveryRoomsFor = (record) => {
  const rooms = [DELIVERY_ROOM_ALL];
  if (record?.location) rooms.push(deliveryRoomFor(record.location));
  if (record?.deliveryType === 'transfer' && record?.transferDestination) {
    rooms.push(deliveryRoomFor(record.transferDestination));
  }
  return rooms;
};

// Replaces a plain `io.emit('delivery_update', ...)` (a broadcast to every
// connected socket, authenticated or not — full customer names, addresses,
// invoice numbers and freight pricing for every branch reaching every open
// tab). Targets only the room(s) the affected branch(es) join. `req.app.get
// ('io')` rather than a captured module-level `io` — app.set('io', io) runs
// in server.js before any request reaches this router, so it's always
// populated by the time a route handler needs it.
const emitDeliveryUpdate = (req, payload, record) => {
  const io = req.app.get('io');
  if (!io) return;
  for (const room of deliveryRoomsFor(record)) {
    io.to(room).emit('delivery_update', payload);
  }
};

// ── List projection ──────────────────────────────────────────────────────
// Board/list views never need the raw embedded POD images (base64 signatures/
// photos can be 100s of KB each) — excluding them keeps list fetches and
// socket broadcasts fast regardless of network conditions. Full POD data is
// fetched on-demand via GET /api/deliveries/:id when a specific delivery's
// POD is actually opened.
const DELIVERY_LIST_PROJECTION = {
  'pod.customerSignature': 0,
  'pod.driverSignature': 0,
  'pod.photos': 0
};

// ── Packing-list upload hardening ────────────────────────────────────────
// Memory storage, not disk: Render's filesystem is ephemeral, so a previous
// diskStorage write produced a packingListUrl that broke on the next deploy.
//
// A real packing list is a few hundred KB to a few MB; 15MB comfortably
// covers a multi-page scanned document with images without leaving the limit
// wide open. This used to be 50MB with no other check at all — any file type
// was accepted and handed straight to Cloudinary, then served back out as if
// it were a trusted PDF.
const uploadPackingList = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Real PDFs start with these 5 bytes regardless of what extension or
// mimetype the upload claims — the same magic-byte-over-metadata approach
// src/utils/inventoryImport.js's isBinaryWorkbook uses for spreadsheet
// imports, and for the same reason: a client-supplied filename/mimetype is
// just a label, not a guarantee.
const PDF_MAGIC = Buffer.from('%PDF-');
const isPdfBuffer = (buffer) => Buffer.isBuffer(buffer) && buffer.length >= PDF_MAGIC.length
  && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);

export default function createDeliveriesRouter({
  authenticate,
  requirePermission,
  requireAnyPermission,
  getPerformerInfo,
  processBase64Images,
  getNowLocalISO
}) {
  const router = express.Router();

  // ── Delivery schedule authorisation ────────────────────────────────────
  // Guard levels are chosen against the live role config, not the seed
  // defaults:
  //   view_delivery_schedule   — held by all six staff roles
  //   edit_delivery_schedule   — all staff EXCEPT driver
  //   delete_delivery_schedule — admin / director / manager only
  //
  // Drivers legitimately POST (ePOD capture, via the same upsert endpoint as
  // a full edit) and PATCH their own status despite lacking
  // edit_delivery_schedule, so those two routes accept view_delivery_schedule
  // as well (canWriteDeliveries). Reassignment, reordering and uploading a
  // packing list are dispatcher/office actions a driver's app never calls —
  // those require edit_delivery_schedule outright (canManageDeliverySchedule),
  // so a role an admin deliberately configures as view-only in Users & Roles
  // can no longer mutate/reassign/reorder the board via a direct API call
  // just because the UI happens to hide the buttons for it.
  //
  // Deletion is the exception: it requires delete_delivery_schedule outright,
  // so who can remove a delivery is controlled purely by role config in
  // Users & Roles → Delivery Schedule → Delete.
  const canViewDeliveries = requirePermission('view_delivery_schedule');
  const canWriteDeliveries = requireAnyPermission('edit_delivery_schedule', 'view_delivery_schedule');
  const canManageDeliverySchedule = requirePermission('edit_delivery_schedule');
  const canDeleteDeliveries = requirePermission('delete_delivery_schedule');
  // Deliberately separate from deletion: a dispatcher who should never remove a
  // job may still need to void a proof the wrong customer signed, and the reverse
  // holds too.
  const canClearPod = requirePermission('clear_pod_signatures');

  router.get('/trucks', authenticate, canViewDeliveries, async (req, res) => {
    try {
      const trucks = await Truck.find().lean();
      res.json(trucks);
    } catch {
      res.status(500).json({ error: 'Failed to fetch trucks' });
    }
  });

  router.post('/trucks', authenticate, requirePermission('edit_delivery_schedule'), async (req, res) => {
    try {
      const { trucks } = req.body;
      if (Array.isArray(trucks)) {
        for (const t of trucks) {
          if (t.id) {
            await Truck.findOneAndUpdate({ id: t.id }, { $set: t }, { upsert: true });
          }
        }
      }
      const updated = await Truck.find().lean();
      req.app.get('io')?.emit('truck_update', updated);
      res.json(updated);
    } catch {
      res.status(500).json({ error: 'Failed to save trucks' });
    }
  });

  router.get('/deliveries', authenticate, canViewDeliveries, async (req, res) => {
    try {
      // The board only ever displays one week at a time — scope the query to that
      // range (via ?startDate=&endDate=, both 'YYYY-MM-DD') instead of pulling the
      // entire, ever-growing delivery history on every load. Falls back to the full
      // collection if no range is given.
      // An order with no driver assigned is Pending: it is waiting on the customer
      // for a date and a driver, and belongs to no truck column. ?pending=true
      // returns those; a week request returns the assigned ones only, so nothing
      // is stranded between the two views.
      // A will call is not pending, though it never gets a driver: the customer
      // collects it on a known date, so it belongs to its week under the board's
      // Will Call column. Both queries account for it so it lands in exactly one.
      // A customer drop-off (a return with a date, no driver, and the explicit
      // customerDropOff flag set) works the same way, under the board's Drop-Off
      // column. A return with no date yet has no day to be drawn on, so that one
      // waits in Pending like any other undated order — and so does a driverless
      // return WITH a date whose customerDropOff flag isn't set: that just means
      // nobody has picked a driver for it yet, not that the customer is bringing
      // it back themselves. That flag (not merely "has a date") is what decides
      // the drop-off side; see isCounterReturn in src/utils/deliveryTypes.js.
      //
      // These two branches are complements and have to stay that way: the JS
      // side of the same rule is isPendingDelivery in src/utils/deliveryTypes.js,
      // which has tests asserting every ticket lands in exactly one view. A
      // ticket that matches neither query is not an error anywhere — it just
      // stops existing as far as the app is concerned.
      // ?location= lets a user who can already reach more than one branch (an
      // admin, or someone with several assignedLocations) narrow the board to
      // just one at a time instead of every branch they can see mashed
      // together — see the location selector in DeliveryScheduleTab.jsx.
      const { startDate, endDate, pending, location: requestedLocation } = req.query;
      if (requestedLocation && !userCanRequestLocation(req, requestedLocation)) {
        return res.status(403).json({ error: 'You do not have access to that location' });
      }
      let baseQuery;
      if (pending === 'true') {
        // $in rather than $or: the location scoping below contributes its own $or,
        // and a second one on the same object would replace this filter outright.
        // { $in: ['', null] } also matches documents with no truckId field at all.
        // $nor (not a second $or) carves out the dated drop-offs for the same
        // reason.
        baseQuery = {
          truckId: { $in: ['', null] },
          deliveryType: { $ne: 'will_call' },
          $nor: [{ deliveryType: 'return', date: { $nin: ['', null] }, customerDropOff: true }]
        };
      } else if (startDate && endDate) {
        // The date range now lives in scopeDeliveryQueryToLocations's own $or
        // (see below) rather than as a bare condition here, so it can apply to
        // a different field for an inbound transfer than for everything else.
        // Still wrapped in $and for the same reason as before: the location
        // scoping owns the top-level $or.
        // A driverless return only belongs on the board once it's flagged as a
        // drop-off — otherwise (dated or not) it's left to the Pending branch
        // above, same as any other order nobody has assigned a driver to yet.
        baseQuery = {
          $and: [{
            $or: [
              { truckId: { $nin: ['', null] } },
              { deliveryType: 'will_call' },
              { deliveryType: 'return', customerDropOff: true }
            ]
          }]
        };
      } else {
        baseQuery = {};
      }
      const dateRange = (startDate && endDate) ? { start: startDate, end: endDate } : undefined;
      const query = scopeDeliveryQueryToLocations(baseQuery, req, dateRange, requestedLocation);
      // The week view is already bounded by startDate/endDate — only Pending
      // is genuinely unbounded (every branch's undated/unassigned orders,
      // with no date range to narrow it). It should stay small in practice —
      // an order only sits here until someone assigns it a truck/date — but
      // nothing enforces that, so a stuck integration or a quiet week of
      // dispatching could grow it indefinitely. Oldest-first with a cap: if
      // the cap is ever actually hit, that's a real operational problem
      // (a backlog nobody is working through) worth surfacing rather than
      // masking by quietly returning more each time it's asked.
      const PENDING_LIST_CAP = 500;
      const list = pending === 'true'
        ? await Delivery.find(query, DELIVERY_LIST_PROJECTION).sort({ createdAt: 1 }).limit(PENDING_LIST_CAP).lean()
        : await Delivery.find(query, DELIVERY_LIST_PROJECTION).sort({ createdAt: -1 }).lean();

      // A transfer's stored `date` is its ship date — correct for the origin
      // branch's own week view, but meaningless to a branch that only relates
      // to it as the destination. Show those by expected arrival instead, so
      // the card renders on the day it's actually relevant to for whoever's
      // looking. This has to key off who the viewer actually is, not just
      // "whichever date happens to fall in this range" — a transfer shipping
      // Monday and arriving Wednesday of the same week has *both* dates in
      // range, and the destination branch still needs to see Wednesday, not
      // silently fall back to Monday because that also matched. Only this list
      // response is reshaped this way; the single-ticket fetch that populates
      // the edit modal always shows the real stored ship date.
      const inWeek = (d) => Boolean(d && startDate && endDate && d >= startDate && d <= endDate);
      // Same narrowing as the query above — an admin who filtered down to one
      // branch should see that branch's own transfer perspective (arrival
      // date for an inbound transfer), not their usual admin-wide one.
      const userLocations = requestedLocation ? [requestedLocation] : (req.user?.assignedLocations || []);
      const viewerIsAdmin = userLocations.includes('*');
      const shaped = dateRange
        ? list.map(d => {
            if (d.deliveryType !== 'transfer') return d;
            const viewerIsOrigin = viewerIsAdmin || !d.location || userLocations.includes(d.location);
            if (!viewerIsOrigin) {
              // Related to this ticket only as the destination — always the
              // arrival date, regardless of whether the ship date also
              // happens to fall in this same week.
              return d.expectedArrivalDate ? { ...d, date: d.expectedArrivalDate, isIncomingView: true } : d;
            }
            // Origin (or admin, or an unowned ticket): the ship date is what's
            // shown normally. Falls back to the arrival date only when the
            // ship date itself isn't actually in the displayed week — an
            // admin browsing the week it's due, not the week it left.
            if (inWeek(d.date)) return d;
            if (inWeek(d.expectedArrivalDate)) return { ...d, date: d.expectedArrivalDate, isIncomingView: true };
            return d;
          })
        : list;

      res.json(shaped);
    } catch (err) {
      console.error('[server] get deliveries error:', err);
      res.status(500).json({ error: 'Server error fetching deliveries' });
    }
  });

  router.get('/deliveries/:id', authenticate, canViewDeliveries, async (req, res) => {
    try {
      const { id } = req.params;
      const delivery = await Delivery.findOne(scopeDeliveryQueryToLocations({ id }, req)).lean();
      if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
      res.json(delivery);
    } catch (err) {
      console.error('[server] get delivery by id error:', err);
      res.status(500).json({ error: 'Server error fetching delivery' });
    }
  });

  router.post('/deliveries', authenticate, canWriteDeliveries, async (req, res) => {
    try {
      const delivery = req.body;
      if (!delivery || !delivery.id) return res.status(400).json({ error: 'Invalid delivery data' });

      // This route upserts by id, so it's the one write path every create AND
      // edit goes through.
      const existing = await Delivery.findOne(
        { id: delivery.id },
        'location deliveryType transferDestination pod packingListUrl packingListFilename truckId'
      ).lean();

      // Editing a record that already exists: its CURRENT location has to be
      // one this user can reach.
      if (existing && !userCanAccessDeliveryLocation(req, existing)) {
        return res.status(403).json({ error: 'You do not have access to this delivery' });
      }
      // Whatever location this write would leave the record at — a brand-new
      // delivery, or an edit reassigning location/transferDestination — also
      // has to be reachable, or a user could create/move a delivery into a
      // branch they aren't assigned to.
      const resultingLocation = {
        location: delivery.location !== undefined ? delivery.location : existing?.location,
        deliveryType: delivery.deliveryType !== undefined ? delivery.deliveryType : existing?.deliveryType,
        transferDestination: delivery.transferDestination !== undefined ? delivery.transferDestination : existing?.transferDestination
      };
      if (!userCanAccessDeliveryLocation(req, resultingLocation)) {
        return res.status(403).json({ error: 'You do not have access to that location' });
      }

      const updateData = { ...delivery };
      delete updateData._id;

      const assetIds = podAssetIds(delivery.id);

      // ePOD validity is a server conclusion, never a client claim — drop whatever
      // the browser sent and recompute it from the record further down.
      if (updateData.pod) delete updateData.pod.verified;

      // A packing list arriving inline as base64 becomes a stored PDF. Previously
      // this wrote to public/uploads, which Render wipes on every deploy — the
      // saved URL outlived the file it pointed at.
      //
      // This is the SECOND path a packing list can arrive by — the frontend's
      // Browse-PDF picker falls back to it (reading the file as a data URL
      // and sending it inline here) whenever POST /upload-packing-list
      // fails, including when it rejects a non-PDF. The `data:application/
      // pdf` prefix checked below is the browser's OWN claimed mimetype for
      // the file — exactly the kind of label a renamed file can carry
      // regardless of its real contents, same as the upload route's — so
      // this path needs the identical magic-byte check, not just a mimetype
      // check, or the exact upload rejection above becomes bypassable by
      // simply hitting this route instead.
      if (updateData.packingListUrl && updateData.packingListUrl.toLowerCase().startsWith('data:application/pdf')) {
        try {
          const base64Parts = updateData.packingListUrl.split(',');
          const base64Data = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];
          const buffer = Buffer.from(base64Data, 'base64');
          if (!isPdfBuffer(buffer)) {
            throw new Error('Attached file is not a real PDF');
          }
          const stored = await storeDeliveryPdf(
            buffer,
            assetIds.packingList,
            `packing_list_${safeIdSegment(delivery.id)}.pdf`
          );
          updateData.packingListUrl = stored.url;
          updateData.packingListPublicId = stored.publicId;
          if (!updateData.packingListFilename) {
            updateData.packingListFilename = 'PackingList.pdf';
          }
          console.log(`📄 Stored packing list for ${delivery.id}: ${stored.url}`);
        } catch (convErr) {
          // Drop the rejected/unstorable attachment rather than saving the
          // rest of the delivery with a data: URL sitting in packingListUrl
          // forever — that would bloat every list fetch and socket
          // broadcast this ticket appears in (see DELIVERY_LIST_PROJECTION's
          // own comment for why that's specifically what this app avoids).
          updateData.packingListUrl = existing?.packingListUrl || '';
          updateData.packingListFilename = existing?.packingListFilename || '';
          console.error('Error storing base64 packing list:', convErr.message);
        }
      }

      if (updateData.pod) {
        updateData.pod = mergePodOntoExisting(updateData.pod, existing?.pod || {});

        // The signature pads send data URLs. Stamp the certificate before those
        // get swapped for hosted URLs, since pdf-lib embeds from the raw bytes.
        const freshCustSig = String(updateData.pod.customerSignature || '').startsWith('data:image/');
        const freshDriverSig = String(updateData.pod.driverSignature || '').startsWith('data:image/');

        const sourcePdf = updateData.packingListUrl || existing?.packingListUrl || '';

        // Stamping runs here rather than on the driver's phone: the device uploads
        // ~30KB of signature PNGs instead of pulling down a multi-MB packing list
        // and pushing the whole signed copy back over cellular.
        if (freshCustSig && freshDriverSig && sourcePdf) {
          try {
            const wording = await certificateWordingFor({
              deliveryType: updateData.deliveryType ?? existing?.deliveryType,
              truckId: updateData.truckId ?? existing?.truckId
            });

            const signedBytes = await stampSignaturesOnPdfBytes({
              pdfUrl: sourcePdf,
              customerSignatureDataUrl: updateData.pod.customerSignature,
              driverSignatureDataUrl: updateData.pod.driverSignature,
              signeeName: updateData.pod.signeeName || '',
              driverName: updateData.pod.driverName || '',
              signedAt: updateData.pod.signedAt || new Date(),
              customerSignedAt: updateData.pod.customerSignedAt,
              driverSignedAt: updateData.pod.driverSignedAt,
              wording
            });

            // Named after the packing list number — "145994_signed.pdf" — so the
            // signed copy files next to the paperwork it was stamped from.
            const signedName = signedPackingListFileName({
              packingListFilename: updateData.packingListFilename || delivery.packingListFilename,
              soNumber: delivery.soNumber,
              invoiceNumber: delivery.invoiceNumber,
              id: delivery.id
            });

            const stored = await storeDeliveryPdf(
              Buffer.from(signedBytes),
              assetIds.signedPdf,
              signedName
            );
            updateData.pod.signedPdfUrl = stored.url;
            updateData.pod.signedPdfPublicId = stored.publicId;
            updateData.pod.signedPdfFilename = signedName;
          } catch (stampErr) {
            // Drop any previously stamped copy: these are new signatures, and a
            // fresh proof must never point at the document the last one produced.
            // pod.verified then stays false rather than claiming a delivery is
            // proven against a PDF that doesn't match it.
            updateData.pod.signedPdfUrl = '';
            updateData.pod.signedPdfPublicId = '';
            updateData.pod.signedPdfFilename = '';
            console.error(`[pod] stamping failed for ${delivery.id}:`, stampErr);
          }
        }

        // Signatures and photos move to Cloudinary so the delivery document stays
        // small — inline base64 used to bloat list queries and socket broadcasts.
        try {
          updateData.pod.customerSignature =
            await storeSignaturePng(updateData.pod.customerSignature, assetIds.custSig);
          updateData.pod.driverSignature =
            await storeSignaturePng(updateData.pod.driverSignature, assetIds.driverSig);

          if (Array.isArray(updateData.pod.photos) && updateData.pod.photos.length > 0) {
            updateData.pod.photos = await processBase64Images(updateData.pod.photos, 'deliveries/pod');
          }
        } catch (podErr) {
          console.error('Error uploading POD images to Cloudinary:', podErr);
        }

        updateData.pod.verified = derivePodVerified(updateData.pod, Boolean(sourcePdf));

        // A fresh signature ends the "awaiting re-sign" state left by a clear.
        if (updateData.pod.verified) {
          updateData.pod.clearedAt = null;
          updateData.pod.clearedBy = '';
          updateData.pod.clearReason = '';
        }
      }

      const updated = await Delivery.findOneAndUpdate(
        { id: delivery.id },
        { $set: updateData },
        { upsert: true, new: true }
      ).lean();

      // Broadcast just the single changed record — not the whole collection. Clients
      // merge it into whichever cached week(s) it belongs to.
      emitDeliveryUpdate(req, { type: 'upsert', delivery: updated }, updated);
      res.json(updated);
    } catch (err) {
      console.error('[server] save delivery error:', err);
      res.status(500).json({ error: 'Server error saving delivery' });
    }
  });

  // PATCH /api/deliveries/:id/status — the driver app's only write besides an ePOD.
  //
  // Separate from POST /api/deliveries because the driver's phone holds a list
  // projection: echoing that whole record back to change one field wrote every
  // other field as the phone last saw it, reverting whatever the office had
  // edited since. Narrowing the write to `status` removes the race entirely.
  //
  // Location scoping applies here as it does everywhere else, so a driver cannot
  // reach a stop belonging to a branch they are not assigned to.
  const DELIVERY_STATUSES = ['pending', 'scheduled', 'completed', 'delayed'];

  router.patch('/deliveries/:id/status', authenticate, canWriteDeliveries, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body || {};

      if (!DELIVERY_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${DELIVERY_STATUSES.join(', ')}` });
      }

      const updated = await Delivery.findOneAndUpdate(
        scopeDeliveryQueryToLocations({ id }, req),
        { $set: { status } },
        { new: true, projection: DELIVERY_LIST_PROJECTION }
      ).lean();

      if (!updated) return res.status(404).json({ error: 'Delivery not found' });

      // Completion is not proof. Marking a stop delivered says the material got
      // there; pod.verified stays whatever the signatures make it, so a card can
      // still honestly read "No ePOD" on a completed stop.
      emitDeliveryUpdate(req, { type: 'upsert', delivery: updated }, updated);

      res.json(updated);
    } catch (err) {
      console.error('[server] update delivery status error:', err);
      res.status(500).json({ error: 'Server error updating the delivery status' });
    }
  });

  // PATCH /api/deliveries/:id/assignment — the dispatch board's drag-and-drop move.
  //
  // Only writes the three fields that decide which slot (truck/column, day) a
  // delivery sits in, so this writes just those instead of echoing the
  // board's cached copy of the whole record back through POST /api/deliveries.
  // Imported rather than restated, so the whitelist can't drift from the model
  // enum or from the placement rules the board and Pending list share.
  //
  // Requires edit_delivery_schedule outright (not the broader
  // canWriteDeliveries) — a driver's app never calls this.
  router.patch('/deliveries/:id/assignment', authenticate, canManageDeliverySchedule, async (req, res) => {
    try {
      const { id } = req.params;
      let { truckId, deliveryType, date, customerDropOff } = req.body || {};
      // Only meaningful on a driverless return (see isCounterReturn in
      // src/utils/deliveryTypes.js) — coerced to a plain boolean here so an
      // omitted or falsy value from an older client never persists as anything
      // other than "not a drop-off", rather than leaving whatever was stored
      // before untouched.
      customerDropOff = customerDropOff === true;

      if (!DELIVERY_TYPES.includes(deliveryType)) {
        return res.status(400).json({ error: `deliveryType must be one of: ${DELIVERY_TYPES.join(', ')}` });
      }
      if (deliveryType === 'will_call') {
        // A will call is never on a truck, regardless of what the client sent.
        truckId = '';
      } else if (typeof truckId !== 'string') {
        // An empty string is allowed and meaningful: it is the board's reverse
        // move, dragging a ticket off a truck column and back into Pending.
        // GET /api/deliveries?pending=true is exactly "truckId in ['', null]
        // and not a will call", so clearing the truck is what puts a ticket
        // back on that list. A missing/undefined truckId still fails — that's a
        // malformed request rather than a deliberate un-assignment, and
        // silently clearing the truck on one would strand the ticket off the
        // week view with no visible sign of where it went.
        return res.status(400).json({
          error: 'truckId must be a string — "" moves the delivery back to Pending'
        });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
        return res.status(400).json({ error: 'date must be a YYYY-MM-DD string' });
      }

      const updated = await Delivery.findOneAndUpdate(
        scopeDeliveryQueryToLocations({ id }, req),
        { $set: { truckId, deliveryType, date, customerDropOff } },
        { new: true, projection: DELIVERY_LIST_PROJECTION }
      ).lean();

      if (!updated) return res.status(404).json({ error: 'Delivery not found' });

      emitDeliveryUpdate(req, { type: 'upsert', delivery: updated }, updated);

      res.json(updated);
    } catch (err) {
      console.error('[server] update delivery assignment error:', err);
      res.status(500).json({ error: 'Server error updating the delivery assignment' });
    }
  });

  // PATCH /api/deliveries/order — the board's drag-to-reorder.
  //
  // Reordering is a statement about a whole cell, not about one ticket: moving
  // the third stop to the top renumbers everything it jumped over. Sending that
  // as one request per card would be N round trips racing each other, and a
  // half-applied order is worse than none — two stops both called #2, with the
  // tie broken by whatever time they happen to carry.
  //
  // Only routeNumber is written. Which driver and which day a ticket belongs to
  // is the assignment endpoint's business, and a reorder must not quietly move a
  // ticket between columns as a side effect of dropping it in a list.
  //
  // Requires edit_delivery_schedule outright, same reasoning as assignment
  // above.
  router.patch('/deliveries/order', authenticate, canManageDeliverySchedule, async (req, res) => {
    try {
      const { updates } = req.body || {};
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: 'updates must be a non-empty array of { id, routeNumber }' });
      }
      // A cell holds at most MAX_TRUCK_CAPACITY stops; anything an order of
      // magnitude past that is a malformed request, not a busy day.
      if (updates.length > 100) {
        return res.status(400).json({ error: 'Too many deliveries in one reorder' });
      }

      const clean = [];
      for (const u of updates) {
        const id = String(u?.id || '');
        const routeNumber = Number(u?.routeNumber);
        if (!id) return res.status(400).json({ error: 'Every update needs an id' });
        if (!Number.isInteger(routeNumber) || routeNumber < 1 || routeNumber > 100) {
          return res.status(400).json({ error: `routeNumber must be a whole number from 1 to 100 (got ${u?.routeNumber})` });
        }
        clean.push({ id, routeNumber });
      }

      // Scoped the same way every other write is: a user may only reorder stops
      // at a branch they are assigned to. Ids outside that are dropped rather
      // than failing the whole request, so one stale id in a list cannot block a
      // dispatcher from fixing the run in front of them.
      const ids = clean.map(u => u.id);
      const writable = await Delivery.find(
        scopeDeliveryQueryToLocations({ id: { $in: ids } }, req), 'id truckId date'
      ).lean();
      const writableById = new Map(writable.map(d => [d.id, d]));
      const applicable = clean.filter(u => writableById.has(u.id));
      if (!applicable.length) return res.status(404).json({ error: 'None of those deliveries were found' });

      // Conflict check: a reorder resubmits a whole cell's order at once (see
      // comment above), so if some OTHER delivery already sitting in one of
      // these same (truckId, date) cells — one this request doesn't even
      // know about — already holds one of the route numbers being assigned,
      // the client's view of that cell was stale (someone else changed it
      // after this board loaded, or a second reorder of the same cell is
      // racing this one). Applying it anyway would silently create two
      // stops both numbered the same. This isn't full optimistic-concurrency
      // (no version field on the model), but it catches the actual failure
      // mode — duplicate route numbers from a race — cheaply.
      const cellRouteNumbers = new Map(); // "truckId||date" -> Set(routeNumber)
      for (const u of applicable) {
        const rec = writableById.get(u.id);
        const cellKey = `${rec.truckId || ''}||${rec.date || ''}`;
        if (!cellRouteNumbers.has(cellKey)) cellRouteNumbers.set(cellKey, new Set());
        cellRouteNumbers.get(cellKey).add(u.routeNumber);
      }
      const applicableIds = new Set(applicable.map(u => u.id));
      const cellFilters = [...cellRouteNumbers.keys()].map(key => {
        const [truckId, date] = key.split('||');
        return { truckId, date };
      });
      const siblings = await Delivery.find(
        { $or: cellFilters, id: { $nin: [...applicableIds] } },
        'id truckId date routeNumber'
      ).lean();
      for (const sibling of siblings) {
        const cellKey = `${sibling.truckId || ''}||${sibling.date || ''}`;
        if (cellRouteNumbers.get(cellKey)?.has(sibling.routeNumber)) {
          return res.status(409).json({
            error: "This run changed since you loaded it — refresh and try reordering again."
          });
        }
      }

      await Delivery.bulkWrite(applicable.map(u => ({
        updateOne: { filter: { id: u.id }, update: { $set: { routeNumber: u.routeNumber } } }
      })));

      const updated = await Delivery.find(
        { id: { $in: applicable.map(u => u.id) } }, DELIVERY_LIST_PROJECTION
      ).lean();

      for (const delivery of updated) {
        emitDeliveryUpdate(req, { type: 'upsert', delivery }, delivery);
      }

      res.json(updated);
    } catch (err) {
      console.error('[server] reorder deliveries error:', err);
      res.status(500).json({ error: 'Server error reordering the deliveries' });
    }
  });

  // PATCH /api/deliveries/:id/receive — the destination branch confirming a
  // transfer actually arrived. Lives on the ticket itself so it's one source of
  // truth, re-derived fresh into the destination's Daily Work Report every time
  // it's opened (see deriveFromSystem in src/routes/dailyReports.js).
  //
  // Deliberately not scoped with scopeDeliveryQueryToLocations — that checks
  // `location`, the origin branch, which is the wrong side of this ticket for
  // this action. Only someone assigned to transferDestination (or an admin
  // with '*') may confirm receipt.
  router.patch('/deliveries/:id/receive', authenticate, canWriteDeliveries, async (req, res) => {
    try {
      const { id } = req.params;
      const delivery = await Delivery.findOne({ id, deliveryType: 'transfer' });
      if (!delivery) return res.status(404).json({ error: 'Transfer ticket not found' });

      const userLocations = req.user?.assignedLocations || [];
      const canReceive = userLocations.includes('*') || userLocations.includes(delivery.transferDestination);
      if (!canReceive) {
        return res.status(403).json({ error: 'Only the receiving branch can confirm this transfer arrived.' });
      }

      const { name: performedByName } = await getPerformerInfo(req);
      delivery.receivedAt = new Date();
      delivery.receivedBy = performedByName || '';
      await delivery.save();

      const updated = await Delivery.findOne({ id }, DELIVERY_LIST_PROJECTION).lean();

      emitDeliveryUpdate(req, { type: 'upsert', delivery: updated }, updated);

      res.json(updated);
    } catch (err) {
      console.error('[server] mark transfer received error:', err);
      res.status(500).json({ error: 'Server error marking the transfer received' });
    }
  });

  router.delete('/deliveries/:id', authenticate, canDeleteDeliveries, async (req, res) => {
    try {
      const { id } = req.params;
      // Scoped the same way every other :id route here is (GET/status/
      // assignment) — anyone with delete rights could otherwise delete any
      // branch's delivery by guessing an id.
      const deleted = await Delivery.findOneAndDelete(scopeDeliveryQueryToLocations({ id }, req));
      if (!deleted) {
        return res.status(404).json({ error: 'Delivery not found' });
      }
      emitDeliveryUpdate(req, { type: 'delete', id }, deleted);
      res.json({ success: true, id });
    } catch (err) {
      console.error('[server] delete delivery error:', err);
      res.status(500).json({ error: 'Server error deleting delivery' });
    }
  });

  router.delete('/deliveries/:id/pod', authenticate, canClearPod, async (req, res) => {
    try {
      const { id } = req.params;
      const reason = String(req.body?.reason || '').trim();
      if (reason.length < 4) {
        return res.status(400).json({ error: 'A reason is required to clear an ePOD.' });
      }

      const delivery = await Delivery.findOne(scopeDeliveryQueryToLocations({ id }, req));
      if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

      const { id: performedBy, name: performedByName } = await getPerformerInfo(req);
      const assetIds = podAssetIds(id);
      const previous = delivery.pod || {};

      // Destroy by stored id where we have one, falling back to the derived id for
      // records written before publicIds were tracked.
      await Promise.all([
        destroyCloudinaryAsset(previous.signedPdfPublicId || assetIds.signedPdf, 'raw'),
        destroyCloudinaryAsset(assetIds.custSig, 'image'),
        destroyCloudinaryAsset(assetIds.driverSig, 'image')
      ]);

      delivery.pod = {
        signeeName: '',
        driverName: '',
        customerSignature: '',
        driverSignature: '',
        customerSignedAt: null,
        driverSignedAt: null,
        signedAt: null,
        photos: previous.photos || [],
        notes: previous.notes || '',
        signedPdfUrl: '',
        signedPdfFilename: '',
        signedPdfPublicId: '',
        verified: false,
        clearedAt: new Date(),
        clearedBy: performedByName,
        clearReason: reason
      };
      await delivery.save();

      try {
        await ActivityLog.create({
          entityType: 'Delivery',
          entityId: delivery._id,
          action: 'DELETE',
          performedBy,
          performedByName,
          performedByRole: req.authType,
          timestamp: getNowLocalISO(),
          details: {
            scope: 'epod',
            deliveryId: id,
            soNumber: delivery.soNumber || '',
            customerName: delivery.customerName || '',
            reason,
            previousSignee: previous.signeeName || '',
            previousSignedAt: previous.signedAt || null
          }
        });
      } catch (logErr) {
        console.error('Failed to log ePOD clear:', logErr);
      }

      const updated = delivery.toObject();
      emitDeliveryUpdate(req, { type: 'upsert', delivery: updated }, updated);

      res.json({ success: true, delivery: updated });
    } catch (err) {
      console.error('[server] clear ePOD error:', err);
      res.status(500).json({ error: 'Server error clearing ePOD' });
    }
  });

  // PDF Upload Endpoint for Delivery Packing Lists. Requires
  // edit_delivery_schedule outright — a driver's app never calls this.
  router.post(
    '/deliveries/upload-packing-list',
    authenticate,
    canManageDeliverySchedule,
    uploadPackingList.single('file'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No PDF file uploaded' });
        }
        if (!isPdfBuffer(req.file.buffer)) {
          return res.status(400).json({ error: 'That file is not a real PDF — check you uploaded the right document.' });
        }

        // Keyed on the delivery when the caller names one, so re-uploading a
        // corrected packing list replaces the old asset instead of orphaning it.
        const deliveryId = req.body?.deliveryId;
        const key = deliveryId
          ? podAssetIds(deliveryId).packingList
          : `deliveries/packing_lists/tmp_${Date.now()}_${Math.round(Math.random() * 1e4)}`;

        const stored = await storeDeliveryPdf(
          req.file.buffer,
          key,
          `packing_list_${safeIdSegment(deliveryId || Date.now())}.pdf`
        );

        res.json({
          success: true,
          url: stored.url,
          publicId: stored.publicId,
          filename: req.file.originalname
        });
      } catch (err) {
        console.error('Error uploading packing list PDF:', err);
        res.status(500).json({ error: 'Failed to upload packing list PDF' });
      }
    }
  );

  return router;
}

// Exported for the socket-room join handler in server.js, which needs the
// same room-naming scheme this router's emitDeliveryUpdate uses — see the
// comment on deliveryRoomFor above for why they have to stay in sync.
export { deliveryRoomFor, DELIVERY_ROOM_ALL };
