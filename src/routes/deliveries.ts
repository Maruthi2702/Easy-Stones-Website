import type { Loose } from '../types/records.ts';
import type { Request, RequestHandler, Response } from 'express';
import express from 'express';
import { canManageShipment, isReceivingTransfer } from '../utils/transferAccess.ts';
import { normalizeVisitDate } from '../utils/visitDates.ts';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';

import Delivery from '../models/Delivery.ts';
import Truck from '../models/Truck.ts';
import User from '../models/User.ts';
import Location from '../models/Location.ts';
import ActivityLog from '../models/ActivityLog.ts';

import { stampSignaturesOnPdfBytes } from '../utils/pdfSigner.ts';
import { signedPackingListFileName } from '../utils/packingList.ts';
import { itemsToLines, parsePackingList, looksLikePackingList } from '../utils/packingListPdf.ts';
import { extractPdfTextItems } from '../utils/pdfTextItems.ts';
import {
  isWillCall, THIRD_PARTY_TRUCK_ID, THIRD_PARTY_NAME,
  PICKUP_WORDING, DELIVERY_WORDING, RETURN_WORDING
} from '../utils/deliveryPickup.ts';
import { DELIVERY_TYPES, isReturn, defaultStatusFor, isPendingDelivery, showOnArrivalDay, transferArrivalFor, columnIdFor } from '../utils/deliveryTypes.ts';
import { compactStopNumbers, nextStopNumber } from '../utils/stopGrouping.ts';
import {
  buildDeliverySearchFilter, sortSearchResults,
  SEARCH_RESULT_LIMIT, SEARCH_SCAN_LIMIT
} from '../utils/deliverySearch.ts';
import { isDeliveryDriver, DELIVERY_PERMISSIONS } from '../utils/deliveryAccess.ts';
import { cleanColumnOrder } from '../utils/deliveryColumns.ts';
// Accounting hears which deliveries changed, so a completed 3rd-party delivery
// gets its freight charge. Fire-and-forget: never slows or fails a save here.
import { deliveriesChanged } from '../accounting/hooks.ts';

