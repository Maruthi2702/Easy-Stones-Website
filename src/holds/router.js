/**
 * Cart & Holds API (2026-10-10) — mounted at /api/holds.
 *
 *   app.use('/api/holds', createHoldsRouter({ authenticate }));
 *
 * Cart:  GET /cart · POST /cart/slabs · POST /cart/scan · PATCH /cart/customer
 *        PATCH /cart/slabs/:slabKey (note) · DELETE /cart/slabs/:slabKey · DELETE /cart
 * Slabs: POST /slabs/status — locks and carts for the inventory screen
 * Holds: GET /meta · GET / · GET /:id · GET /:id/pdf · POST /
 *        PATCH /:id/details · POST /:id/slabs · POST /:id/swap · PATCH /:id/prices
 *        POST /:id/extend · POST /:id/release
 *
 * Every route checks its own Users & Roles permission; a hold the person
 * can't see answers 404. A slab can be on one active hold only — the unique
 * index on SlabReservation.slabKey guarantees it, inside the same transaction
 * that writes the hold and its history. Every change is broadcast as
 * 'slab_reservations_changed' so open inventory screens and carts update.
 */
import express from 'express';
import mongoose from 'mongoose';
import InventoryItem from '../models/InventoryItem.js';
import Customer from '../models/Customer.js';
import Location from '../models/Location.js';
import { letterheadFor } from '../utils/locationForm.js';
import { companyOf, contactOf, realEmailsOf } from '../utils/customerList.js';
import { homeLocationOf } from '../utils/locationFilter.js';
import { BRANCH_NAMES } from '../config/branches.js';
import {
  HttpError, handle, requireAll, requireAny, parse, inTransaction, checkVersion, actorOf, escapeRegex
} from '../server/http.js';
import { CART, HOLDS, HOLD_VIEW_PERMISSIONS, can } from './permissions.js';
import { Cart, Hold, SlabReservation, HoldHistory, nextNumber } from './models.js';
import {
  slabKeyOf, isHoldableSlab, slabSnapshot, holdTotals, holdState, daysToExpiry, defaultExpiresOn,
  expiryMoments, expiryProblem, branchProblem, holdScopesFor, canSeeHold, scopeClause, formatDay, formatMoney,
  MAX_CART_SLABS, MAX_HOLD_SLABS
} from './holdRules.js';
import { buildHoldPdf, holdPdfFileName } from './holdPdf.js';
import { parseHide } from './holdLetter.js';
import * as S from './schemas.js';

const LABEL = 'holds';
const DAY_MS = 86400000;

// ── Slabs ────────────────────────────────────────────────────────────────

const SLAB_FIELDS = 'type serialNumber barcodeId product category bundle slabNumber block bin location dimensions instockQty slabStatus';

/** Slabs by key. Most serials are stored exactly as their key; the rest are matched normalised. */
async function findSlabs(keys) {
  const wanted = [...new Set(keys.map(slabKeyOf).filter(Boolean))];
  if (!wanted.length) return new Map();
  const found = new Map();
  for (const item of await InventoryItem.find({ serialNumber: { $in: wanted } }, SLAB_FIELDS).lean()) {
    found.set(slabKeyOf(item.serialNumber), item);
  }
  const missing = wanted.filter((k) => !found.has(k));
  if (missing.length) {
    const rest = await InventoryItem.aggregate([
      { $addFields: { _key: { $toUpper: { $trim: { input: { $ifNull: ['$serialNumber', ''] } } } } } },
      { $match: { _key: { $in: missing } } },
      { $project: { _key: 0 } }
    ]);
    for (const item of rest) found.set(slabKeyOf(item.serialNumber), item);
  }
  return found;
}

/** The one slab a scanned barcode or typed serial # points at. */
async function findByCode(code) {
  const value = String(code || '').trim();
  const byBarcode = await InventoryItem.findOne({ barcodeId: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } }, SLAB_FIELDS).lean();
  if (byBarcode) return byBarcode;
  return (await findSlabs([value])).get(slabKeyOf(value)) || null;
}

const reservationsFor = async (keys, session = null) => {
  const q = SlabReservation.find({ slabKey: { $in: keys } }).lean();
  if (session) q.session(session);
  return new Map((await q).map((r) => [r.slabKey, r]));
};

