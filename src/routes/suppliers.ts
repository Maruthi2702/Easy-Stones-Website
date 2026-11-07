import type { Request, RequestHandler, Response, NextFunction } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import { validateScalarRequest, scalarQuery, scalarParams } from '../server/scalarRequest.ts';
import { Supplier, SupplierLogin, SupplierPO, SupplierBlock } from '../models/Suppliers.ts';
import InventoryTransitShipment from '../models/InventoryTransitShipment.ts';
import Role from '../models/Role.ts';
import User from '../models/User.ts';
import { SUPPLIER_POS, SUPPLIER_PAGE_PERMISSIONS, MAX_LOGINS_PER_SUPPLIER, SAME_PERSON_BOTH_STEPS } from '../utils/supplierAccess.ts';
import {
  cleanPo, cleanSupplier, cleanLogin, poKey, poChanges, lineRemovalProblem, decisionProblem, applyDecision, unlockProblem,
  blockStage, scorecard, REJECT_REASONS, RETAKE_REASONS, THICKNESSES, FINISHES, type DecisionInput, type Step
} from '../utils/supplierBlocks.ts';
import { LANGUAGES, LANGUAGE_CODES, COUNTRIES } from '../utils/supplierI18n.ts';
import { spsKey } from '../utils/spsSheet.ts';
import { newLink } from '../services/supplierSession.ts';
import { makeNote, translationOn } from '../services/translate.ts';
import { sendSupplierLink, sendPoAssigned, sendDecisions, sendUnlocked } from '../services/supplierEmails.ts';
import { staffPoView, staffBlockView, incomingView, linesOf, blockLike } from '../services/supplierViews.ts';
import createBlockEntryRoutes from './supplierBlockEntry.ts';
import type { Loose } from '../types/records.ts';

/**
 * Supplier POs — the staff side (Purchasing, 2026-11-07). Rules:
 * src/utils/supplierBlocks.ts; who may do what: src/utils/supplierAccess.ts.
 * The supplier's side is src/routes/supplierPortal.ts (its own sign-in).
 *
 *   GET  /meta                        lists the screens need (languages, reasons, buyers…)
 *   GET  /suppliers                   suppliers, their login, open POs and scorecard
 *   POST /suppliers, PUT /suppliers/:id                         (manage_suppliers)
 *   POST /suppliers/:id/logins        add the login and email its invite        (manage_suppliers)
 *   PUT  /suppliers/:id/logins/:lid   name, email, language
 *   POST /suppliers/:id/logins/:lid/invite   a new link (invite or reset), emailed
 *   POST /suppliers/:id/logins/:lid/active   { active } — off ends their sessions
 *   POST /suppliers/:id/logins/:lid/unlock   lift a wrong-password lock
 *   GET  /pos?status=open|closed|cancelled|all
 *   GET  /pos/:id                     with its blocks and history
 *   POST /pos                         { id, … } the screen's own id; a repeat answers alreadySaved (manage_supplier_pos)
 *   PUT  /pos/:id                     edit; the supplier can't change once a block was sent
 *   POST /pos/:id/status              { status, reason } close, cancel, reopen
 *   POST /pos/:id/notify              email the supplier the PO again
 *   GET  /sps-lookup?po=              the SPS import's lines for a PO # ("Fill from SPS")
 *   GET  /blocks?queue=review|final   blocks waiting for that step
 *   GET  /blocks/:id
 *   POST /blocks/:id/decide           { step, decisions: [{ bundleId, decision, reason, comment }], note }
 *   POST /blocks/:id/unlock           { bundleIds, reason }                       (unlock_supplier_bundles)
 *   GET  /incoming                    sales: approved bundles, no supplier / PO / price (view_incoming_material)
 *   + purchasing entering a block for its supplier: ./supplierBlockEntry.ts
 *
 *   app.use('/api/suppliers', createSuppliersRouter({ authenticate, processBase64Image }));
 */

type ReqUser = { id?: string; _id?: string; username?: string; displayName?: string; permissions?: string[]; email?: string };
const userOf = (req: Request) => ((req as Request & { user?: ReqUser }).user || {}) as ReqUser;
const userIdOf = (req: Request) => String(userOf(req).id || userOf(req)._id || '');
const nameOf = (u: { displayName?: string | null; username?: string | null }) => u.displayName || u.username || '';
const has = (req: Request, perm: string) => (userOf(req).permissions || []).includes(perm);
const anyOf = (...perms: readonly string[]) => (req: Request, res: Response, next: NextFunction) =>
  (perms.some((p) => has(req, p)) ? next() : res.status(403).json({ message: 'Access denied.' }));