/**
 * Delivery Schedule + Truck API.
 *
 * Kept out of server.ts deliberately, same reasoning as
 * src/routes/dailyReports.ts: a self-contained feature, and server.ts is
 * already thousands of lines. A few generic, cross-feature helpers
 * (getPerformerInfo, processBase64Images, getNowLocalISO) are handed in
 * rather than imported, since other features that also live in server.ts
 * share them.
 *
 *   import createDeliveriesRouter from './src/routes/deliveries.ts';
 *   app.use('/api', createDeliveriesRouter({
 *     authenticate, requirePermission, requireAnyPermission,
 *     getPerformerInfo, processBase64Images, getNowLocalISO
 *   }));
 *
 * Mounted at '/api' (not '/api/deliveries') because this file also owns
 * GET/POST /api/trucks — every route below spells out its own full path
 * from there, matching how they read in server.ts before this file existed.
 *
 * For everything else touching this feature — the board UI, the schedule
 * cache, pure scheduling math — see the map in
 * src/features/delivery/README.md.
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
const safeIdSegment = (value: unknown) => String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');

const podAssetIds = (deliveryId: Loose) => {
  const key = safeIdSegment(deliveryId);
  return {
    packingList: `deliveries/packing_lists/${key}`,
    signedPdf: `deliveries/pod/${key}/signed`,
    custSig: `deliveries/pod/${key}/sig_customer`,
    driverSig: `deliveries/pod/${key}/sig_driver`
  };
};

const uploadBufferToCloudinary = (buffer: Loose, publicId: Loose, resourceType = 'raw') =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: resourceType, overwrite: true, invalidate: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

const destroyCloudinaryAsset = async (publicId: Loose, resourceType = 'raw') => {
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
const storeDeliveryPdf = async (buffer: Loose, publicId: Loose, diskName: Loose) => {
  if (cloudinaryReady()) {
    // A raw asset is served with the content type of its extension, and the
    // extensionless id (…/tmp_1792…_5544) came back as octet-stream, so View
    // downloaded the file instead of opening it. The id keeps ".pdf".
    const rawId = /\.pdf$/i.test(publicId) ? publicId : `${publicId}.pdf`;
    const result = await uploadBufferToCloudinary(buffer, rawId, 'raw');
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
const storeSignaturePng = async (dataUrl: string, publicId: Loose) => {
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

const mergePodOntoExisting = (incoming: Loose = {}, existing: Loose = {}) => {
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
const derivePodVerified = (pod: Loose, hasPackingList: Loose) => Boolean(
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
const certificateWordingFor = async ({ deliveryType, truckId }: { deliveryType: Loose; truckId: Loose }) => {
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
const scopeDeliveryQueryToLocations = (query: string, req: Request, dateRange: Loose, requestedLocation: Loose) => {
  const userLocations = requestedLocation ? [requestedLocation] : (req.user?.assignedLocations || []);
  const inRange = (field: string) => dateRange ? { [field]: { $gte: dateRange.start, $lte: dateRange.end } } : {};

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
      // Both branches may read a transfer; shipping writes are restricted
      // separately. The receiving branch updates ETA/slabs through /receiving.
      { deliveryType: 'transfer', transferDestination: { $in: userLocations }, ...inRange('expectedArrivalDate') }
    ]
  };
};

// Writes to shipping fields belong to the sender. Inbound receipt edits have
// their own narrow route below; read scope remains shared by both branches.
const scopeShipmentWrites = (query: string, req: Request) => {
  const locations = req.user?.assignedLocations || [];
  if (locations.includes('*')) return query;
  return { $and: [query, { $or: [
    { location: { $in: [...locations, '', '*'] } },
    { location: { $exists: false } }, { location: null }
  ] }] };
};

// Whether this user is allowed to narrow their own view to one specific
// branch via the board's location filter (?location=). An admin can pick
// any real branch; everyone else can only narrow to a branch already inside
// their own assignedLocations. Explicitly rejects '*' from a non-admin —
// without this, scopeDeliveryQueryToLocations would treat a request for
// location='*' as if the caller actually held it, handing back every
// branch's deliveries to someone assigned to just one.
const userCanRequestLocation = (req: Request, requestedLocation: Loose) => {
  if (!requestedLocation) return true;
  const userLocations = req.user?.assignedLocations || [];
  if (userLocations.includes('*')) return true;
  return userLocations.includes(requestedLocation);
};

// ── Socket.IO room scoping ───────────────────────────────────────────────
// Socket.IO room name for a branch's delivery updates. A dedicated constant
// (rather than inlining the template literal everywhere) so the join side
// (server.ts's io.on('connection') handler) and the emit side below can't
// drift apart on the naming scheme.
const deliveryRoomFor = (location: string) => `delivery-location:${location}`;
// Sockets whose user holds '*' join this instead of every individual branch
// room, so an admin/director keeps seeing every location without the server
// having to know the full list of branches that currently exist.
const DELIVERY_ROOM_ALL = 'delivery-location:*';

// Which room(s) an update to this delivery needs to reach — mirrors
// scopeDeliveryQueryToLocations's read-side rule: a transfer belongs to both
// the shipping branch and the destination branch.
//
// A ticket with no branch (''/'*'/missing — many older ones) is readable by
// every branch (scopeDeliveryQueryToLocations lets '' and '*' through), so its
// updates go to every branch room currently open. `io` supplies that list:
// the server never has to know the full set of branches, only which rooms
// someone has joined.
const BRANCH_ROOM_PREFIX = 'delivery-location:';
const deliveryRoomsFor = (record: Loose, io = null) => {
  const rooms = [DELIVERY_ROOM_ALL];
  if (!record?.location || record.location === '*') {
    const open = io?.sockets?.adapter?.rooms;
    if (open) for (const name of open.keys()) if (name.startsWith(BRANCH_ROOM_PREFIX)) rooms.push(name);
  }
  if (record?.location && record.location !== '*') rooms.push(deliveryRoomFor(record.location));
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
// in server.ts before any request reaches this router, so it's always
// populated by the time a route handler needs it.
const emitDeliveryUpdate = (req: Request, payload: Loose, record: Loose) => {
  const io = req.app.get('io');
  if (!io) return;
  for (const room of new Set(deliveryRoomsFor(record, io))) {
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

// ── Stop numbers ──
// A run is one driver's tickets on one day: a cell of the board. Its saved
// routeNumbers are what the board, the Edit delivery form and the driver's
// phone all show, so every write that adds a ticket to a run, takes one out
// or deletes one closes the numbers back up to 1, 2, 3… (compactStopNumbers
// in src/utils/stopGrouping.ts) — a deleted Stop #2 used to leave 1, 3.
const RUN_FIELDS = 'id truckId date routeNumber deliveryType customerDropOff status';

/** The run a ticket was or is saved in, judged by its truck and day alone. */
const runOf = (d: Loose) => (d?.truckId && d?.date ? { truckId: d.truckId, date: d.date } : null);

/** What's on the board in a run: not cancelled, not a will call left pointing at the truck. */
const ticketsInRun = async ({ truckId, date }: { truckId: Loose; date: string }) =>
  (await Delivery.find({ truckId, date, status: { $ne: 'cancelled' } }, RUN_FIELDS).lean())
    .filter(d => columnIdFor(d) === truckId);

const writeStopNumbers = (changes: Loose[]) => Delivery.bulkWrite(
  changes.map((c: Loose) => ({ updateOne: { filter: { id: c.id }, update: { $set: { routeNumber: c.routeNumber } } } })),
  { ordered: false }
);