const announce = (req, slabKeys) => {
  const keys = [...new Set(slabKeys)].filter(Boolean);
  if (keys.length) req.app.get('io')?.emit('slab_reservations_changed', { slabKeys: keys });
};

const lockedReason = (r) => `On Hold #${r.holdNumber}${r.by?.name ? ` (${r.by.name})` : ''}`;

// ── Customers ────────────────────────────────────────────────────────────

async function customerSnapshot(customerId, session = null) {
  const q = Customer.findById(customerId).lean();
  if (session) q.session(session);
  const c = await q;
  if (!c) throw new HttpError(400, 'That customer doesn’t exist.');
  const a = c.address || {};
  const cityLine = [a.city, [a.state, a.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {
    id: String(c._id),
    name: companyOf(c),
    contact: contactOf(c),
    phone: String(c.phone || ''),
    email: realEmailsOf(c)[0] || '',
    address: [a.street, cityLine].filter(Boolean).join('\n')
  };
}

// ── Holds ────────────────────────────────────────────────────────────────

const historyEntry = (hold, action, by, extra = {}) => ({ holdId: hold._id, holdNumber: hold.number, action, by, ...extra });
const writeHistory = (session, entries) => HoldHistory.create(entries, { session, ordered: true });

/** The hold, if it exists and this person may see it — otherwise 404. */
async function holdFor(req, id, session = null) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Hold not found.');
  const q = Hold.findById(id);
  if (session) q.session(session);
  const hold = await q;
  if (!hold || !canSeeHold(req.user, hold)) throw new HttpError(404, 'Hold not found.');
  return hold;
}

/** Released and converted holds are final. Expired ones still hold their slabs and can change. */
const mustBeOpen = (hold) => {
  if (hold.status !== 'active') throw new HttpError(400, `Hold #${hold.number} is ${hold.status} — it can’t be changed.`);
};

const present = (hold, now = new Date()) => {
  const h = hold.toObject ? hold.toObject() : hold;
  return {
    ...h,
    version: h.__v,
    state: holdState(h, now),
    daysToExpiry: daysToExpiry(h, now),
    totals: holdTotals(h.lines)
  };
};

const listRow = (h, now) => {
  const products = new Map();
  for (const l of h.lines) products.set(l.product, (products.get(l.product) || 0) + 1);
  return {
    _id: h._id, number: h.number, version: h.__v, status: h.status, state: holdState(h, now),
    branch: h.branch, customer: { id: h.customer?.id, name: h.customer?.name }, job: h.job,
    createdBy: h.createdBy, createdAt: h.createdAt, expiresOn: h.expiresOn, expiresAt: h.expiresAt,
    releaseAt: h.releaseAt, daysToExpiry: daysToExpiry(h, now), totals: holdTotals(h.lines),
    products: [...products].map(([product, slabs]) => ({ product, slabs })),
    slabKeys: h.slabKeys
  };
};

/** Lock every slab of `lines` for `hold`; a clash names the slab and the hold that has it. */
async function lockSlabs(hold, lines, by, session) {
  if (!lines.length) return;
  try {
    await SlabReservation.insertMany(lines.map((l) => ({
      slabKey: l.slabKey, holdId: hold._id, holdNumber: hold.number, customerName: hold.customer?.name || '',
      branch: hold.branch, by, expiresOn: hold.expiresOn
    })), { session, ordered: true });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const taken = await SlabReservation.find({ slabKey: { $in: lines.map((l) => l.slabKey) } }).lean();
    const other = taken.find((r) => String(r.holdId) !== String(hold._id));
    throw new HttpError(409, other ? `${other.slabKey} was just put on Hold #${other.holdNumber}. Remove it and try again.` : 'One of these slabs was just held by someone else.', { taken: taken.map((r) => r.slabKey) });
  }
}

const unlockSlabs = (holdId, slabKeys, session) => SlabReservation.deleteMany({ holdId, slabKey: { $in: slabKeys } }, { session });

/** Check new slabs before they go on a hold: in stock, whole slabs, not held elsewhere. */
async function holdableLines(requested, holdId = null) {
  const slabs = await findSlabs(requested.map((l) => l.slabKey));
  const locks = await reservationsFor(requested.map((l) => l.slabKey));
  return requested.map((l) => {
    const item = slabs.get(l.slabKey);
    if (!item) throw new HttpError(400, `${l.slabKey} isn’t in stock any more.`);
    if (!isHoldableSlab(item)) throw new HttpError(400, `${l.slabKey} isn’t a whole slab — only slabs can be held.`);
    const lock = locks.get(l.slabKey);
    if (lock && String(lock.holdId) !== String(holdId || '')) throw new HttpError(409, `${l.slabKey} is ${lockedReason(lock)}.`);
    return { ...slabSnapshot(item), priceCentsPerSf: l.price ?? null, note: l.note || '' };
  });
}

/** List filter for a status tab. Expiring = still active, ends within 3 days. */
function statusClause(status, now) {
  switch (status) {
    case 'active': return { status: 'active', expiresAt: { $gt: now } };
    case 'expiring': return { status: 'active', expiresAt: { $gt: now, $lte: new Date(now.getTime() + 3 * DAY_MS) } };
    case 'expired': return { status: 'active', expiresAt: { $lte: now } };
    case 'released': return { status: 'released' };
    case 'converted': return { status: 'converted' };
    default: return {};
  }
}

export default function createHoldsRouter({ authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  const h = (fn) => handle(fn, { label: LABEL });

  // ── Cart ───────────────────────────────────────────────────────────────

  const userIdOf = (req) => String(req.user?.id || '');

  async function presentCart(req) {
    const cart = await Cart.findOne({ userId: userIdOf(req) }).lean();
    const lines = cart?.lines || [];
    const keys = lines.map((l) => l.slabKey);
    const [slabs, locks, others] = await Promise.all([
      findSlabs(keys),
      reservationsFor(keys),
      keys.length ? Cart.find({ userId: { $ne: userIdOf(req) }, 'lines.slabKey': { $in: keys } }, 'userName lines.slabKey').lean() : []
    ]);
    const othersByKey = new Map();
    for (const c of others) for (const l of c.lines) if (keys.includes(l.slabKey)) othersByKey.set(l.slabKey, [...(othersByKey.get(l.slabKey) || []), c.userName || 'Someone']);
    return {
      customer: cart?.customer || null,
      updatedAt: cart?.updatedAt || null,
      lines: lines.map((l) => {
        const item = slabs.get(l.slabKey);
        const lock = locks.get(l.slabKey);
        return {
          slabKey: l.slabKey,
          note: l.note,
          addedAt: l.addedAt,
          slab: item ? slabSnapshot(item) : null,
          inStock: Boolean(item && isHoldableSlab(item)),
          lock: lock ? { holdNumber: lock.holdNumber, by: lock.by?.name || '', expiresOn: lock.expiresOn } : null,
          othersInCart: othersByKey.get(l.slabKey) || []
        };
      })
    };
  }

  const ensureCart = (req) => Cart.updateOne(
    { userId: userIdOf(req) },
    { $setOnInsert: { userId: userIdOf(req), lines: [] }, $set: { userName: req.user?.displayName || req.user?.username || '' } },
    { upsert: true }
  );

  /** Add slabs to the person's cart; returns what was added and why anything wasn't. */
  async function addToCart(req, keys) {
    const slabs = await findSlabs(keys);
    const locks = await reservationsFor(keys);
    await ensureCart(req);
    const cart = await Cart.findOne({ userId: userIdOf(req) }, 'lines.slabKey').lean();
    const already = new Set((cart?.lines || []).map((l) => l.slabKey));
    let room = MAX_CART_SLABS - already.size;
    const added = [];
    const skipped = [];
    for (const key of [...new Set(keys)]) {
      const item = slabs.get(key);
      if (already.has(key)) { skipped.push({ slabKey: key, reason: 'Already in your cart' }); continue; }
      if (!item) { skipped.push({ slabKey: key, reason: 'Not in stock' }); continue; }
      if (!isHoldableSlab(item)) { skipped.push({ slabKey: key, reason: 'Only whole slabs can go in the cart' }); continue; }
      if (locks.has(key)) { skipped.push({ slabKey: key, reason: lockedReason(locks.get(key)) }); continue; }
      if (room <= 0) { skipped.push({ slabKey: key, reason: `The cart holds up to ${MAX_CART_SLABS} slabs` }); continue; }
      const res = await Cart.updateOne(
        { userId: userIdOf(req), 'lines.slabKey': { $ne: key } },
        { $push: { lines: { slabKey: key, product: item.product || '', note: '', addedAt: new Date() } } }
      );
      if (res.modifiedCount) { added.push(key); room -= 1; } else skipped.push({ slabKey: key, reason: 'Already in your cart' });
    }
    if (added.length) announce(req, added);
    return { added, skipped };
  }

  router.get('/cart', requireAll(CART.USE), h(async (req, res) => {
    res.json(await presentCart(req));
  }));

  router.post('/cart/slabs', requireAll(CART.USE), h(async (req, res) => {
    const body = parse(S.cartAdd, req.body);
    const result = await addToCart(req, body.slabKeys);
    res.json({ ...result, cart: await presentCart(req) });
  }));

  router.post('/cart/scan', requireAll(CART.USE), h(async (req, res) => {
    const body = parse(S.cartScan, req.body);
    const item = await findByCode(body.code);
    if (!item) throw new HttpError(404, `No slab with barcode or serial # “${body.code}”.`);
    if (!isHoldableSlab(item)) throw new HttpError(400, `${item.serialNumber} (${item.product}) isn’t a whole slab — only slabs can go in the cart.`);
    const result = await addToCart(req, [slabKeyOf(item.serialNumber)]);
    res.json({ ...result, slab: slabSnapshot(item), cart: await presentCart(req) });
  }));

  router.patch('/cart/customer', requireAll(CART.USE), h(async (req, res) => {
    const body = parse(S.cartCustomer, req.body);
    let customer = null;
    if (body.customerId) {
      const snap = await customerSnapshot(body.customerId);
      customer = { id: snap.id, name: snap.name };
    }
    await ensureCart(req);
    await Cart.updateOne({ userId: userIdOf(req) }, { $set: { customer } });
    res.json(await presentCart(req));
  }));

  router.patch('/cart/slabs/:slabKey', requireAll(CART.USE), h(async (req, res) => {
    const body = parse(S.cartNote, req.body);
    const key = slabKeyOf(req.params.slabKey);
    const r = await Cart.updateOne({ userId: userIdOf(req), 'lines.slabKey': key }, { $set: { 'lines.$.note': body.note } });
    if (!r.matchedCount) throw new HttpError(404, `${key} isn’t in your cart.`);
    res.json(await presentCart(req));
  }));

  router.delete('/cart/slabs/:slabKey', requireAll(CART.USE), h(async (req, res) => {
    const key = slabKeyOf(req.params.slabKey);
    await Cart.updateOne({ userId: userIdOf(req) }, { $pull: { lines: { slabKey: key } } });
    announce(req, [key]);
    res.json(await presentCart(req));
  }));

  router.delete('/cart', requireAll(CART.USE), h(async (req, res) => {
    const cart = await Cart.findOne({ userId: userIdOf(req) }, 'lines.slabKey').lean();
    await Cart.updateOne({ userId: userIdOf(req) }, { $set: { lines: [], customer: null } });
    announce(req, (cart?.lines || []).map((l) => l.slabKey));
    res.json(await presentCart(req));
  }));

  // Locks and carts for the slabs on an inventory screen.
  router.post('/slabs/status', requireAny(CART.USE, ...HOLD_VIEW_PERMISSIONS), h(async (req, res) => {
    const body = parse(S.slabLookup, req.body);
    const keys = body.slabKeys;
    const [locks, mine, others] = await Promise.all([
      reservationsFor(keys),
      Cart.findOne({ userId: userIdOf(req) }, 'lines.slabKey').lean(),
      Cart.find({ userId: { $ne: userIdOf(req) }, 'lines.slabKey': { $in: keys } }, 'userName lines.slabKey').lean()
    ]);
    const inMine = new Set((mine?.lines || []).map((l) => l.slabKey));
    const out = {};
    for (const key of keys) {
      const lock = locks.get(key);
      out[key] = {
        lock: lock ? { holdId: lock.holdId, holdNumber: lock.holdNumber, by: lock.by?.name || '', expiresOn: lock.expiresOn, branch: lock.branch } : null,
        inMyCart: inMine.has(key),
        othersInCart: others.filter((c) => c.lines.some((l) => l.slabKey === key)).map((c) => c.userName || 'Someone')
      };
    }
    res.json(out);
  }));

  // ── Holds ──────────────────────────────────────────────────────────────

  router.get('/meta', requireAny(CART.USE, ...HOLD_VIEW_PERMISSIONS), h(async (req, res) => {
    const assigned = req.user.assignedLocations || [];
    const branches = BRANCH_NAMES.filter((b) => assigned.includes('*') || assigned.includes(b));
    const home = homeLocationOf(req.user);
    const defaultBranch = branches.includes(home) ? home : (branches[0] || '');
    res.json({
      scopes: holdScopesFor(req.user),
      branches,
      defaultBranch,
      defaultExpiresOn: defaultBranch ? defaultExpiresOn(defaultBranch) : null
    });
  }));

  router.get('/', requireAny(...HOLD_VIEW_PERMISSIONS), h(async (req, res) => {
    const q = parse(S.holdList, req.query);
    const scopes = holdScopesFor(req.user);
    const scope = q.scope || (scopes.includes('branch') ? 'branch' : scopes[0]);
    const visible = scopeClause(req.user, scope, q.branch);
    if (!visible) throw new HttpError(403, 'You don’t have access to those holds.');
    const now = new Date();
    const narrow = [visible];
    if (q.search) {
      const term = q.search.trim();
      const rx = new RegExp(escapeRegex(term), 'i');
      const or = [{ 'customer.name': rx }, { job: rx }, { slabKeys: term.toUpperCase() }];
      if (/^\d+$/.test(term)) or.push({ number: Number(term) });
      narrow.push({ $or: or });
    }
    if (q.from || q.to) {
      narrow.push({ createdAt: { ...(q.from && { $gte: new Date(`${q.from}T00:00:00Z`) }), ...(q.to && { $lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + DAY_MS) }) } });
    }
    const filter = { $and: [...narrow, statusClause(q.status, now)] };
    const [total, docs, ...counts] = await Promise.all([
      Hold.countDocuments(filter),
      Hold.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      ...['active', 'expiring', 'expired', 'released', 'converted', 'all'].map((s) => Hold.countDocuments({ $and: [...narrow, statusClause(s, now)] }))
    ]);
    const [active, expiring, expired, released, converted, all] = counts;
    res.json({
      items: docs.map((d) => listRow(d, now)),
      total, page: q.page, limit: q.limit, scope, scopes,
      counts: { active, expiring, expired, released, converted, all }
    });
  }));

  router.get('/:id', requireAny(...HOLD_VIEW_PERMISSIONS), h(async (req, res) => {
    const hold = await holdFor(req, req.params.id);
    const out = present(hold);
    if (can(req.user, HOLDS.HISTORY)) {
      out.history = await HoldHistory.find({ holdId: hold._id }).sort({ at: -1 }).limit(300).lean();
    }
    res.json(out);
  }));

  router.get('/:id/pdf', requireAll(HOLDS.PRINT), h(async (req, res) => {
    const hold = await holdFor(req, req.params.id);
    // The branch's own address on the letterhead, as on its selection sheets (Kent when it has none).
    const letterhead = letterheadFor(await Location.findOne({ name: hold.branch }).lean().catch(() => null));
    const bytes = await buildHoldPdf(present(hold), { hide: parseHide(req.query.hide), letterhead });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${holdPdfFileName(hold)}"`);
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(bytes));
  }));

  router.post('/', requireAll(HOLDS.CREATE), h(async (req, res) => {
    const body = parse(S.holdCreate, req.body);
    const by = actorOf(req);
    const prior = await Hold.findOne({ requestId: body.requestId });
    if (prior) {
      if (!canSeeHold(req.user, prior)) throw new HttpError(409, 'That request was already used.');
      return res.status(200).json(present(prior));
    }
    const branchWhy = branchProblem(body.branch, req.user.assignedLocations || []);
    if (branchWhy) throw new HttpError(400, branchWhy);
    const expiryWhy = expiryProblem({ expiresOn: body.expiresOn, branch: body.branch, canExtend: can(req.user, HOLDS.EXTEND) });
    if (expiryWhy) throw new HttpError(400, expiryWhy);
    const keys = body.lines.map((l) => l.slabKey);
    if (new Set(keys).size !== keys.length) throw new HttpError(400, 'A slab is listed twice.');
    const customer = await customerSnapshot(body.customerId);
    const lines = await holdableLines(body.lines);
    const { expiresAt, releaseAt } = expiryMoments(body.expiresOn, body.branch);

    const create = () => inTransaction(async (session) => {
      const number = await nextNumber('hold', session);
      const [hold] = await Hold.create([{
        number, status: 'active', branch: body.branch, customer, job: body.job, notes: body.notes,
        chanceToClose: body.chanceToClose, expiresOn: body.expiresOn, expiresAt, releaseAt, lines,
        createdBy: by, updatedBy: by, requestId: body.requestId
      }], { session });
      await lockSlabs(hold, lines, by, session);
      const totals = holdTotals(lines);
      await writeHistory(session, [historyEntry(hold, 'created', by, {
        note: `${lines.length} slab${lines.length === 1 ? '' : 's'} for ${customer.name}, until ${formatDay(body.expiresOn)}${totals.totalCents !== null ? ` · ${formatMoney(totals.totalCents)}` : ''}`
      })]);
      return hold;
    });
    let created;
    try {
      created = await create();
    } catch (err) {
      // Two taps at the same instant: the second finds the first one's hold.
      if (err?.code === 11000 && err?.keyPattern?.requestId) {
        const first = await Hold.findOne({ requestId: body.requestId });
        if (first && canSeeHold(req.user, first)) return res.status(200).json(present(first));
      }
      throw err;
    }

    // Out of the cart now that they're held (best effort — the hold is already safe).
    await Cart.updateOne({ userId: userIdOf(req) }, { $pull: { lines: { slabKey: { $in: keys } } } }).catch(() => {});
    const cart = await Cart.findOne({ userId: userIdOf(req) }, 'lines').lean();
    if (cart && !cart.lines.length) await Cart.updateOne({ userId: userIdOf(req) }, { $set: { customer: null } }).catch(() => {});
    announce(req, keys);
    res.status(201).json(present(created));
  }));

  /** Load, check and save a hold in one transaction; `change` mutates it and returns history entries. */
  const changeHold = (permission, schema, change) => [requireAll(permission), h(async (req, res) => {
    const body = parse(schema, req.body);
    const by = actorOf(req);
    const touched = [];
    const saved = await inTransaction(async (session) => {
      const hold = await holdFor(req, req.params.id, session);
      checkVersion(hold, body.version, `Hold #${hold.number}`);
      mustBeOpen(hold);
      const entries = await change({ hold, body, by, session, req, touched });
      if (!entries.length) return hold;
      hold.updatedBy = by;
      await hold.save({ session });
      await writeHistory(session, entries.map((e) => historyEntry(hold, e.action, by, e)));
      return hold;
    });
    announce(req, touched);
    res.json(present(saved));
  })];

  router.patch('/:id/details', ...changeHold(HOLDS.EDIT, S.holdDetails, async ({ hold, body, session }) => {
    const changes = [];
    const set = (field, value) => {
      if (value === undefined || String(hold[field] ?? '') === String(value ?? '')) return;
      changes.push({ field, from: hold[field] ?? null, to: value });
      hold[field] = value;
    };
    if (body.customerId && body.customerId !== hold.customer?.id) {
      const customer = await customerSnapshot(body.customerId, session);
      changes.push({ field: 'customer', from: hold.customer?.name || '', to: customer.name });
      hold.customer = customer;
      await SlabReservation.updateMany({ holdId: hold._id }, { $set: { customerName: customer.name } }, { session });
    }
    set('job', body.job);
    set('notes', body.notes);
    set('commissionNotes', body.commissionNotes);
    set('chanceToClose', body.chanceToClose);
    for (const ln of body.lineNotes || []) {
      const line = hold.lines.find((l) => l.slabKey === ln.slabKey);
      if (!line) throw new HttpError(400, `${ln.slabKey} isn’t on this hold.`);
      if (line.note !== ln.note) { changes.push({ field: `note ${ln.slabKey}`, from: line.note, to: ln.note }); line.note = ln.note; }
    }
    return changes.length ? [{ action: 'edited', changes }] : [];
  }));

  router.post('/:id/slabs', ...changeHold(HOLDS.SLABS, S.holdSlabs, async ({ hold, body, by, session, touched, req }) => {
    const current = new Set(hold.lines.map((l) => l.slabKey));
    for (const key of body.remove) if (!current.has(key)) throw new HttpError(400, `${key} isn’t on this hold.`);
    const adding = body.add.filter((l) => !current.has(l.slabKey));
    if (hold.lines.length - body.remove.length + adding.length > MAX_HOLD_SLABS) throw new HttpError(400, `A hold can have up to ${MAX_HOLD_SLABS} slabs.`);
    if (hold.lines.length - body.remove.length + adding.length < 1) throw new HttpError(400, 'A hold needs at least one slab — release it instead.');
    const newLines = await holdableLines(adding, hold._id);
    await unlockSlabs(hold._id, body.remove, session);
    await lockSlabs(hold, newLines, by, session);
    hold.lines = [...hold.lines.filter((l) => !body.remove.includes(l.slabKey)), ...newLines];
    touched.push(...body.remove, ...newLines.map((l) => l.slabKey));
    // Added from the cart, as on create: they leave it once they're held.
    if (newLines.length) await Cart.updateOne({ userId: userIdOf(req) }, { $pull: { lines: { slabKey: { $in: newLines.map((l) => l.slabKey) } } } }, { session });
    const entries = [];
    if (newLines.length) entries.push({ action: 'slabs_added', note: newLines.map((l) => l.slabKey).join(', ') });
    if (body.remove.length) entries.push({ action: 'slabs_removed', note: body.remove.join(', ') });
    return entries;
  }));

  router.post('/:id/swap', ...changeHold(HOLDS.SLABS, S.holdSwap, async ({ hold, body, by, session, touched }) => {
    const index = hold.lines.findIndex((l) => l.slabKey === body.from);
    if (index < 0) throw new HttpError(400, `${body.from} isn’t on this hold.`);
    if (hold.lines.some((l) => l.slabKey === body.to)) throw new HttpError(400, `${body.to} is already on this hold.`);
    const old = hold.lines[index];
    const [replacement] = await holdableLines([{ slabKey: body.to, price: old.priceCentsPerSf, note: old.note }], hold._id);
    await unlockSlabs(hold._id, [body.from], session);
    await lockSlabs(hold, [replacement], by, session);
    hold.lines.splice(index, 1, replacement);
    touched.push(body.from, body.to);
    return [{ action: 'slab_swapped', changes: [{ field: 'slab', from: body.from, to: body.to }] }];
  }));

  router.patch('/:id/prices', ...changeHold(HOLDS.PRICES, S.holdPrices, async ({ hold, body }) => {
    const changes = [];
    for (const p of body.lines) {
      const line = hold.lines.find((l) => l.slabKey === p.slabKey);
      if (!line) throw new HttpError(400, `${p.slabKey} isn’t on this hold.`);
      if ((line.priceCentsPerSf ?? null) !== (p.price ?? null)) {
        changes.push({ field: `price ${p.slabKey}`, from: line.priceCentsPerSf ?? null, to: p.price ?? null });
        line.priceCentsPerSf = p.price ?? null;
      }
    }
    return changes.length ? [{ action: 'prices_changed', changes }] : [];
  }));

  router.post('/:id/extend', ...changeHold(HOLDS.EXTEND, S.holdExtend, async ({ hold, body, session }) => {
    if (body.expiresOn === hold.expiresOn) return [];
    const why = expiryProblem({ expiresOn: body.expiresOn, branch: hold.branch, canExtend: true });
    if (why) throw new HttpError(400, why);
    const { expiresAt, releaseAt } = expiryMoments(body.expiresOn, hold.branch);
    const from = hold.expiresOn;
    hold.expiresOn = body.expiresOn;
    hold.expiresAt = expiresAt;
    hold.releaseAt = releaseAt;
    if (expiresAt > new Date()) hold.expiredNotedAt = null;
    await SlabReservation.updateMany({ holdId: hold._id }, { $set: { expiresOn: body.expiresOn } }, { session });
    return [{ action: 'extended', changes: [{ field: 'expiresOn', from, to: body.expiresOn }] }];
  }));

  router.post('/:id/release', ...changeHold(HOLDS.RELEASE, S.holdRelease, async ({ hold, body, by, session, touched }) => {
    hold.status = 'released';
    hold.releasedAt = new Date();
    hold.releasedBy = by;
    hold.releaseReason = body.reason;
    await unlockSlabs(hold._id, hold.slabKeys, session);
    touched.push(...hold.slabKeys);
    return [{ action: 'released', changes: [{ field: 'status', from: 'active', to: 'released' }], note: body.reason }];
  }));

  return router;
}
