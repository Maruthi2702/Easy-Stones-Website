import type { Loose } from '../types/records.ts';
import type { Request, RequestHandler, Response } from 'express';
/**
 * Cart & Holds API (2026-10-10) — mounted at /api/holds.
 *
 *   app.use('/api/holds', createHoldsRouter({ authenticate }));
 *
 * Cart:  GET /cart · POST /cart/slabs · POST /cart/scan · PATCH /cart/customer
 *        PATCH /cart/slabs/:slabKey (note) · DELETE /cart/slabs/:slabKey
 *        POST /cart/slabs/remove (several at once) · DELETE /cart
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
import type { ZodType } from 'zod';
import { findSlabsByKeys, findSlabByBarcode } from '../db/inventory/index.ts';
import { inHoldsTransaction, holdsStore, type HoldsStore } from '../db/holds/index.ts';
import { newId, isId } from '../db/ids.ts';
import { customerById } from '../db/customers/index.ts';
import Location from '../models/Location.ts';
import { letterheadFor } from '../utils/locationForm.ts';
import { companyOf, contactOf, realEmailsOf } from '../utils/customerList.ts';
import { homeLocationOf } from '../utils/locationFilter.ts';
import { BRANCH_NAMES } from '../config/branches.ts';
import {
  HttpError, handle, requireAll, requireAny, parse, checkVersion, actorOf
} from '../server/http.ts';
import { CART, HOLDS, HOLD_VIEW_PERMISSIONS, can } from './permissions.ts';
import {
  slabKeyOf, isHoldableSlab, slabSnapshot, holdTotals, holdState, daysToExpiry, defaultExpiresOn,
  expiryMoments, expiryProblem, branchProblem, holdScopesFor, canSeeHold, scopeFilter, formatDay, formatMoney,
  MAX_CART_SLABS, MAX_HOLD_SLABS
} from './holdRules.ts';
import { buildHoldPdf, holdPdfFileName } from './holdPdf.ts';
import { parseHide } from './holdLetter.ts';
import * as S from './schemas.ts';

const LABEL = 'holds';

// ── Slabs ────────────────────────────────────────────────────────────────

/** Slabs by key. Most serials are stored exactly as their key; the rest are matched normalised. */
async function findSlabs(keys: string[]) {
  const wanted = [...new Set(keys.map(slabKeyOf).filter(Boolean))];
  if (!wanted.length) return new Map();
  const found = new Map();
  // The inventory data layer reads the serial # index case-insensitively, then the stragglers normalised.
  for (const item of await findSlabsByKeys(wanted, slabKeyOf)) found.set(slabKeyOf(item.serialNumber), item);
  return found;
}

/** The one slab a scanned barcode or typed serial # points at. */
async function findByCode(code: unknown) {
  const value = String(code || '').trim();
  const byBarcode = await findSlabByBarcode(value);
  if (byBarcode) return byBarcode;
  return (await findSlabs([value])).get(slabKeyOf(value)) || null;
}

const reservationsFor = async (store: HoldsStore, keys: string[]) => new Map((await store.reservationsFor(keys)).map((r) => [r.slabKey, r]));

const announce = (req: Request, slabKeys: string[]) => {
  const keys = [...new Set(slabKeys)].filter(Boolean);
  if (keys.length) req.app.get('io')?.emit('slab_reservations_changed', { slabKeys: keys });
};

const lockedReason = (r: Loose) => `On Hold #${r.holdNumber}${r.by?.name ? ` (${r.by.name})` : ''}`;

// ── Customers ────────────────────────────────────────────────────────────