/** Closes up each run given (nulls and repeats skipped); returns the tickets it renumbered. */
async function renumberRuns(runs: Loose) {
  const seen = new Set();
  const changes = [];
  for (const run of runs) {
    if (!run?.truckId || !run?.date) continue;
    const key = `${run.truckId}||${run.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    changes.push(...compactStopNumbers(await ticketsInRun(run)));
  }
  if (!changes.length) return [];
  await writeStopNumbers(changes);
  return Delivery.find({ id: { $in: changes.map(c => c.id) } }, DELIVERY_LIST_PROJECTION).lean();
}

/**
 * Every run at once. Run at startup so numbers saved before the rule above
 * (gaps from old deletes and moves) are closed up too; once they are, it
 * finds nothing to change. Returns how many tickets it renumbered.
 */
export async function renumberAllRuns() {
  const tickets = await Delivery.find(
    { truckId: { $nin: ['', null] }, date: { $nin: ['', null] }, status: { $ne: 'cancelled' } },
    RUN_FIELDS
  ).lean();
  const runs = new Map();
  for (const d of tickets) {
    if (columnIdFor(d) !== d.truckId) continue;
    const key = `${d.truckId}||${d.date}`;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(d);
  }
  const changes = [...runs.values()].flatMap(compactStopNumbers);
  if (changes.length) await writeStopNumbers(changes);
  return changes.length;
}

// Order search only needs enough to say when/where an order is and to open
// it — the full ticket is fetched by id once someone actually picks one.
const SEARCH_RESULT_PROJECTION = {
  _id: 0, id: 1, date: 1, time: 1, status: 1, deliveryType: 1, customerDropOff: 1,
  customerName: 1, address: 1, soNumber: 1, invoiceNumber: 1, truckId: 1, driver: 1,
  location: 1, transferDestination: 1, expectedArrivalDate: 1, receivedAt: 1,
  'pod.verified': 1, 'pod.signedAt': 1, 'pod.signedPdfUrl': 1
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
const isPdfBuffer = (buffer: Loose) => Buffer.isBuffer(buffer) && buffer.length >= PDF_MAGIC.length
  && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);

export default function createDeliveriesRouter({
  authenticate,
  requirePermission,
  requireAnyPermission,
  getPerformerInfo,
  processBase64Images,
  getNowLocalISO
}: { authenticate: RequestHandler; requirePermission: (permission: string) => RequestHandler; requireAnyPermission: (...permissions: string[]) => RequestHandler; getPerformerInfo: Loose; processBase64Images: Loose; getNowLocalISO: Loose }) {
  const router = express.Router();

  // ── Delivery schedule authorisation ────────────────────────────────────
  // Guard levels are chosen against the live role config, not the seed
  // defaults:
  //   view_delivery_schedule   — held by all six staff roles
  //   edit_delivery_schedule   — all staff EXCEPT driver
  //   delete_delivery_schedule — admin / director / manager only
  //
  // Drivers (delivery_driver_view) lack edit_delivery_schedule but legitimately
  // capture an ePOD (via the same upsert endpoint as a full edit) and PATCH a
  // stop's status, so those two routes accept either (canWriteDeliveries).
  // view_delivery_schedule alone is NOT enough (it was until 2026-10-15, so any
  // read-only login could create or rewrite tickets by calling the API): and on
  // the upsert a driver may only write the ePOD and completion of a ticket that
  // exists — everything else in the body is dropped (see POST /deliveries).
  // Reassignment, reordering and uploading a packing list are dispatcher/office
  // actions a driver's app never calls — those require edit_delivery_schedule
  // outright (canManageDeliverySchedule), so a role an admin deliberately
  // configures as view-only in Users & Roles can no longer mutate/reassign/
  // reorder the board via a direct API call just because the UI happens to
  // hide the buttons for it.
  //
  // Deletion is the exception: it requires delete_delivery_schedule outright,
  // so who can remove a delivery is controlled purely by role config in
  // Users & Roles → Delivery Schedule → Delete.
  const canViewDeliveries = requirePermission('view_delivery_schedule');
  const canWriteDeliveries = requireAnyPermission(DELIVERY_PERMISSIONS.EDIT, DELIVERY_PERMISSIONS.DRIVER_VIEW);
  const canManageDeliverySchedule = requirePermission('edit_delivery_schedule');
  const canDeleteDeliveries = requirePermission('delete_delivery_schedule');
  // Deliberately separate from deletion: a dispatcher who should never remove a
  // job may still need to void a proof the wrong customer signed, and the reverse
  // holds too.
  const canClearPod = requirePermission('clear_pod_signatures');

  // Renumbers the runs a write touched (see renumberRuns) and tells open
  // boards about every ticket that moved, except `selfId`: the caller sends
  // that one itself, with the number this returns. A failure here is logged,
  // not returned — the save it follows has already happened.
  const renumberAfter = async (req: Request, runs: Loose, selfId: Loose) => {
    try {
      const moved = await renumberRuns(runs);
      for (const delivery of moved) {
        if (delivery.id !== selfId) emitDeliveryUpdate(req, { type: 'upsert', delivery }, delivery);
      }
      return moved;
    } catch (err) {
      console.error('[server] renumber stops error:', err);
      return [];
    }
  };
  const withNumberFrom = (record: Loose, moved: Loose) => {
    const fixed = moved.find((d: Loose) => d.id === record.id);
    return fixed ? { ...record, routeNumber: fixed.routeNumber } : record;
  };

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

  // ── Column order per branch (src/utils/deliveryColumns.ts) ──────────────
  // Everyone who sees the board reads every branch's order ({ Seattle: [...] });
  // setting one needs Arrange Driver Columns (arrange_delivery_columns, Users &
  // Roles → Delivery Schedule) and the branch among the person's own locations. An
  // empty list puts the branch back on the default order. Open boards hear
  // `delivery_columns_update` and read the list again — the event carries only
  // the branch name, so it says nothing to a socket that can't read the board.
  router.get('/delivery-columns', authenticate, canViewDeliveries, async (req, res) => {
    try {
      const locations = await Location.find({}, { name: 1, deliveryColumns: 1 }).lean();
      res.json(Object.fromEntries(locations.map((l) => [l.name, l.deliveryColumns || []])));
    } catch {
      res.status(500).json({ error: 'Failed to load the column order' });
    }
  });

  router.put('/delivery-columns/:location', authenticate, canViewDeliveries, requirePermission(DELIVERY_PERMISSIONS.ARRANGE_COLUMNS), async (req, res) => {
    try {
      if (!userCanRequestLocation(req, req.params.location)) {
        return res.status(403).json({ error: 'You can only arrange the columns for your own locations.' });
      }
      const columns = cleanColumnOrder(req.body?.columns);
      if (!columns) return res.status(400).json({ error: 'columns must be a list of column ids' });
      const location = await Location.findOneAndUpdate(
        { name: req.params.location },
        { $set: { deliveryColumns: columns } },
        { new: true, projection: { name: 1, deliveryColumns: 1 } }
      ).lean();
      if (!location) return res.status(404).json({ error: 'Location not found' });
      req.app.get('io')?.emit('delivery_columns_update', { location: location.name });
      res.json({ location: location.name, columns: location.deliveryColumns });
    } catch {
      res.status(500).json({ error: 'Failed to save the column order' });
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
      // returns those; a week request returns the assigned ones only; and
      // ?cancelled=true returns whichever of either kind someone has cancelled.
      // All three exclude each other's status/placement so nothing is stranded
      // between them or counted twice — see the "Cancelled takes priority"
      // note in src/utils/deliveryTypes.ts.
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
      // the drop-off side; see isCounterReturn in src/utils/deliveryTypes.ts.
      //
      // These three branches are complements and have to stay that way: the JS
      // side of the same rule is isPendingDelivery/columnIdFor in
      // src/utils/deliveryTypes.ts, which has tests asserting every ticket
      // lands in exactly one view. A ticket that matches none of the three
      // queries is not an error anywhere — it just stops existing as far as
      // the app is concerned.
      // ?location= lets a user who can already reach more than one branch (an
      // admin, or someone with several assignedLocations) narrow the board to
      // just one at a time instead of every branch they can see mashed
      // together — see the location selector in src/features/delivery/DeliveryScheduleTab.tsx.
      const { startDate, endDate, pending, cancelled, location: requestedLocation } = req.query;
      if (requestedLocation && !userCanRequestLocation(req, requestedLocation)) {
        return res.status(403).json({ error: 'You do not have access to that location' });
      }
      let baseQuery;
      if (cancelled === 'true') {
        // Cancelled overrides everything else about a ticket's placement — it
        // keeps whatever truckId/date it had (so it can be restored by
        // dragging it back out), but while status is 'cancelled' it belongs
        // here regardless of what those other fields say.
        baseQuery = { status: 'cancelled' };
      } else if (pending === 'true') {
        // $in rather than $or: the location scoping below contributes its own $or,
        // and a second one on the same object would replace this filter outright.
        // { $in: ['', null] } also matches documents with no truckId field at all.
        // $nor (not a second $or) carves out the dated drop-offs for the same
        // reason.
        baseQuery = {
          truckId: { $in: ['', null] },
          deliveryType: { $ne: 'will_call' },
          status: { $ne: 'cancelled' },
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
          $and: [
            {
              $or: [
                { truckId: { $nin: ['', null] } },
                { deliveryType: 'will_call' },
                { deliveryType: 'return', customerDropOff: true }
              ]
            },
            { status: { $ne: 'cancelled' } }
          ]
        };
      } else {
        baseQuery = {};
      }
      const dateRange = (startDate && endDate) ? { start: startDate, end: endDate } : undefined;
      const query = scopeDeliveryQueryToLocations(baseQuery, req, dateRange, requestedLocation);
      // The week view is already bounded by startDate/endDate — only Pending
      // and Cancelled are genuinely unbounded (every branch's undated/
      // unassigned or cancelled orders, with no date range to narrow them).
      // Both should stay small in practice — a ticket only sits in either
      // until someone acts on it — but nothing enforces that, so a stuck
      // integration or a quiet week of dispatching could grow one
      // indefinitely. Oldest-first with a cap: if the cap is ever actually
      // hit, that's a real operational problem (a backlog nobody is working
      // through) worth surfacing rather than masking by quietly returning
      // more each time it's asked.
      const UNBOUNDED_LIST_CAP = 500;
      const list = (pending === 'true' || cancelled === 'true')
        ? await Delivery.find(query, DELIVERY_LIST_PROJECTION).sort({ createdAt: 1 }).limit(UNBOUNDED_LIST_CAP).lean()
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
      const inWeek = (d: Loose) => Boolean(d && startDate && endDate && d >= startDate && d <= endDate);
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
              return d.expectedArrivalDate ? showOnArrivalDay(d, 'destination') : d;
            }
            // Origin (or admin, or an unowned ticket): the ship date is what's
            // shown normally. Falls back to the arrival date only when the
            // ship date itself isn't actually in the displayed week — an
            // admin browsing the week it's due, not the week it left.
            if (inWeek(d.date)) return d;
            if (inWeek(d.expectedArrivalDate)) return showOnArrivalDay(d, 'origin');
            return d;
          })
        : list;

      res.json(shaped.map(d => isReceivingTransfer(req.user, d) ? { ...d, receivingOnly: true } : d));
    } catch (err) {
      console.error('[server] get deliveries error:', err);
      res.status(500).json({ error: 'Server error fetching deliveries' });
    }
  });

  // "Find an order" — SO#/invoice # or company name, across every date, so
  // someone can see when an order was delivered or when it's booked without
  // paging week by week. Must be registered before /deliveries/:id, or
  // Express reads "search" as a ticket id.
  //
  // Drivers are refused (they only work their own stops), and results are
  // limited to the user's own assignedLocations — stricter than the board,
  // which also shows unowned tickets. The rules live in
  // src/utils/deliverySearch.ts, shared with the search box.
  router.get('/deliveries/search', authenticate, canViewDeliveries, async (req, res) => {
    try {
      // Drivers (Users & Roles → Delivery Schedule → Driver view) don't search.
      if (isDeliveryDriver(req.user)) {
        return res.status(403).json({ error: 'Order search is not available for drivers' });
      }
      const filter = buildDeliverySearchFilter(req.query.q, req.user?.assignedLocations);
      if (!filter) return res.json({ results: [], total: 0, more: false });

      // One extra row tells us whether there are more than SEARCH_SCAN_LIMIT
      // matches without paying for a separate count query.
      const matches = await Delivery.find(filter, SEARCH_RESULT_PROJECTION)
        .sort({ date: -1 })
        .limit(SEARCH_SCAN_LIMIT + 1)
        .lean();
      const sorted = sortSearchResults(matches.slice(0, SEARCH_SCAN_LIMIT));
      res.json({
        results: sorted.slice(0, SEARCH_RESULT_LIMIT),
        total: sorted.length,
        more: matches.length > SEARCH_SCAN_LIMIT
      });
    } catch (err) {
      console.error('[server] delivery search error:', err);
      res.status(500).json({ error: 'Server error searching deliveries' });
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

  const saveDeliveryRoute = async (req: Request, res: Response) => {
    try {
      let delivery = req.body;
      if (!delivery || !delivery.id) return res.status(400).json({ error: 'Invalid delivery data' });

      // This route upserts by id, so it's the one write path every create AND
      // edit goes through.
      const existing = await Delivery.findOne(
        { id: delivery.id },
        'location deliveryType transferDestination pod packingListUrl packingListFilename truckId date expectedArrivalDate customerDropOff status routeNumber'
      ).lean();

      // Editing a record that already exists: its CURRENT location has to be
      // one this user can reach.
      if (existing && !canManageShipment(req.user, existing)) {
        return res.status(403).json({ error: 'You do not have access to this delivery' });
      }
      // A driver's login gets the ePOD capture and nothing else: no new
      // tickets, and of an existing one only the proof and "completed" are
      // written, however much of the ticket the phone sent back. (The office,
      // holding edit_delivery_schedule, gets the whole upsert as before.)
      const isEditor = (req.user?.permissions || []).includes(DELIVERY_PERMISSIONS.EDIT);
      // PATCH /deliveries/:id/pod (below) is the same narrow write for anyone:
      // the office's ePOD save used to send the board's cached copy of the
      // whole ticket through this upsert, undoing edits made meanwhile.
      if (req.podOnly || !isEditor) {
        if (!existing) {
          return req.podOnly
            ? res.status(404).json({ error: 'Delivery not found' })
            : res.status(403).json({ error: 'Drivers can only sign for an existing delivery.' });
        }
        if (!delivery.pod || typeof delivery.pod !== 'object') {
          return res.status(req.podOnly ? 400 : 403).json({ error: 'Drivers can only save a delivery\'s ePOD.' });
        }
        delivery = { id: delivery.id, pod: delivery.pod, status: 'completed' };
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
      if (!canManageShipment(req.user, resultingLocation)) {
        return res.status(403).json({ error: 'You do not have access to that location' });
      }

      const updateData = { ...delivery };
      delete updateData._id;

      // The modal already fills this in, but any other writer (an older client,
      // a script) gets the same rule, so no transfer is ever stored without an
      // arrival date its destination branch can see it by.
      // Judged on the record as it will stand after this write (body merged
      // over what's stored), so a partial update can't slip past the checks
      // or blank a stored arrival just by leaving those fields out.
      if (resultingLocation.deliveryType === 'transfer') {
        // Same checks the modal makes before saving. Enforced here too because
        // tickets with no origin, or with origin = destination, got in anyway
        // and couldn't be told apart from real transfers on either branch.
        if (!resultingLocation.location || !resultingLocation.transferDestination) {
          return res.status(400).json({ error: 'A transfer needs both a From and a To branch.' });
        }
        if (resultingLocation.location === resultingLocation.transferDestination) {
          return res.status(400).json({ error: 'Transfer From and Transfer To can’t be the same branch.' });
        }
        updateData.expectedArrivalDate = transferArrivalFor({
          date: updateData.date !== undefined ? updateData.date : existing?.date,
          expectedArrivalDate: updateData.expectedArrivalDate !== undefined
            ? updateData.expectedArrivalDate
            : existing?.expectedArrivalDate
        });
      }

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

      const saved = await Delivery.findOneAndUpdate(
        { id: delivery.id },
        { $set: updateData },
        { upsert: true, new: true }
      ).lean();
      // The run it left (if it moved) and the one it's in now.
      const updated = withNumberFrom(saved, await renumberAfter(req, [runOf(existing), runOf(saved)], saved.id));

      // Broadcast just the single changed record — not the whole collection. Clients
      // merge it into whichever cached week(s) it belongs to.
      emitDeliveryUpdate(req, { type: 'upsert', delivery: updated }, updated);
      deliveriesChanged([updated.id]);
      res.json(updated);
    } catch (err) {
      console.error('[server] save delivery error:', err);
      res.status(500).json({ error: 'Server error saving delivery' });
    }
  };

  router.post('/deliveries', authenticate, canWriteDeliveries, saveDeliveryRoute);
  // Saves one delivery's ePOD and marks it completed, and writes nothing else —
  // the same narrowing a driver's save gets on POST, for the office too.
  router.patch('/deliveries/:id/pod', authenticate, canWriteDeliveries, (req, res) => {
    req.podOnly = true;
    req.body = { id: req.params.id, pod: req.body?.pod };
    return saveDeliveryRoute(req, res);
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
  const DELIVERY_STATUSES = ['pending', 'scheduled', 'completed', 'delayed', 'cancelled'];

  // Receiving branches may change only the expected delivery date and slab count.
  router.patch('/deliveries/:id/receiving', authenticate, canManageDeliverySchedule, async (req, res) => {
    try {
      const fields = req.body || {};
      const keys = Object.keys(fields);
      if (!keys.length || keys.some(key => !['expectedArrivalDate', 'numberOfSlabs'].includes(key))) {
        return res.status(400).json({ error: 'Only expected delivery date and slab count can be changed here.' });
      }
      const delivery = await Delivery.findOne(scopeDeliveryQueryToLocations({ id: req.params.id, deliveryType: 'transfer' }, req)).lean();
      if (!delivery) return res.status(404).json({ error: 'Transfer not found' });
      const changes: Loose = {};
      if (fields.expectedArrivalDate !== undefined) {
        const date = normalizeVisitDate(fields.expectedArrivalDate);
        if (!date || (delivery.date && date < delivery.date)) return res.status(400).json({ error: 'Expected delivery must be a real date on or after the ship date.' });
        changes.expectedArrivalDate = date;
      }
      if (fields.numberOfSlabs !== undefined) {
        const value = fields.numberOfSlabs;
        if (!['number', 'string'].includes(typeof value) || value === null || String(value).trim() === '' || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
          return res.status(400).json({ error: 'Slab count must be a whole number of zero or more.' });
        }
        changes.numberOfSlabs = Number(value);
      }
      const updated = await Delivery.findOneAndUpdate({ _id: delivery._id, location: delivery.location, transferDestination: delivery.transferDestination },
        { $set: changes }, { new: true, projection: DELIVERY_LIST_PROJECTION }).lean();
      if (!updated) return res.status(409).json({ error: 'The transfer changed; refresh and try again.' });
      emitDeliveryUpdate(req, { type: 'upsert', delivery: updated }, updated);
      deliveriesChanged([updated.id]);
      res.json(updated);
    } catch (error) {
      console.error('Receiving transfer update failed:', error);
      res.status(500).json({ error: 'Could not update the incoming transfer.' });
    }
  });

  router.patch('/deliveries/:id/status', authenticate, canWriteDeliveries, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body || {};

      if (!DELIVERY_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${DELIVERY_STATUSES.join(', ')}` });
      }

      const saved = await Delivery.findOneAndUpdate(
        scopeShipmentWrites({ id }, req),
        { $set: { status } },
        { new: true, projection: DELIVERY_LIST_PROJECTION }
      ).lean();

      if (!saved) return res.status(404).json({ error: 'Delivery not found' });
      // Cancelling takes it out of its run, so the stops after it move up.
      const updated = withNumberFrom(saved, await renumberAfter(req, [runOf(saved)], saved.id));

      // Completion is not proof. Marking a stop delivered says the material got
      // there; pod.verified stays whatever the signatures make it, so a card can
      // still honestly read "No ePOD" on a completed stop.
      emitDeliveryUpdate(req, { type: 'upsert', delivery: updated }, updated);
      deliveriesChanged([updated.id]);

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
      // src/utils/deliveryTypes.ts) — coerced to a plain boolean here so an
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
      // A ticket landing in Pending is allowed to have no date — that's a
      // normal state for Pending (waiting on an ETA from the customer), and
      // restoring a cancelled-while-dateless order back onto Pending has to
      // reach it. Everything else (a real truck column, or Will Call, which
      // forces truckId to '' above without being Pending) still needs one, so
      // it has somewhere on the calendar to actually render. Reuses
      // isPendingDelivery rather than re-deriving "is this Pending" from
      // truckId alone, so this can't quietly drift from that definition.
      const landingInPending = isPendingDelivery({ truckId, deliveryType, customerDropOff, date });
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '');
      if (!validDate && !(landingInPending && !date)) {
        return res.status(400).json({
          error: landingInPending ? 'date must be empty or a YYYY-MM-DD string' : 'date must be a YYYY-MM-DD string'
        });
      }

      // A cancelled ticket dragged onto a truck cell or back into Pending is
      // being restored — this is the one place that happens, so it's the one
      // place that has to clear it. defaultStatusFor is given only the new
      // placement (no old status), so it always recomputes a fresh
      // pending/scheduled rather than reusing 'cancelled'. Every other
      // starting status is left exactly as this endpoint has always left it.
      const existing = await Delivery.findOne(
        scopeShipmentWrites({ id }, req),
        { status: 1, expectedArrivalDate: 1, truckId: 1, date: 1 }
      ).lean();
      if (!existing) return res.status(404).json({ error: 'Delivery not found' });
      const statusUpdate = existing.status === 'cancelled'
        ? { status: defaultStatusFor({ truckId, deliveryType, customerDropOff, date }) }
        : {};
      // A Pending transfer dragged onto a truck gets its ship date here, not in
      // the modal, so it needs the same arrival default POST applies — and a
      // transfer dragged past its arrival day carries the arrival along.
      const arrivalUpdate = deliveryType === 'transfer'
        ? { expectedArrivalDate: transferArrivalFor({ date, expectedArrivalDate: existing.expectedArrivalDate }) }
        : {};

      // Landing on a different driver or day: it joins the end of that run
      // rather than keeping the number it had (a Stop #1 arriving would share
      // the stop already called #1). A drop onto a card then sends the exact
      // place as a reorder.
      // A cancelled ticket was out of its run, so restoring it is joining one.
      const oldRun = existing.status === 'cancelled' ? null : runOf(existing);
      const newRun = deliveryType === 'will_call' ? null : runOf({ truckId, date });
      const movedRuns = newRun && (!oldRun || oldRun.truckId !== newRun.truckId || oldRun.date !== newRun.date);
      const stopUpdate = movedRuns
        ? { routeNumber: nextStopNumber((await ticketsInRun(newRun)).filter(d => d.id !== id)) }
        : {};

      const saved = await Delivery.findOneAndUpdate(
        scopeShipmentWrites({ id }, req),
        { $set: { truckId, deliveryType, date, customerDropOff, ...statusUpdate, ...arrivalUpdate, ...stopUpdate } },
        { new: true, projection: DELIVERY_LIST_PROJECTION }
      ).lean();

      if (!saved) return res.status(404).json({ error: 'Delivery not found' });
      const updated = withNumberFrom(saved, await renumberAfter(req, [oldRun, runOf(saved)], saved.id));

      emitDeliveryUpdate(req, { type: 'upsert', delivery: updated }, updated);
      deliveriesChanged([updated.id]);

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
        scopeShipmentWrites({ id: { $in: ids } }, req), 'id truckId date deliveryType customerDropOff status'
      ).lean();
      const writableById = new Map(writable.map(d => [d.id, d]));
      const applicable = clean.filter(u => writableById.has(u.id));
      if (!applicable.length) return res.status(404).json({ error: 'None of those deliveries were found' });

      // Conflict check: a reorder resubmits a whole cell's order at once (see
      // comment above), so if some OTHER ticket on the same board cell — one
      // this request doesn't even know about — already holds one of the route
      // numbers being assigned, the client's view of that cell was stale
      // (someone else changed it after this board loaded, or a second reorder
      // of the same cell is racing this one). Applying it anyway would
      // silently create two stops both numbered the same. This isn't full
      // optimistic-concurrency (no version field on the model), but it catches
      // the actual failure mode — duplicate route numbers from a race — cheaply.
      //
      // Only tickets the board draws in that cell count (isOnBoardCell): not
      // cancelled ones, not a will call left pointing at the truck or a dated
      // Pending order sharing the '' key, and not other branches' tickets this
      // user can't see. Counting those made some cells refuse every reorder.
      const cellKeyOf = (d: Loose) => `${columnIdFor(d)}||${d.date || ''}`;
      const cellRouteNumbers = new Map(); // "columnId||date" -> Set(routeNumber)
      for (const u of applicable) {
        const rec = writableById.get(u.id);
        const cellKey = cellKeyOf(rec);
        if (!cellRouteNumbers.has(cellKey)) cellRouteNumbers.set(cellKey, new Set());
        cellRouteNumbers.get(cellKey).add(u.routeNumber);
      }
      const applicableIds = new Set(applicable.map(u => u.id));
      const cellFilters = [...new Set(applicable.map(u => {
        const rec = writableById.get(u.id);
        return `${rec.truckId || ''}||${rec.date || ''}`;
      }))].map(key => {
        const [truckId, date] = key.split('||');
        return { truckId, date };
      });
      const siblings = (await Delivery.find(
        // $and: the location scoping owns the top-level $or.
        scopeDeliveryQueryToLocations({ $and: [{ $or: cellFilters }], id: { $nin: [...applicableIds] }, status: { $ne: 'cancelled' } }, req),
        'id truckId date routeNumber deliveryType customerDropOff status'
      ).lean()).filter(d => cellRouteNumbers.has(cellKeyOf(d)));
      for (const sibling of siblings) {
        if (cellRouteNumbers.get(cellKeyOf(sibling))?.has(Number(sibling.routeNumber) || 1)) {
          return res.status(409).json({
            error: "This run changed since you loaded it — refresh and try reordering again."
          });
        }
      }

      await Delivery.bulkWrite(applicable.map(u => ({
        updateOne: { filter: { id: u.id }, update: { $set: { routeNumber: u.routeNumber } } }
      })));

      // A reorder sent from a searched board covers only the cards on show,
      // which can leave a gap among the rest.
      const reordered = await Delivery.find(
        { id: { $in: applicable.map(u => u.id) } }, DELIVERY_LIST_PROJECTION
      ).lean();
      const reorderedIds = new Set(reordered.map(d => d.id));
      const moved = await renumberRuns(cellFilters).catch((err) => {
        console.error('[server] renumber stops error:', err);
        return [];
      });
      const updated = [
        ...reordered.map(d => withNumberFrom(d, moved)),
        ...moved.filter(d => !reorderedIds.has(d.id))
      ];

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
  // it's opened (see deriveFromSystem in src/routes/dailyReports.ts).
  //
  // Deliberately not scoped with scopeDeliveryQueryToLocations — that checks
  // `location`, the origin branch, which is the wrong side of this ticket for
  // this action. Only someone assigned to transferDestination (or an admin
  // with '*') may confirm receipt.
  router.patch('/deliveries/:id/receive', authenticate, canManageDeliverySchedule, async (req, res) => {
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
      const deleted = await Delivery.findOneAndDelete(scopeShipmentWrites({ id }, req));
      if (!deleted) {
        return res.status(404).json({ error: 'Delivery not found' });
      }
      emitDeliveryUpdate(req, { type: 'delete', id }, deleted);
      deliveriesChanged([id]);
      await renumberAfter(req, [runOf(deleted)]);
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

      const delivery = await Delivery.findOne(scopeShipmentWrites({ id }, req));
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
        const deliveryId = req.body?.deliveryId ? String(req.body.deliveryId) : '';
        // The stored file is keyed on the delivery id and overwritten, so an
        // id belonging to a ticket at a branch this user can't reach must not
        // be accepted — it would replace that branch's packing list. A ticket
        // that doesn't exist yet (the form's own new id) is fine.
        if (deliveryId) {
          const owner = await Delivery.findOne(
            { id: deliveryId }, 'location deliveryType transferDestination'
          ).lean();
          if (owner && !canManageShipment(req.user, owner)) {
            return res.status(403).json({ error: 'You do not have access to that delivery.' });
          }
        }
        const key = deliveryId
          ? podAssetIds(deliveryId).packingList
          : `deliveries/packing_lists/tmp_${Date.now()}_${Math.round(Math.random() * 1e4)}`;

        // Read the order details back out of it so the form can fill itself
        // in (see planPackingListAutofill). Best-effort: a PDF that isn't a
        // StoneProfits packing list, or one pdf.js can't read, still uploads.
        // Runs alongside storing the file rather than after it, and gives up
        // after READ_LIMIT_MS — a slow or huge PDF then just uploads without
        // the auto-fill instead of holding the form's "Attaching PDF…".
        const READ_LIMIT_MS = 4000;
        let giveUp;
        const readText = Promise.race([
          extractPdfTextItems(req.file.buffer, { deadline: Date.now() + READ_LIMIT_MS })
            .then((items) => {
              const parsed = parsePackingList(itemsToLines(items));
              return looksLikePackingList(parsed) ? parsed : null;
            }),
          new Promise((resolve) => { giveUp = setTimeout(() => resolve(null), READ_LIMIT_MS); })
        ])
          .catch((parseErr) => {
            console.warn('[deliveries] could not read packing list text:', parseErr.message);
            return null;
          })
          .finally(() => clearTimeout(giveUp));

        const [stored, packingList] = await Promise.all([
          storeDeliveryPdf(
            req.file.buffer,
            key,
            `packing_list_${safeIdSegment(deliveryId || Date.now())}.pdf`
          ),
          readText
        ]);

        res.json({
          success: true,
          url: stored.url,
          publicId: stored.publicId,
          filename: req.file.originalname,
          packingList
        });
      } catch (err) {
        console.error('Error uploading packing list PDF:', err);
        res.status(500).json({ error: 'Failed to upload packing list PDF' });
      }
    }
  );

  return router;
}

// Exported for the socket-room join handler in server.ts, which needs the
// same room-naming scheme this router's emitDeliveryUpdate uses — see the
// comment on deliveryRoomFor above for why they have to stay in sync.
export { deliveryRoomFor, deliveryRoomsFor, DELIVERY_ROOM_ALL };