const todayOf = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const newId = () => new mongoose.Types.ObjectId().toString();
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Where emailed links point: the staff member's own site when they sent it, else the configured one. */
const siteBase = (req: Request) => (req.get('origin') || process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
/** A bundle subdocument as a plain object (its _id is the bundle's string id). */
const toPlain = (raw: unknown): Loose => (raw as { toObject: () => Loose }).toObject();
const isVersionError = (e: unknown) => (e as { name?: string })?.name === 'VersionError';

const loginView = (l: Loose) => ({
  id: String(l._id), name: l.name, email: l.email, language: l.language || 'en', active: l.active !== false,
  hasPassword: Boolean(l.password), invitedAt: l.invitedAt || null, invitedBy: l.invitedBy || '',
  linkExpiresAt: l.linkExpiresAt || null, locked: Boolean(l.lockUntil && new Date(l.lockUntil).getTime() > Date.now()),
  lastLoginAt: l.lastLoginAt || null, lastSeenAt: l.lastSeenAt || null
});
const supplierView = (s: Loose) => ({
  id: String(s._id), name: s.name, spsName: s.spsName || '', country: s.country || '', language: s.language || 'en', timeZone: s.timeZone || '',
  contactName: s.contactName || '', email: s.email || '', phone: s.phone || '', notes: s.notes || '', active: s.active !== false,
  createdAt: s.createdAt, updatedAt: s.updatedAt
});

/** The languages a supplier's people read: each active login's, and the supplier's own. */
async function readerLanguages(supplierId: string) {
  const [supplier, logins] = await Promise.all([
    Supplier.findById(supplierId, 'language').lean(),
    SupplierLogin.find({ supplierId, active: true }, 'language').lean()
  ]);
  return [...new Set([supplier?.language || 'en', ...logins.map((l) => l.language || 'en')])];
}

/**
 * Who hears about a block's decisions: every active login with a password,
 * with a link into the portal — or, for a supplier with none (purchasing
 * enters their blocks), the supplier's own email, in its language, with the
 * photos in the email instead of a link.
 */
async function supplierRecipients(supplierId: string): Promise<{ to: string; lang: string; portal: boolean }[]> {
  const logins = await SupplierLogin.find({ supplierId, active: true, password: { $gt: '' } }, 'email language').lean();
  if (logins.length) return logins.map((l) => ({ to: l.email, lang: l.language || 'en', portal: true }));
  const supplier = await Supplier.findById(supplierId, 'email language active').lean();
  return supplier?.email && supplier.active !== false ? [{ to: supplier.email, lang: supplier.language || 'en', portal: false }] : [];
}

export default function createSuppliersRouter({ authenticate, processBase64Image }: {
  authenticate: RequestHandler;
  processBase64Image?: (data: string, folder?: string, maxSide?: number) => Promise<unknown>;
}) {
  const router = express.Router();
  const pageOpen = [authenticate, anyOf(...SUPPLIER_PAGE_PERMISSIONS)];
  const actor = (req: Request) => ({ id: userIdOf(req), name: nameOf(userOf(req)) });
  const fail = (res: Response, what: string, error: unknown, message: string) => {
    console.error(`[suppliers] ${what} failed:`, error);
    res.status(500).json({ message });
  };

  // ── Lists the screens need ────────────────────────────────────────────────

  router.get('/meta', pageOpen, async (req: Request, res: Response) => {
    try {
      // Buyers: anyone whose role can see or manage supplier POs.
      const roles = await Role.find({ permissions: { $in: [SUPPLIER_POS.VIEW, SUPPLIER_POS.MANAGE_POS] } }, 'name').lean();
      const people = await User.find({ role: { $in: roles.map((r) => r.name) }, isActive: { $ne: false } }, 'username displayName').lean();
      res.json({
        me: actor(req),
        today: todayOf(),
        languages: LANGUAGES, countries: COUNTRIES,
        reasons: { reject: REJECT_REASONS, retake: RETAKE_REASONS },
        thicknesses: THICKNESSES, finishes: FINISHES,
        buyers: people.filter((p) => p.username !== 'admin').map((p) => ({ id: String(p._id), name: nameOf(p) })).sort((a, b) => a.name.localeCompare(b.name)),
        translation: translationOn(),
        sameStepAllowed: SAME_PERSON_BOTH_STEPS,
        maxLogins: MAX_LOGINS_PER_SUPPLIER
      });
    } catch (error) { fail(res, 'meta', error, 'Could not load Supplier POs.'); }
  });

  // ── Suppliers ─────────────────────────────────────────────────────────────

  router.get('/suppliers', pageOpen, async (_req: Request, res: Response) => {
    try {
      const since = new Date(Date.now() - 180 * 24 * 3_600_000);
      const [suppliers, logins, pos, blocks] = await Promise.all([
        Supplier.find({}).sort({ active: -1, name: 1 }).lean(),
        SupplierLogin.find({}).lean(),
        SupplierPO.find({ $or: [{ status: 'open' }, { updatedAt: { $gte: since } }] }, 'supplierId status assignedAt').lean(),
        SupplierBlock.find({ firstSentAt: { $gte: since } }, 'supplierId poId firstSentAt bundles').lean()
      ]);
      res.json({
        suppliers: suppliers.map((s) => {
          const id = String(s._id);
          const mine = pos.filter((p) => p.supplierId === id);
          return {
            ...supplierView(s),
            logins: logins.filter((l) => l.supplierId === id).map(loginView),
            openPos: mine.filter((p) => p.status === 'open').length,
            score: scorecard(mine, blocks.filter((b) => b.supplierId === id).map((b) => ({ ...b, bundles: blockLike(b).bundles })))
          };
        })
      });
    } catch (error) { fail(res, 'suppliers', error, 'Could not load the suppliers.'); }
  });

  const saveSupplier = async (req: Request, res: Response, existing: mongoose.HydratedDocument<Loose> | null) => {
    const { value, problems } = cleanSupplier(req.body || {}, LANGUAGE_CODES);
    if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
    const key = value.spsName ? spsKey(value.spsName) : '';
    const sameName = await Supplier.findOne({ _id: { $ne: existing?._id }, name: new RegExp(`^${escapeRegex(value.name)}$`, 'i') }, 'name').lean();
    if (sameName) return res.status(409).json({ message: 'Some fields need attention.', problems: { name: 'A supplier already has that name' } });
    if (key) {
      const sameSps = await Supplier.findOne({ _id: { $ne: existing?._id }, spsKey: key }, 'name').lean();
      if (sameSps) return res.status(409).json({ message: 'Some fields need attention.', problems: { spsName: `${sameSps.name} already has that SPS name` } });
    }
    const by = actor(req).name;
    const doc = existing || new Supplier({ createdBy: by });
    const active = typeof req.body?.active === 'boolean' ? req.body.active : (existing ? existing.active !== false : true);
    doc.set({ ...value, spsKey: key, active });
    doc.history.push({ at: new Date(), by, side: 'staff', action: existing ? 'edited' : 'added', changes: existing && existing.active !== active ? (active ? 'made active' : 'made inactive') : '' });
    await doc.save();
    // A supplier made inactive can't sign in either: its logins' sessions end now.
    if (existing && !active) await SupplierLogin.updateMany({ supplierId: String(doc._id) }, { $inc: { sessionVersion: 1 } });
    res.status(existing ? 200 : 201).json({ supplier: supplierView(doc.toObject()) });
  };

  router.post('/suppliers', authenticate, anyOf(SUPPLIER_POS.MANAGE_SUPPLIERS), async (req: Request, res: Response) => {
    try { await saveSupplier(req, res, null); } catch (error) { fail(res, 'add supplier', error, 'Could not save the supplier.'); }
  });
  router.put('/suppliers/:id', authenticate, anyOf(SUPPLIER_POS.MANAGE_SUPPLIERS), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Supplier not found.' });
    try {
      const s = await Supplier.findById(id);
      if (!s) return res.status(404).json({ message: 'Supplier not found.' });
      await saveSupplier(req, res, s as never);
    } catch (error) { fail(res, 'edit supplier', error, 'Could not save the supplier.'); }
  });

  // ── Logins ────────────────────────────────────────────────────────────────

  const emailLink = async (req: Request, login: mongoose.HydratedDocument<Loose>, supplierName: string, reset: boolean) => {
    const { token, fields } = newLink();
    login.set({ ...fields, invitedAt: new Date(), invitedBy: actor(req).name });
    await login.save();
    const link = `${siteBase(req)}/supplier/set-password?token=${encodeURIComponent(token)}`;
    const sent = await sendSupplierLink({ to: login.email, name: login.name, supplierName, lang: login.language || 'en', link, reset });
    return { sent, link };
  };

  router.post('/suppliers/:id/logins', authenticate, anyOf(SUPPLIER_POS.MANAGE_SUPPLIERS), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Supplier not found.' });
    try {
      const supplier = await Supplier.findById(id).lean();
      if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });
      const { value, problems } = cleanLogin({ language: supplier.language, ...(req.body || {}) }, LANGUAGE_CODES);
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      if (await SupplierLogin.countDocuments({ supplierId: id }) >= MAX_LOGINS_PER_SUPPLIER) {
        return res.status(409).json({ message: `A supplier has ${MAX_LOGINS_PER_SUPPLIER === 1 ? 'one login' : `up to ${MAX_LOGINS_PER_SUPPLIER} logins`}. Edit the one it has.` });
      }
      if (await SupplierLogin.exists({ email: value.email })) {
        return res.status(409).json({ message: 'Some fields need attention.', problems: { email: 'Another supplier login uses that email' } });
      }
      const login = new SupplierLogin({ supplierId: id, ...value });
      const { sent, link } = await emailLink(req, login as never, supplier.name, false);
      res.status(201).json({ login: loginView(login.toObject()), emailed: sent, ...(sent ? {} : { link }) });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return res.status(409).json({ message: 'Some fields need attention.', problems: { email: 'Another supplier login uses that email' } });
      fail(res, 'add login', error, 'Could not add the login.');
    }
  });

  const findLogin = async (req: Request, res: Response) => {
    const { id, lid } = scalarParams(req);
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(lid)) { res.status(404).json({ message: 'Login not found.' }); return null; }
    const [supplier, login] = await Promise.all([Supplier.findById(id).lean(), SupplierLogin.findById(lid)]);
    if (!supplier || !login || login.supplierId !== id) { res.status(404).json({ message: 'Login not found.' }); return null; }
    return { supplier, login };
  };

  router.put('/suppliers/:id/logins/:lid', authenticate, anyOf(SUPPLIER_POS.MANAGE_SUPPLIERS), validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await findLogin(req, res);
      if (!found) return;
      const { value, problems } = cleanLogin(req.body || {}, LANGUAGE_CODES);
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      if (value.email !== found.login.email && await SupplierLogin.exists({ email: value.email, _id: { $ne: found.login._id } })) {
        return res.status(409).json({ message: 'Some fields need attention.', problems: { email: 'Another supplier login uses that email' } });
      }
      // A new email is a new person's inbox: sessions on the old one end.
      if (value.email !== found.login.email) found.login.set({ sessionVersion: (found.login.sessionVersion || 0) + 1 });
      found.login.set(value);
      await found.login.save();
      res.json({ login: loginView(found.login.toObject()) });
    } catch (error) { fail(res, 'edit login', error, 'Could not save the login.'); }
  });

  router.post('/suppliers/:id/logins/:lid/invite', authenticate, anyOf(SUPPLIER_POS.MANAGE_SUPPLIERS), validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await findLogin(req, res);
      if (!found) return;
      if (found.login.active === false) return res.status(409).json({ message: 'Turn the login on first.' });
      const { sent, link } = await emailLink(req, found.login as never, found.supplier.name, Boolean(found.login.password));
      res.json({ login: loginView(found.login.toObject()), emailed: sent, ...(sent ? {} : { link }) });
    } catch (error) { fail(res, 'invite', error, 'Could not send the link.'); }
  });

  router.post('/suppliers/:id/logins/:lid/active', authenticate, anyOf(SUPPLIER_POS.MANAGE_SUPPLIERS), validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await findLogin(req, res);
      if (!found) return;
      const active = req.body?.active === true;
      found.login.set({ active, ...(active ? {} : { sessionVersion: (found.login.sessionVersion || 0) + 1, linkTokenHash: '', linkExpiresAt: null }) });
      await found.login.save();
      res.json({ login: loginView(found.login.toObject()) });
    } catch (error) { fail(res, 'login on/off', error, 'Could not save the login.'); }
  });

  router.post('/suppliers/:id/logins/:lid/unlock', authenticate, anyOf(SUPPLIER_POS.MANAGE_SUPPLIERS), validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await findLogin(req, res);
      if (!found) return;
      found.login.set({ loginAttempts: 0, lockUntil: null });
      await found.login.save();
      res.json({ login: loginView(found.login.toObject()) });
    } catch (error) { fail(res, 'unlock login', error, 'Could not unlock the login.'); }
  });

  // ── POs ───────────────────────────────────────────────────────────────────

  const suppliersById = async (ids: string[]) => {
    const list = await Supplier.find({ _id: { $in: [...new Set(ids)].filter((x) => mongoose.isValidObjectId(x)) } }).lean();
    return new Map(list.map((s) => [String(s._id), s as Loose]));
  };

  router.get('/pos', pageOpen, validateScalarRequest, async (req: Request, res: Response) => {
    const { status = 'open' } = scalarQuery(req) as { status?: string };
    try {
      const filter: Record<string, unknown> = status === 'all' ? {} : { status: ['open', 'closed', 'cancelled'].includes(status) ? status : 'open' };
      const pos = await SupplierPO.find(filter, '-history').sort({ updatedAt: -1 }).limit(3000).lean();
      const blocks = await SupplierBlock.find({ poId: { $in: pos.map((p) => String(p._id)) } }, 'poId lineId blockNumber size bundles sentAt updatedAt').lean();
      const byPo = new Map<string, Loose[]>();
      for (const b of blocks) byPo.set(b.poId, [...(byPo.get(b.poId) || []), b]);
      const suppliers = await suppliersById(pos.map((p) => p.supplierId));
      res.json({ pos: pos.map((po) => staffPoView(po, byPo.get(String(po._id)) || [], { supplier: suppliers.get(po.supplierId) })) });
    } catch (error) { fail(res, 'list POs', error, 'Could not load the POs.'); }
  });

  const poDetail = async (id: string, viewerId: string) => {
    const po = await SupplierPO.findById(id).lean();
    if (!po) return null;
    const [blocks, supplier] = await Promise.all([
      SupplierBlock.find({ poId: id }).sort({ firstSentAt: 1, createdAt: 1 }).lean(),
      Supplier.findById(po.supplierId).lean()
    ]);
    return staffPoView(po, blocks, { supplier, withBlocks: true, viewerId });
  };

  router.get('/pos/:id', pageOpen, validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'PO not found.' });
    try {
      const po = await poDetail(id, userIdOf(req));
      if (!po) return res.status(404).json({ message: 'PO not found.' });
      res.json({ po });
    } catch (error) { fail(res, 'PO', error, 'Could not load the PO.'); }
  });

  /** The buyer's name from their id (a person with the switches), else the person saving. */
  const buyerFor = async (req: Request, buyerId: string) => {
    if (buyerId && mongoose.isValidObjectId(buyerId)) {
      const u = await User.findById(buyerId, 'username displayName').lean();
      if (u) return { buyerId, buyerName: nameOf(u) };
    }
    return { buyerId: userIdOf(req), buyerName: actor(req).name };
  };

  const notifySupplier = async (req: Request, po: Loose) => {
    const logins = await SupplierLogin.find({ supplierId: po.supplierId, active: true, password: { $gt: '' } }).lean();
    const link = `${siteBase(req)}/supplier/po/${String(po._id)}`;
    const results = await Promise.all(logins.map((l) => sendPoAssigned({ to: l.email, lang: l.language || 'en', poNumber: po.poNumber, lines: po.lines, link, note: po.note || null })));
    return { emailed: results.filter(Boolean).length, logins: logins.length };
  };

  router.post('/pos', authenticate, anyOf(SUPPLIER_POS.MANAGE_POS), async (req: Request, res: Response) => {
    const body = req.body || {};
    if (!mongoose.isValidObjectId(body.id)) return res.status(400).json({ message: 'The PO has no id. Reload the page and try again.' });
    try {
      const again = await SupplierPO.findById(body.id).lean();
      if (again) return res.json({ po: await poDetail(String(again._id), userIdOf(req)), alreadySaved: true });
      const { value, problems } = cleanPo(body, { newId, today: todayOf() });
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      const existing = await SupplierPO.findOne({ poNumber: value.poNumber }, 'poNumber').lean();
      if (existing) return res.status(409).json({ message: `PO ${value.poNumber} is already here.`, existingId: String(existing._id), problems: { poNumber: 'This PO # is already here' } });
      const supplier = mongoose.isValidObjectId(value.supplierId) ? await Supplier.findById(value.supplierId).lean() : null;
      if (!supplier || supplier.active === false) return res.status(400).json({ message: 'Some fields need attention.', problems: { supplierId: 'Choose an active supplier' } });
      const by = actor(req).name;
      const note = await makeNote(value.note, 'en', await readerLanguages(value.supplierId), by);
      const po = await SupplierPO.create({
        _id: body.id, poNumber: value.poNumber, supplierId: value.supplierId, supplierName: supplier.name, shipTo: value.shipTo, readyBy: value.readyBy,
        ...(await buyerFor(req, value.buyerId)), lines: value.lines.map((l) => ({ _id: l.id, ...l })), note,
        source: body.source === 'sps' ? 'sps' : 'typed', status: 'open', assignedAt: new Date(), createdBy: by,
        history: [{ at: new Date(), by, side: 'staff', action: 'added', changes: `assigned to ${supplier.name}${body.source === 'sps' ? ' · filled from SPS' : ''}` }]
      });
      const notified = body.notify === false ? { emailed: 0, logins: 0 } : await notifySupplier(req, po.toObject());
      res.status(201).json({ po: await poDetail(String(po._id), userIdOf(req)), notified });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const dup = await SupplierPO.findById(body.id).lean() || await SupplierPO.findOne({ poNumber: poKey(body.poNumber) }).lean();
        if (dup && String(dup._id) === String(body.id)) return res.json({ po: await poDetail(String(dup._id), userIdOf(req)), alreadySaved: true });
        if (dup) return res.status(409).json({ message: `PO ${dup.poNumber} is already here.`, existingId: String(dup._id), problems: { poNumber: 'This PO # is already here' } });
      }
      fail(res, 'add PO', error, 'Could not save the PO.');
    }
  });

  router.put('/pos/:id', authenticate, anyOf(SUPPLIER_POS.MANAGE_POS), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'PO not found.' });
    try {
      const po = await SupplierPO.findById(id);
      if (!po) return res.status(404).json({ message: 'PO not found.' });
      if (po.status === 'cancelled') return res.status(409).json({ message: 'A cancelled PO can’t be changed. Reopen it first.' });
      const { value, problems } = cleanPo({ ...req.body, poNumber: req.body?.poNumber ?? po.poNumber }, { newId, today: todayOf() });
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      const blocks = await SupplierBlock.find({ poId: id }, 'lineId sentAt').lean();
      if (value.poNumber !== po.poNumber) {
        if (blocks.length) return res.status(409).json({ message: 'Blocks were offered on this PO, so its number can’t change.', problems: { poNumber: 'Can’t change once blocks are offered' } });
        if (await SupplierPO.exists({ poNumber: value.poNumber, _id: { $ne: id } })) return res.status(409).json({ message: 'Some fields need attention.', problems: { poNumber: 'This PO # is already here' } });
      }
      const reassigned = value.supplierId !== po.supplierId;
      if (reassigned && blocks.length) return res.status(409).json({ message: 'The supplier already offered blocks on this PO, so it can’t move to another supplier. Cancel it and add a new one.', problems: { supplierId: 'Can’t change once blocks are offered' } });
      const supplier = reassigned ? await Supplier.findById(value.supplierId).lean() : await Supplier.findById(po.supplierId).lean();
      if (!supplier || (reassigned && supplier.active === false)) return res.status(400).json({ message: 'Some fields need attention.', problems: { supplierId: 'Choose an active supplier' } });
      const byLine: Record<string, number> = {};
      for (const b of blocks) byLine[b.lineId] = (byLine[b.lineId] || 0) + 1;
      const before = linesOf(po.toObject());
      const removal = lineRemovalProblem(before, value.lines, byLine);
      if (removal) return res.status(409).json({ message: removal, problems: { lines: removal } });
      const buyer = await buyerFor(req, value.buyerId || po.buyerId || '');
      // An edit that doesn't send the note keeps it.
      const noteText = req.body?.note === undefined ? (po.note?.text || '') : value.note.trim();
      const noteChanged = (po.note?.text || '') !== noteText;
      const by = actor(req).name;
      const changes = poChanges(
        { shipTo: po.shipTo, readyBy: po.readyBy, supplierName: po.supplierName, buyerName: po.buyerName, lines: before, note: po.note?.text || '' },
        { shipTo: value.shipTo, readyBy: value.readyBy, supplierName: supplier.name, buyerName: buyer.buyerName, lines: value.lines, note: noteText }
      );
      if (value.poNumber !== po.poNumber) changes.unshift(`PO # ${po.poNumber} → ${value.poNumber}`);
      if (!changes.length) return res.json({ po: await poDetail(id, userIdOf(req)), unchanged: true });
      po.set({
        poNumber: value.poNumber, supplierId: value.supplierId, supplierName: supplier.name, shipTo: value.shipTo, readyBy: value.readyBy, ...buyer,
        lines: value.lines.map((l) => ({ _id: l.id, ...l })),
        ...(noteChanged ? { note: await makeNote(noteText, 'en', await readerLanguages(value.supplierId), by) } : {}),
        ...(reassigned ? { assignedAt: new Date() } : {})
      });
      po.history.push({ at: new Date(), by, side: 'staff', action: 'edited', changes: changes.join(', ') });
      await po.save();
      // Block lines copied the material when offered; a rename follows to blocks not yet sent.
      for (const l of value.lines) {
        await SupplierBlock.updateMany({ poId: id, lineId: l.id, sentAt: null }, { $set: { material: l.material, thickness: l.thickness, finish: l.finish } });
      }
      const notified = reassigned ? await notifySupplier(req, po.toObject()) : null;
      res.json({ po: await poDetail(id, userIdOf(req)), notified });
    } catch (error) {
      if (isVersionError(error)) return res.status(409).json({ message: 'Someone else just changed this PO. Reload it and try again.' });
      fail(res, 'edit PO', error, 'Could not save the PO.');
    }
  });

  router.post('/pos/:id/status', authenticate, anyOf(SUPPLIER_POS.MANAGE_POS), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const status = String(req.body?.status || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'PO not found.' });
    if (!['open', 'closed', 'cancelled'].includes(status)) return res.status(400).json({ message: 'Choose open, closed or cancelled.' });
    if (status === 'cancelled' && !reason) return res.status(400).json({ message: 'Say why it’s being cancelled.', problems: { reason: 'Say why it’s being cancelled' } });
    try {
      const po = await SupplierPO.findById(id);
      if (!po) return res.status(404).json({ message: 'PO not found.' });
      if (po.status === status) return res.json({ po: await poDetail(id, userIdOf(req)), unchanged: true });
      const by = actor(req).name;
      const action = status === 'open' ? 'reopened' : status;
      po.set({ status, statusReason: status === 'open' ? '' : reason });
      po.history.push({ at: new Date(), by, side: 'staff', action, changes: reason });
      await po.save();
      res.json({ po: await poDetail(id, userIdOf(req)) });
    } catch (error) { fail(res, 'PO status', error, 'Could not save the PO.'); }
  });

  router.post('/pos/:id/notify', authenticate, anyOf(SUPPLIER_POS.MANAGE_POS), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'PO not found.' });
    try {
      const po = await SupplierPO.findById(id).lean();
      if (!po) return res.status(404).json({ message: 'PO not found.' });
      if (po.status !== 'open') return res.status(409).json({ message: 'Only an open PO is emailed.' });
      const notified = await notifySupplier(req, po);
      if (!notified.logins) return res.status(409).json({ message: 'The supplier has no login that’s set up yet. Send their invite first (Suppliers tab).' });
      await SupplierPO.updateOne({ _id: id }, { $push: { history: { at: new Date(), by: actor(req).name, side: 'staff', action: 'emailed the supplier', changes: '' } } });
      res.json({ notified });
    } catch (error) { fail(res, 'notify', error, 'Could not email the supplier.'); }
  });

  /** "Fill from SPS": the import's lines for a PO # (src/models/InventoryTransitShipment.ts). */
  router.get('/sps-lookup', authenticate, anyOf(SUPPLIER_POS.MANAGE_POS), validateScalarRequest, async (req: Request, res: Response) => {
    const po = poKey((scalarQuery(req) as { po?: string }).po);
    if (!po) return res.status(400).json({ message: 'Enter a PO #.' });
    try {
      const [shipments, existing] = await Promise.all([
        InventoryTransitShipment.find({ poNumber: new RegExp(`^\\s*${escapeRegex(po)}\\s*$`, 'i') }).sort({ active: -1, importedAt: -1 }).limit(50).lean(),
        SupplierPO.findOne({ poNumber: po }, 'poNumber').lean()
      ]);
      if (!shipments.length) return res.json({ found: false, existingId: existing ? String(existing._id) : null });
      const lines = new Map<string, { material: string; slabs: number }>();
      let supplierName = '';
      let location = '';
      let eta = '';
      for (const s of shipments) {
        location = location || s.location || '';
        for (const l of s.lines || []) {
          supplierName = supplierName || String(l.supplier || '').trim();
          const material = String(l.product || '').trim();
          if (!material) continue;
          const cur = lines.get(material.toLowerCase()) || { material, slabs: 0 };
          cur.slabs += Number(l.slabs) || 0;
          lines.set(material.toLowerCase(), cur);
          const when = l.etaDate || l.poEtaDate;
          if (when && !eta) eta = new Date(when).toISOString().slice(0, 10);
        }
      }
      const match = supplierName ? await Supplier.findOne({ spsKey: spsKey(supplierName) }, 'name').lean() : null;
      res.json({
        found: true, poNumber: po, supplierName, supplierId: match ? String(match._id) : '', location, eta,
        lines: [...lines.values()].filter((l) => l.slabs > 0), existingId: existing ? String(existing._id) : null
      });
    } catch (error) { fail(res, 'SPS lookup', error, 'Could not read the SPS import.'); }
  });

  // ── Blocks ────────────────────────────────────────────────────────────────

  const blockDetail = async (b: Loose, viewerId: string) => {
    const [po, supplier] = await Promise.all([SupplierPO.findById(b.poId, '-history').lean(), Supplier.findById(b.supplierId).lean()]);
    return staffBlockView(b, { viewerId, supplier, po });
  };

  router.get('/blocks', pageOpen, validateScalarRequest, async (req: Request, res: Response) => {
    const { queue = 'review' } = scalarQuery(req) as { queue?: string };
    try {
      const status = queue === 'final' ? 'final' : 'review';
      const blocks = await SupplierBlock.find({ 'bundles.status': status }, '-history').sort({ sentAt: 1 }).limit(1000).lean();
      const [pos, suppliers] = await Promise.all([
        SupplierPO.find({ _id: { $in: [...new Set(blocks.map((b) => b.poId))] } }, '-history').lean(),
        suppliersById(blocks.map((b) => b.supplierId))
      ]);
      const poById = new Map(pos.map((p) => [String(p._id), p]));
      res.json({ blocks: blocks.map((b) => staffBlockView(b, { viewerId: userIdOf(req), supplier: suppliers.get(b.supplierId), po: poById.get(b.poId) })) });
    } catch (error) { fail(res, 'queue', error, 'Could not load the blocks.'); }
  });

  router.get('/blocks/:id', pageOpen, validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Block not found.' });
    try {
      const b = await SupplierBlock.findById(id).lean();
      if (!b || !b.sentAt) return res.status(404).json({ message: 'Block not found.' });
      res.json({ block: await blockDetail(b, userIdOf(req)) });
    } catch (error) { fail(res, 'block', error, 'Could not load the block.'); }
  });

  router.post('/blocks/:id/decide', authenticate, anyOf(SUPPLIER_POS.REVIEW, SUPPLIER_POS.FINAL), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const step = Number(req.body?.step) as Step;
    if (step !== 1 && step !== 2) return res.status(400).json({ message: 'Say which step: 1 or 2.' });
    if (!has(req, step === 1 ? SUPPLIER_POS.REVIEW : SUPPLIER_POS.FINAL)) {
      return res.status(403).json({ message: step === 1 ? 'You can’t review supplier blocks.' : 'You can’t give final approval.' });
    }
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Block not found.' });
    const decisions: DecisionInput[] = (Array.isArray(req.body?.decisions) ? req.body.decisions : []).slice(0, 50).map((d: Loose) => ({
      bundleId: String(d?.bundleId || ''), decision: String(d?.decision || '') as DecisionInput['decision'],
      reason: d?.reason ? String(d.reason) : '', comment: String(d?.comment || '').trim().slice(0, 500)
    }));
    try {
      const block = await SupplierBlock.findById(id);
      if (!block || !block.sentAt) return res.status(404).json({ message: 'Block not found.' });
      const po = await SupplierPO.findById(block.poId, 'status poNumber').lean();
      if (po?.status === 'cancelled') return res.status(409).json({ message: 'This PO was cancelled.' });
      const who = actor(req);
      const bundles = blockLike(block.toObject()).bundles;
      const problem = decisionProblem(step, bundles, decisions, who);
      if (problem) return res.status(409).json({ message: problem });
      const at = new Date();
      const readers = await readerLanguages(block.supplierId);
      const comments = new Map<string, Awaited<ReturnType<typeof makeNote>>>();
      await Promise.all(decisions.filter((d) => d.decision !== 'approve' && d.comment).map(async (d) => {
        comments.set(d.bundleId, await makeNote(d.comment || '', 'en', readers, who.name));
      }));
      const note = await makeNote(String(req.body?.note || ''), 'en', readers, who.name);
      const next = block.bundles.map((raw) => {
        const plain = toPlain(raw);
        const d = decisions.find((x) => x.bundleId === plain._id);
        if (!d) return plain;
        const after = applyDecision(bundles.find((x) => x.id === plain._id)!, step, d, who, at, comments.get(d.bundleId) || null);
        return { ...plain, status: after.status, step1: after.step1, step2: after.step2, reason: after.reason, comment: after.comment };
      });
      block.set({ bundles: next });
      if (note) block.set({ decisionNote: note });
      block.set({ stage: blockStage({ bundles: blockLike(block.toObject()).bundles, sentAt: block.sentAt }) });
      const counts = { approve: 0, reject: 0, retake: 0 };
      for (const d of decisions) counts[d.decision] += 1;
      const summary = [counts.approve && `${counts.approve} ${step === 1 ? 'approved' : 'final approved'}`, counts.reject && `${counts.reject} rejected`, counts.retake && `${counts.retake} new photo asked`].filter(Boolean).join(', ');
      block.history.push({ at, by: who.name, side: 'staff', action: step === 1 ? 'step 1' : 'step 2', changes: summary + (note ? ` · note: ${note.text}` : '') });
      await block.save();

      // The supplier hears about what needs them (a rejection, a new photo) and
      // about final approvals; a step-1 approval alone shows in the portal.
      const decided = decisions.map((d) => next.find((b) => b._id === d.bundleId)).filter(Boolean) as Loose[];
      const tell = step === 2 || counts.reject || counts.retake;
      let emailed = 0;
      if (tell) {
        const recipients = await supplierRecipients(block.supplierId);
        const link = `${siteBase(req)}/supplier/block/${String(block._id)}`;
        const items = decided.filter((b) => step === 2 || b.status !== 'final').map((b) => ({ n: b.n, status: b.status, reason: b.reason, comment: b.comment, photoUrl: b.photoUrl }));
        if (items.length) {
          const sent = await Promise.all(recipients.map((r) => sendDecisions({ to: r.to, lang: r.lang, blockNumber: block.blockNumber, poNumber: block.poNumber, bundles: items, note, link: r.portal ? link : undefined })));
          emailed = sent.filter(Boolean).length;
        }
      }
      res.json({ block: await blockDetail(block.toObject(), who.id), emailed });
    } catch (error) {
      if (isVersionError(error)) return res.status(409).json({ message: 'Someone else just decided on this block. Reload it to see where it is.' });
      fail(res, 'decide', error, 'Could not save the decisions.');
    }
  });

  router.post('/blocks/:id/unlock', authenticate, anyOf(SUPPLIER_POS.UNLOCK), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Block not found.' });
    const ids: string[] = (Array.isArray(req.body?.bundleIds) ? req.body.bundleIds : []).map(String).slice(0, 50);
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    try {
      const block = await SupplierBlock.findById(id);
      if (!block || !block.sentAt) return res.status(404).json({ message: 'Block not found.' });
      const po = await SupplierPO.findById(block.poId, 'status').lean();
      if (po?.status !== 'open') return res.status(409).json({ message: 'Reopen the PO first.' });
      const problem = unlockProblem(blockLike(block.toObject()).bundles, ids, reason);
      if (problem) return res.status(problem.startsWith('Say why') ? 400 : 409).json({ message: problem, problems: problem.startsWith('Say why') ? { reason: problem } : undefined });
      const who = actor(req);
      const at = new Date();
      const next = block.bundles.map((raw) => {
        const plain = toPlain(raw);
        return ids.includes(plain._id) ? { ...plain, status: 'unlocked', unlock: { by: who.name, at, reason } } : plain;
      });
      block.set({ bundles: next });
      block.set({ stage: blockStage({ bundles: blockLike(block.toObject()).bundles, sentAt: block.sentAt }) });
      const list = next.filter((b) => ids.includes(b._id)).map((b) => String(b.n)).join(', ');
      block.history.push({ at, by: who.name, side: 'staff', action: 'unlocked', changes: `bundle${ids.length === 1 ? '' : 's'} ${list} · ${reason}` });
      await block.save();
      const readers = await readerLanguages(block.supplierId);
      const why = await makeNote(reason, 'en', readers, who.name);
      const recipients = await supplierRecipients(block.supplierId);
      const link = `${siteBase(req)}/supplier/block/${String(block._id)}`;
      await Promise.all(recipients.map((r) => sendUnlocked({ to: r.to, lang: r.lang, blockNumber: block.blockNumber, poNumber: block.poNumber, list, reason: why, link: r.portal ? link : undefined })));
      res.json({ block: await blockDetail(block.toObject(), who.id) });
    } catch (error) {
      if (isVersionError(error)) return res.status(409).json({ message: 'Someone else just changed this block. Reload it and try again.' });
      fail(res, 'unlock', error, 'Could not unlock the bundles.');
    }
  });

  // Purchasing entering a block for its supplier (photos they emailed / sent on WhatsApp).
  router.use(createBlockEntryRoutes({ authenticate, processBase64Image }));

  // ── Sales: Incoming material ──────────────────────────────────────────────

  router.get('/incoming', authenticate, anyOf(SUPPLIER_POS.INCOMING), async (_req: Request, res: Response) => {
    try {
      const since = new Date(Date.now() - 120 * 24 * 3_600_000);
      const pos = await SupplierPO.find({ status: { $ne: 'cancelled' }, $or: [{ status: 'open' }, { updatedAt: { $gte: since } }] }, 'shipTo readyBy status').lean();
      const poById = new Map(pos.map((p) => [String(p._id), p]));
      const blocks = await SupplierBlock.find({ poId: { $in: [...poById.keys()] }, 'bundles.status': 'approved' }, 'poId material thickness finish blockNumber size bundles').lean();
      const items = blocks.map((b) => incomingView(b, poById.get(b.poId)!)).filter((x) => x.bundles.length)
        .sort((a, b) => String(b.approvedAt || '').localeCompare(String(a.approvedAt || '')));
      res.json({ items });
    } catch (error) { fail(res, 'incoming', error, 'Could not load the incoming material.'); }
  });

  return router;
}