async function customerSnapshot(customerId: string, store: HoldsStore | null = null) {
  const c = await customerById(customerId, store?.session ?? null);
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

const historyEntry = (hold: Loose, action: string, by: Loose, extra: Loose = {}) => ({ holdId: hold._id, holdNumber: hold.number, action, by, ...extra });

/** The hold, if it exists and this person may see it — otherwise 404. */
async function holdFor(req: Request, id: unknown, store: HoldsStore) {
  if (!isId(id)) throw new HttpError(404, 'Hold not found.');
  const hold = await store.findHold(id);
  if (!hold || !canSeeHold(req.user, hold)) throw new HttpError(404, 'Hold not found.');
  return hold;
}

/** Released and converted holds are final. Expired ones still hold their slabs and can change. */
const mustBeOpen = (hold: Loose) => {
  if (hold.status !== 'active') throw new HttpError(400, `Hold #${hold.number} is ${hold.status} — it can’t be changed.`);
};

const present = (hold: Loose, now = new Date()) => {
  const h = hold;
  return {
    ...h,
    version: h.__v,
    state: holdState(h, now),
    daysToExpiry: daysToExpiry(h, now),
    totals: holdTotals(h.lines)
  };
};

const listRow = (h: Loose, now: Date) => {
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
async function lockSlabs(store: HoldsStore, hold: Loose, lines: Loose[], by: Loose) {
  const taken = await store.lockSlabs(hold, lines, by);
  if (!taken.length) return;
  const other = taken.find((r) => String(r.holdId) !== String(hold._id));
  throw new HttpError(409, other ? `${other.slabKey} was just put on Hold #${other.holdNumber}. Remove it and try again.` : 'One of these slabs was just held by someone else.', { taken: taken.map((r) => r.slabKey) });
}

/** Check new slabs before they go on a hold: in stock, whole slabs, not held elsewhere. */
async function holdableLines(requested: Loose[], holdId: unknown = null, store: HoldsStore | null = null) {
  const slabs = await findSlabs(requested.map((l: Loose) => l.slabKey));
  const locks = await reservationsFor(store ?? await holdsStore(), requested.map((l: Loose) => l.slabKey));
  return requested.map((l: Loose) => {
    const item = slabs.get(l.slabKey);
    if (!item) throw new HttpError(400, `${l.slabKey} isn’t in stock any more.`);
    if (!isHoldableSlab(item)) throw new HttpError(400, `${l.slabKey} isn’t a whole slab — only slabs can be held.`);
    const lock = locks.get(l.slabKey);
    if (lock && String(lock.holdId) !== String(holdId || '')) throw new HttpError(409, `${l.slabKey} is ${lockedReason(lock)}.`);
    return { ...slabSnapshot(item), priceCentsPerSf: l.price ?? null, note: l.note || '' };
  });
}

export default function createHoldsRouter({ authenticate }: { authenticate: RequestHandler }) {
  const router = express.Router();
  router.use(authenticate);
  const h = (fn: Parameters<typeof handle>[0]) => handle(fn, { label: LABEL });

  // ── Cart ───────────────────────────────────────────────────────────────

  const userIdOf = (req: Request) => String(req.user?.id || '');
  const userNameOf = (req: Request) => req.user?.displayName || req.user?.username || '';

  async function presentCart(req: Request, store: HoldsStore) {
    const cart = await store.getCart(userIdOf(req));
    const lines = cart?.lines || [];
    const keys = lines.map((l: Loose) => l.slabKey);
    const [slabs, locks, others] = await Promise.all([findSlabs(keys), reservationsFor(store, keys), store.othersWith(userIdOf(req), keys)]);
    const othersByKey = new Map();
    for (const c of others) for (const key of c.slabKeys) if (keys.includes(key)) othersByKey.set(key, [...(othersByKey.get(key) || []), c.userName || 'Someone']);
    return {
      customer: cart?.customer || null,
      updatedAt: cart?.updatedAt || null,
      lines: lines.map((l: Loose) => {
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

  /**
   * Add slabs to the person's cart; returns what was added and why anything wasn't.
   * Everything that can be read at once is (slabs, locks and the cart's keys — which also makes the
   * cart), and the slabs that pass go in with a single write. If a second tab added one of them in the
   * meantime that write adds nothing, and each is then added on its own, so none is doubled.
   */
  async function addToCart(req: Request, store: HoldsStore, keys: string[]) {
    const userId = userIdOf(req);
    const [slabs, locks, cart] = await Promise.all([
      findSlabs(keys),
      reservationsFor(store, keys),
      store.ensureCart(userId, userNameOf(req))
    ]);
    const already = new Set(cart.slabKeys);
    let room = MAX_CART_SLABS - already.size;
    const skipped: Loose[] = [];
    const wanted: Loose[] = [];
    for (const key of [...new Set(keys)]) {
      const item = slabs.get(key);
      if (already.has(key)) { skipped.push({ slabKey: key, reason: 'Already in your cart' }); continue; }
      if (!item) { skipped.push({ slabKey: key, reason: 'Not in stock' }); continue; }
      if (!isHoldableSlab(item)) { skipped.push({ slabKey: key, reason: 'Only whole slabs can go in the cart' }); continue; }
      const lock = locks.get(key);
      if (lock) { skipped.push({ slabKey: key, reason: lockedReason(lock) }); continue; }
      if (room <= 0) { skipped.push({ slabKey: key, reason: `The cart holds up to ${MAX_CART_SLABS} slabs` }); continue; }
      wanted.push({ key, line: { slabKey: key, product: item.product || '', note: '', addedAt: new Date() } });
      room -= 1;
    }

    let added: string[] = [];
    if (wanted.length) {
      if (await store.addCartLines(userId, wanted.map((w) => w.line))) {
        added = wanted.map((w) => w.key);
      } else {
        for (const { key, line } of wanted) {
          if (await store.addCartLines(userId, [line])) added.push(key); else skipped.push({ slabKey: key, reason: 'Already in your cart' });
        }
      }
    }
    if (added.length) announce(req, added);
    return { added, skipped };
  }

  router.get('/cart', requireAll(CART.USE), h(async (req: Request, res: Response) => {
    res.json(await presentCart(req, await holdsStore()));
  }));

  router.post('/cart/slabs', requireAll(CART.USE), h(async (req: Request, res: Response) => {
    const body = parse(S.cartAdd, req.body);
    const store = await holdsStore();
    const result = await addToCart(req, store, body.slabKeys);
    res.json({ ...result, cart: await presentCart(req, store) });
  }));

  router.post('/cart/scan', requireAll(CART.USE), h(async (req: Request, res: Response) => {
    const body = parse(S.cartScan, req.body);
    const item = await findByCode(body.code);
    if (!item) throw new HttpError(404, `No slab with barcode or serial # “${body.code}”.`);
    if (!isHoldableSlab(item)) throw new HttpError(400, `${item.serialNumber} (${item.product}) isn’t a whole slab — only slabs can go in the cart.`);
    const store = await holdsStore();
    const result = await addToCart(req, store, [slabKeyOf(item.serialNumber)]);
    res.json({ ...result, slab: slabSnapshot(item), cart: await presentCart(req, store) });
  }));

  router.patch('/cart/customer', requireAll(CART.USE), h(async (req: Request, res: Response) => {
    const body = parse(S.cartCustomer, req.body);
    const store = await holdsStore();
    let customer = null;
    if (body.customerId) {
      const snap = await customerSnapshot(body.customerId);
      customer = { id: snap.id, name: snap.name };
    }
    await store.setCartCustomer(userIdOf(req), userNameOf(req), customer);
    res.json(await presentCart(req, store));
  }));

  router.patch('/cart/slabs/:slabKey', requireAll(CART.USE), h(async (req: Request, res: Response) => {
    const body = parse(S.cartNote, req.body);
    const key = slabKeyOf(req.params.slabKey);
    const store = await holdsStore();
    if (!(await store.setCartNote(userIdOf(req), key, body.note))) throw new HttpError(404, `${key} isn’t in your cart.`);
    res.json(await presentCart(req, store));
  }));

  // Several at once (a bundle ticked off): one write and one answer instead of one each.
  router.post('/cart/slabs/remove', requireAll(CART.USE), h(async (req: Request, res: Response) => {
    const body = parse(S.cartAdd, req.body);
    const keys = [...new Set(body.slabKeys.map(slabKeyOf))].filter(Boolean);
    const store = await holdsStore();
    await store.removeCartSlabs(userIdOf(req), keys);
    announce(req, keys);
    res.json(await presentCart(req, store));
  }));

  router.delete('/cart/slabs/:slabKey', requireAll(CART.USE), h(async (req: Request, res: Response) => {
    const key = slabKeyOf(req.params.slabKey);
    const store = await holdsStore();
    await store.removeCartSlabs(userIdOf(req), [key]);
    announce(req, [key]);
    res.json(await presentCart(req, store));
  }));

  router.delete('/cart', requireAll(CART.USE), h(async (req: Request, res: Response) => {
    const store = await holdsStore();
    announce(req, await store.clearCart(userIdOf(req)));
    res.json(await presentCart(req, store));
  }));

  // Locks and carts for the slabs on an inventory screen.
  router.post('/slabs/status', requireAny(CART.USE, ...HOLD_VIEW_PERMISSIONS), h(async (req: Request, res: Response) => {
    const body = parse(S.slabLookup, req.body);
    const keys = body.slabKeys;
    const store = await holdsStore();
    const [locks, mine, others] = await Promise.all([reservationsFor(store, keys), store.getCart(userIdOf(req)), store.othersWith(userIdOf(req), keys)]);
    const inMine = new Set((mine?.lines || []).map((l: Loose) => l.slabKey));
    const out: Loose = {};
    for (const key of keys) {
      const lock = locks.get(key);
      out[key] = {
        lock: lock ? { holdId: lock.holdId, holdNumber: lock.holdNumber, by: lock.by?.name || '', expiresOn: lock.expiresOn, branch: lock.branch } : null,
        inMyCart: inMine.has(key),
        othersInCart: others.filter((c) => c.slabKeys.includes(key)).map((c) => c.userName || 'Someone')
      };
    }
    res.json(out);
  }));

  // ── Holds ──────────────────────────────────────────────────────────────

  router.get('/meta', requireAny(CART.USE, ...HOLD_VIEW_PERMISSIONS), h(async (req: Request, res: Response) => {
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

  router.get('/', requireAny(...HOLD_VIEW_PERMISSIONS), h(async (req: Request, res: Response) => {
    const q = parse(S.holdList, req.query);
    const scopes = holdScopesFor(req.user);
    const scope = q.scope || (scopes.includes('branch') ? 'branch' : scopes[0]);
    const visible = scopeFilter(req.user, scope, q.branch);
    if (!visible) throw new HttpError(403, 'You don’t have access to those holds.');
    const now = new Date();
    const { total, items, counts } = await (await holdsStore()).listHolds({
      scope: visible, search: q.search, from: q.from, to: q.to, status: q.status, now, page: q.page, limit: q.limit
    });
    res.json({ items: items.map((d) => listRow(d, now)), total, page: q.page, limit: q.limit, scope, scopes, counts });
  }));

  router.get('/:id', requireAny(...HOLD_VIEW_PERMISSIONS), h(async (req: Request, res: Response) => {
    const store = await holdsStore();
    const hold = await holdFor(req, req.params.id, store);
    const out: Loose = present(hold);
    if (can(req.user, HOLDS.HISTORY)) out.history = await store.history(hold._id, 300);
    res.json(out);
  }));

  router.get('/:id/pdf', requireAll(HOLDS.PRINT), h(async (req: Request, res: Response) => {
    const hold = await holdFor(req, req.params.id, await holdsStore());
    // The branch's own address on the letterhead, as on its selection sheets (Kent when it has none).
    const letterhead = letterheadFor(await Location.findOne({ name: hold.branch }).lean().catch(() => null));
    const bytes = await buildHoldPdf(present(hold), { hide: parseHide(req.query.hide), letterhead });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${holdPdfFileName(hold)}"`);
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(bytes));
  }));

  router.post('/', requireAll(HOLDS.CREATE), h(async (req: Request, res: Response) => {
    const body = parse(S.holdCreate, req.body);
    const by = actorOf(req);
    const store = await holdsStore();
    const prior = await store.findHoldByRequestId(body.requestId);
    if (prior) {
      if (!canSeeHold(req.user, prior)) throw new HttpError(409, 'That request was already used.');
      return res.status(200).json(present(prior));
    }
    const branchWhy = branchProblem(body.branch, req.user.assignedLocations || []);
    if (branchWhy) throw new HttpError(400, branchWhy);
    const expiryWhy = expiryProblem({ expiresOn: body.expiresOn, branch: body.branch, canExtend: can(req.user, HOLDS.EXTEND) });
    if (expiryWhy) throw new HttpError(400, expiryWhy);
    const keys = body.lines.map((l: Loose) => l.slabKey);
    if (new Set(keys).size !== keys.length) throw new HttpError(400, 'A slab is listed twice.');
    const customer = await customerSnapshot(body.customerId);
    const lines = await holdableLines(body.lines);
    const { expiresAt, releaseAt } = expiryMoments(body.expiresOn, body.branch);

    const create = () => inHoldsTransaction(async (tx) => {
      const number = await tx.nextHoldNumber();
      const hold = await tx.createHold({
        _id: newId(), number, status: 'active', branch: body.branch, customer, job: body.job, notes: body.notes,
        chanceToClose: body.chanceToClose, expiresOn: body.expiresOn, expiresAt, releaseAt, lines,
        createdBy: by, updatedBy: by, requestId: body.requestId
      });
      await lockSlabs(tx, hold, lines, by);
      const totals = holdTotals(lines);
      await tx.addHistory([historyEntry(hold, 'created', by, {
        note: `${lines.length} slab${lines.length === 1 ? '' : 's'} for ${customer.name}, until ${formatDay(body.expiresOn)}${totals.totalCents !== null ? ` · ${formatMoney(totals.totalCents)}` : ''}`
      })]);
      return hold;
    });
    let created!: Loose;
    try {
      created = await create();
    } catch (err) {
      // Two taps at the same instant: the second finds the first one's hold.
      if ((err as Error & Loose)?.code === 11000 && (err as Error & Loose)?.keyPattern?.requestId) {
        const first = await store.findHoldByRequestId(body.requestId);
        if (first && canSeeHold(req.user, first)) return res.status(200).json(present(first));
      }
      throw err;
    }

    // Out of the cart now that they're held (best effort — the hold is already safe).
    await store.releaseFromCart(userIdOf(req), keys).catch(() => {});
    announce(req, keys);
    res.status(201).json(present(created));
  }));

  /** Load, check and save a hold in one transaction; `change` mutates it and returns history entries. */
  const changeHold = (permission: string, schema: ZodType<Loose>, change: (context: { hold: Loose; body: Loose; by: ReturnType<typeof actorOf>; store: HoldsStore; req: Request; touched: string[] }) => Loose[] | Promise<Loose[]>) => [requireAll(permission), h(async (req: Request, res: Response) => {
    const body = parse(schema, req.body);
    const by = actorOf(req);
    const touched: string[] = [];
    const saved = await inHoldsTransaction(async (store) => {
      const hold = await holdFor(req, req.params.id, store);
      checkVersion(hold, body.version, `Hold #${hold.number}`);
      mustBeOpen(hold);
      const entries = await change({ hold, body, by, store, req, touched });
      if (!entries.length) return hold;
      hold.updatedBy = by;
      const next = await store.saveHold(hold);
      if (!next) throw new HttpError(409, `Hold #${hold.number} was changed by someone else. Reload to see the latest, then try again.`);
      await store.addHistory(entries.map((e: Loose) => historyEntry(next, e.action, by, e)));
      return next;
    });
    announce(req, touched);
    res.json(present(saved));
  })];

  router.patch('/:id/details', ...changeHold(HOLDS.EDIT, S.holdDetails, async ({ hold, body, store }) => {
    const changes: Loose[] = [];
    const set = (field: string, value: unknown) => {
      if (value === undefined || String(hold[field] ?? '') === String(value ?? '')) return;
      changes.push({ field, from: hold[field] ?? null, to: value });
      hold[field] = value;
    };
    if (body.customerId && body.customerId !== hold.customer?.id) {
      const customer = await customerSnapshot(body.customerId, store);
      changes.push({ field: 'customer', from: hold.customer?.name || '', to: customer.name });
      hold.customer = customer;
      await store.updateLocks(hold._id, { customerName: customer.name });
    }
    set('job', body.job);
    set('notes', body.notes);
    set('commissionNotes', body.commissionNotes);
    set('chanceToClose', body.chanceToClose);
    for (const ln of body.lineNotes || []) {
      const line = hold.lines.find((l: Loose) => l.slabKey === ln.slabKey);
      if (!line) throw new HttpError(400, `${ln.slabKey} isn’t on this hold.`);
      if (line.note !== ln.note) { changes.push({ field: `note ${ln.slabKey}`, from: line.note, to: ln.note }); line.note = ln.note; }
    }
    return changes.length ? [{ action: 'edited', changes }] : [];
  }));

  router.post('/:id/slabs', ...changeHold(HOLDS.SLABS, S.holdSlabs, async ({ hold, body, by, store, touched, req }) => {
    const current = new Set(hold.lines.map((l: Loose) => l.slabKey));
    for (const key of body.remove) if (!current.has(key)) throw new HttpError(400, `${key} isn’t on this hold.`);
    const adding = body.add.filter((l: Loose) => !current.has(l.slabKey));
    if (hold.lines.length - body.remove.length + adding.length > MAX_HOLD_SLABS) throw new HttpError(400, `A hold can have up to ${MAX_HOLD_SLABS} slabs.`);
    if (hold.lines.length - body.remove.length + adding.length < 1) throw new HttpError(400, 'A hold needs at least one slab — release it instead.');
    const newLines = await holdableLines(adding, hold._id, store);
    await store.unlockSlabs(hold._id, body.remove);
    await lockSlabs(store, hold, newLines, by);
    hold.lines = [...hold.lines.filter((l: Loose) => !body.remove.includes(l.slabKey)), ...newLines];
    touched.push(...body.remove, ...newLines.map((l: Loose) => l.slabKey));
    // Added from the cart, as on create: they leave it once they're held.
    if (newLines.length) await store.removeCartSlabs(userIdOf(req), newLines.map((l: Loose) => l.slabKey));
    const entries: Loose[] = [];
    if (newLines.length) entries.push({ action: 'slabs_added', note: newLines.map((l: Loose) => l.slabKey).join(', ') });
    if (body.remove.length) entries.push({ action: 'slabs_removed', note: body.remove.join(', ') });
    return entries;
  }));

  router.post('/:id/swap', ...changeHold(HOLDS.SLABS, S.holdSwap, async ({ hold, body, by, store, touched }) => {
    const index = hold.lines.findIndex((l: Loose) => l.slabKey === body.from);
    if (index < 0) throw new HttpError(400, `${body.from} isn’t on this hold.`);
    if (hold.lines.some((l: Loose) => l.slabKey === body.to)) throw new HttpError(400, `${body.to} is already on this hold.`);
    const old = hold.lines[index];
    const [replacement] = await holdableLines([{ slabKey: body.to, price: old.priceCentsPerSf, note: old.note }], hold._id, store);
    await store.unlockSlabs(hold._id, [body.from]);
    await lockSlabs(store, hold, [replacement], by);
    hold.lines.splice(index, 1, replacement);
    touched.push(body.from, body.to);
    return [{ action: 'slab_swapped', changes: [{ field: 'slab', from: body.from, to: body.to }] }];
  }));

  router.patch('/:id/prices', ...changeHold(HOLDS.PRICES, S.holdPrices, async ({ hold, body }) => {
    const changes: Loose[] = [];
    for (const p of body.lines) {
      const line = hold.lines.find((l: Loose) => l.slabKey === p.slabKey);
      if (!line) throw new HttpError(400, `${p.slabKey} isn’t on this hold.`);
      if ((line.priceCentsPerSf ?? null) !== (p.price ?? null)) {
        changes.push({ field: `price ${p.slabKey}`, from: line.priceCentsPerSf ?? null, to: p.price ?? null });
        line.priceCentsPerSf = p.price ?? null;
      }
    }
    return changes.length ? [{ action: 'prices_changed', changes }] : [];
  }));

  router.post('/:id/extend', ...changeHold(HOLDS.EXTEND, S.holdExtend, async ({ hold, body, store }) => {
    if (body.expiresOn === hold.expiresOn) return [];
    const why = expiryProblem({ expiresOn: body.expiresOn, branch: hold.branch, canExtend: true });
    if (why) throw new HttpError(400, why);
    const { expiresAt, releaseAt } = expiryMoments(body.expiresOn, hold.branch);
    const from = hold.expiresOn;
    hold.expiresOn = body.expiresOn;
    hold.expiresAt = expiresAt;
    hold.releaseAt = releaseAt;
    if (expiresAt > new Date()) hold.expiredNotedAt = null;
    await store.updateLocks(hold._id, { expiresOn: body.expiresOn });
    return [{ action: 'extended', changes: [{ field: 'expiresOn', from, to: body.expiresOn }] }];
  }));

  router.post('/:id/release', ...changeHold(HOLDS.RELEASE, S.holdRelease, async ({ hold, body, by, store, touched }) => {
    hold.status = 'released';
    hold.releasedAt = new Date();
    hold.releasedBy = by;
    hold.releaseReason = body.reason;
    await store.unlockSlabs(hold._id, hold.slabKeys);
    touched.push(...hold.slabKeys);
    return [{ action: 'released', changes: [{ field: 'status', from: 'active', to: 'released' }], note: body.reason }];
  }));

  return router;
}
