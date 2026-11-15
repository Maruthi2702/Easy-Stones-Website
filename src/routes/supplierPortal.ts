import type { Request, RequestHandler, Response } from 'express';
import * as staffData from '../db/staff/index.ts';
import express from 'express';
import mongoose from 'mongoose';
import { suppliersStore, type HistoryLine } from '../db/suppliers/index.ts';
import { isId, newId } from '../db/ids.ts';
import { validateScalarRequest, scalarParams } from '../server/scalarRequest.ts';
import {
  STARTING_BUNDLES, MAX_BUNDLES, supplierMayEdit, slabsProblem, parseSize, cleanBlockNumber, sendProblems, applySend,
  withNewPhoto, blockStage, passwordProblem
} from '../utils/supplierBlocks.ts';
import { LANGUAGE_CODES } from '../utils/supplierI18n.ts';
import {
  authenticateSupplier, supplierOf, startSupplierSession, endSupplierSession, checkPassword, hashLinkToken, newLink, isLocked
} from '../services/supplierSession.ts';
import { makeNote } from '../services/translate.ts';
import { sendSupplierLink, sendBlockOffered } from '../services/supplierEmails.ts';
import { supplierPoView, supplierBlockView, blockLike } from '../services/supplierViews.ts';
import type { Loose } from '../types/records.ts';

/**
 * The supplier portal's API (2026-11-07) — the supplier's side of Supplier
 * POs. Its own sign-in (src/services/supplierSession.ts): nothing here takes a
 * staff token, and no staff route takes this one. Every read and write is
 * limited to the signed-in login's own supplier.
 *
 *   POST /sign-in { email, password }       POST /sign-out
 *   GET  /link/:token                        is this invite / reset link still good?
 *   POST /link { token, password }           choose a password and sign in
 *   POST /forgot { email }                   email a reset link (always answers the same)
 *   GET  /me, PATCH /me { language }
 *   GET  /pos                                my POs, grouped by what needs me
 *   GET  /pos/:id                            one PO with its blocks
 *   POST /pos/:id/blocks { id, lineId }      start a block (the screen's own id: a repeat answers alreadySaved)
 *   GET  /blocks/:id
 *   PUT  /blocks/:id { blockNumber, length, height, unit, note }
 *   POST /blocks/:id/bundles { id }          add a bundle
 *   PUT  /blocks/:id/bundles/:bid { slabs }
 *   DELETE /blocks/:id/bundles/:bid          a bundle never sent
 *   POST /blocks/:id/bundles/:bid/photo { data }   the photo, the moment it's taken
 *   POST /blocks/:id/send                    send for review
 *   DELETE /blocks/:id                       a block never sent
 *
 *   app.use('/api/supplier-portal', createSupplierPortalRouter({ jwtSecret, loginLimiter, processBase64Image }));
 */

const FORGOT_EVERY_MS = 2 * 60 * 1000;
const MAX_PHOTO_CHARS = 15_000_000;
const siteBase = (req: Request) => (process.env.FRONTEND_URL || req.get('origin') || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const supplierLine = (by: string, action: string, changes = ''): HistoryLine => ({ at: new Date(), by, side: 'supplier', action, changes });

export default function createSupplierPortalRouter({ jwtSecret, loginLimiter, processBase64Image }: {
  jwtSecret: string;
  loginLimiter: RequestHandler;
  processBase64Image: (data: string, folder?: string, maxSide?: number) => Promise<unknown>;
}) {
  const router = express.Router();
  const auth = authenticateSupplier(jwtSecret);
  const fail = (res: Response, what: string, error: unknown) => {
    console.error(`[supplier-portal] ${what} failed:`, error);
    res.status(500).json({ message: 'Something went wrong. Try again.', code: 'serverError' });
  };
  const meOf = async (loginId: string) => {
    const store = await suppliersStore();
    const login = await store.loginById(loginId);
    const supplier = login ? await store.supplierById(login.supplierId) : null;
    return login ? { name: login.name, email: login.email, language: login.language || 'en', supplierName: supplier?.name || '' } : null;
  };

  // ── Sign in ───────────────────────────────────────────────────────────────

  router.post('/sign-in', loginLimiter, async (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ message: 'Enter your email and password.', code: 'wrongPassword' });
    try {
      const store = await suppliersStore();
      const login = await store.loginByEmail(email);
      if (!login) return res.status(401).json({ message: 'That email and password don’t match.', code: 'wrongPassword' });
      const supplier = await store.supplierById(login.supplierId);
      const result = await checkPassword(login as never, password);
      if (result === 'locked') return res.status(423).json({ message: 'Too many tries. Try again in 15 minutes.', code: 'locked' });
      if (result === 'wrong') return res.status(401).json({ message: 'That email and password don’t match.', code: 'wrongPassword' });
      if (result === 'off' || !supplier || supplier.active === false) return res.status(403).json({ message: 'This login is turned off.', code: 'loginOff' });
      // (The answer the check above left on the login is stale: read the login again for its session version.)
      const signed = await store.updateLogin(String(login._id), { loginAttempts: 0, lockUntil: null, lastLoginAt: new Date(), lastSeenAt: new Date() });
      startSupplierSession(res, (signed || login) as never, jwtSecret);
      res.json({ me: await meOf(String(login._id)) });
    } catch (error) { fail(res, 'sign-in', error); }
  });

  router.post('/sign-out', (_req: Request, res: Response) => { endSupplierSession(res); res.json({ ok: true }); });

  const loginForLink = async (token: unknown) => {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const login = await (await suppliersStore()).loginByLinkHash(hashLinkToken(token));
    if (!login || !login.linkExpiresAt || new Date(login.linkExpiresAt).getTime() <= Date.now() || login.active === false) return null;
    return login;
  };

  router.get('/link/:token', loginLimiter, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const login = await loginForLink(scalarParams(req).token);
      if (!login) return res.status(410).json({ message: 'This link has expired or was already used.', code: 'linkBad' });
      res.json({ name: login.name, email: login.email, language: login.language || 'en', reset: Boolean(login.password) });
    } catch (error) { fail(res, 'link', error); }
  });

  router.post('/link', loginLimiter, async (req: Request, res: Response) => {
    const password = req.body?.password;
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ message: 'At least 8 characters.', code: 'passwordShort' });
    try {
      const login = await loginForLink(req.body?.token);
      if (!login) return res.status(410).json({ message: 'This link has expired or was already used.', code: 'linkBad' });
      const saved = await (await suppliersStore()).updateLogin(String(login._id), {
        password, linkTokenHash: '', linkExpiresAt: null, loginAttempts: 0, lockUntil: null,
        sessionVersion: (login.sessionVersion || 0) + 1, lastLoginAt: new Date(), lastSeenAt: new Date()
      });
      startSupplierSession(res, (saved || login) as never, jwtSecret);
      res.json({ me: await meOf(String(login._id)) });
    } catch (error) { fail(res, 'choose password', error); }
  });

  // Always the same answer, so it can't be used to find out which emails have a login.
  router.post('/forgot', loginLimiter, async (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    try {
      const store = await suppliersStore();
      const login = email ? await store.loginByEmail(email, { activeOnly: true }) : null;
      const recent = login?.linkExpiresAt && new Date(login.linkExpiresAt).getTime() - (7 * 24 * 3_600_000) + FORGOT_EVERY_MS > Date.now();
      if (login && !recent && !isLocked(login)) {
        const supplier = await store.supplierById(login.supplierId);
        if (supplier && supplier.active !== false) {
          const { token, fields } = newLink();
          await store.updateLogin(String(login._id), fields);
          await sendSupplierLink({ to: login.email, name: login.name, supplierName: supplier.name, lang: login.language || 'en', link: `${siteBase(req)}/supplier/set-password?token=${encodeURIComponent(token)}`, reset: true });
        }
      }
      res.json({ ok: true });
    } catch (error) { fail(res, 'forgot', error); }
  });

  // ── Me ────────────────────────────────────────────────────────────────────

  router.get('/me', auth, async (req: Request, res: Response) => {
    try { res.json({ me: await meOf(supplierOf(req).loginId) }); } catch (error) { fail(res, 'me', error); }
  });
  router.patch('/me', auth, async (req: Request, res: Response) => {
    const language = String(req.body?.language || '');
    if (!LANGUAGE_CODES.includes(language)) return res.status(400).json({ message: 'Choose a language.' });
    try {
      await (await suppliersStore()).updateLogin(supplierOf(req).loginId, { language });
      res.json({ me: await meOf(supplierOf(req).loginId) });
    } catch (error) { fail(res, 'language', error); }
  });

  // ── POs ───────────────────────────────────────────────────────────────────

  router.get('/pos', auth, async (req: Request, res: Response) => {
    const { supplierId } = supplierOf(req);
    try {
      const since = new Date(Date.now() - 90 * 24 * 3_600_000);
      const store = await suppliersStore();
      const pos = await store.listPos({ supplierId, openOrSince: since, limit: 1000 });
      const blocks = await store.blocksOfPos(pos.map((p) => String(p._id)), { supplierId });
      const byPo = new Map<string, Loose[]>();
      for (const b of blocks) byPo.set(b.poId, [...(byPo.get(b.poId) || []), b]);
      res.json({ pos: pos.map((p) => supplierPoView(p, byPo.get(String(p._id)) || [])) });
    } catch (error) { fail(res, 'POs', error); }
  });

  /** The PO if it's this supplier's; never says whether another supplier's exists. */
  const myPo = async (req: Request, id: string) => {
    if (!isId(id)) return null;
    const po = await (await suppliersStore()).poById(id, { history: false });
    return po && po.supplierId === supplierOf(req).supplierId ? po : null;
  };

  router.get('/pos/:id', auth, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const po = await myPo(req, scalarParams(req).id!);
      if (!po) return res.status(404).json({ message: 'PO not found.' });
      const blocks = await (await suppliersStore()).blocksOfPo(String(po._id), { supplierId: supplierOf(req).supplierId, order: 'created' });
      res.json({ po: supplierPoView(po, blocks, true) });
    } catch (error) { fail(res, 'PO', error); }
  });

  // ── Blocks ────────────────────────────────────────────────────────────────

  router.post('/pos/:id/blocks', auth, validateScalarRequest, async (req: Request, res: Response) => {
    const me = supplierOf(req);
    const blockId = String(req.body?.id || '');
    const lineId = String(req.body?.lineId || '');
    if (!isId(blockId)) return res.status(400).json({ message: 'Reload the page and try again.' });
    try {
      const store = await suppliersStore();
      const again = await store.blockById(blockId);
      if (again) {
        if (again.supplierId !== me.supplierId) return res.status(409).json({ message: 'Reload the page and try again.' });
        return res.json({ block: supplierBlockView(again), alreadySaved: true });
      }
      const po = await myPo(req, scalarParams(req).id!);
      if (!po) return res.status(404).json({ message: 'PO not found.' });
      if (po.status !== 'open') return res.status(409).json({ message: 'This PO is closed.', code: po.status === 'cancelled' ? 'poCancelled' : 'poClosed' });
      const line = ((po.lines || []) as Loose[]).find((l) => String(l._id) === lineId);
      if (!line) return res.status(400).json({ message: 'Choose a material of the PO.' });
      const bundles = Array.from({ length: STARTING_BUNDLES }, (_, i) => ({ _id: newId(), n: i + 1, slabs: null, status: 'draft' }));
      const block = await store.createBlock({
        _id: blockId, poId: String(po._id), poNumber: po.poNumber, supplierId: me.supplierId, lineId,
        material: line.material, thickness: line.thickness || '', finish: line.finish || '', bundles, stage: 'draft', createdBy: me.name,
        history: [supplierLine(me.name, 'started')]
      });
      res.status(201).json({ block: supplierBlockView(block, po) });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const dup = await (await suppliersStore()).blockById(blockId);
        if (dup && dup.supplierId === me.supplierId) return res.json({ block: supplierBlockView(dup), alreadySaved: true });
      }
      fail(res, 'start block', error);
    }
  });

  /** The block if it's this supplier's, with its PO. */
  const myBlock = async (req: Request) => {
    const id = scalarParams(req).id!;
    if (!isId(id)) return null;
    const store = await suppliersStore();
    const block = await store.blockById(id);
    if (!block || block.supplierId !== supplierOf(req).supplierId) return null;
    const po = await store.poById(block.poId, { history: false });
    return po ? { block, po, store } : null;
  };
  /** Saves a change to the block (its stage follows from what it holds) and answers with the block; false if it moved on meanwhile. */
  const answer = async (res: Response, found: { block: Loose; po: Loose; store: Awaited<ReturnType<typeof suppliersStore>> }, set: Loose, add: HistoryLine[] = [], sentAt: unknown = found.block.sentAt) => {
    const merged = { ...found.block, ...set };
    const saved = await found.store.updateBlock(String(found.block._id), found.block.__v, { ...set, stage: blockStage({ bundles: blockLike(merged).bundles, sentAt: sentAt as string | Date | null | undefined }) }, add);
    if (!saved) { versionClash(res); return null; }
    res.json({ block: supplierBlockView(saved, found.po) });
    return saved;
  };
  const versionClash = (res: Response) => res.status(409).json({ message: 'This block just changed. Reload it and try again.', code: 'serverError' });
  /** The supplier may change the block while it's a draft or something on it waits for them. */
  const mayChange = (block: Loose, po: Loose) => po.status === 'open' && (!block.sentAt || (block.bundles || []).some(supplierMayEdit));

  router.get('/blocks/:id', auth, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await myBlock(req);
      if (!found) return res.status(404).json({ message: 'Block not found.' });
      res.json({ block: supplierBlockView(found.block, found.po) });
    } catch (error) { fail(res, 'block', error); }
  });

  router.put('/blocks/:id', auth, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await myBlock(req);
      if (!found) return res.status(404).json({ message: 'Block not found.' });
      const { block, po } = found;
      if (!mayChange(block, po)) return res.status(409).json({ message: 'This block is with Easy Stones now.', code: 'lockNote' });
      const body = req.body || {};
      const patch: Loose = {};
      if (body.blockNumber !== undefined) patch.blockNumber = cleanBlockNumber(body.blockNumber);
      if (body.length !== undefined || body.height !== undefined || body.unit !== undefined) {
        const typed = String(body.length ?? '') + String(body.height ?? '');
        patch.size = typed.trim() ? parseSize(body.length, body.height, body.unit) : null;
        if (typed.trim() && !patch.size) return res.status(400).json({ message: 'Enter the size.', code: 'needSize', problems: { size: 'needSize' } });
      }
      if (body.note !== undefined) {
        const me = supplierOf(req);
        const text = String(body.note || '').trim();
        if (text !== (block.note?.text || '')) patch.note = await makeNote(text, me.language, ['en'], me.name);
      }
      await answer(res, found, patch);
    } catch (error) { fail(res, 'edit block', error); }
  });

  router.post('/blocks/:id/bundles', auth, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await myBlock(req);
      if (!found) return res.status(404).json({ message: 'Block not found.' });
      const { block, po } = found;
      if (po.status !== 'open') return res.status(409).json({ message: 'This PO is closed.', code: 'poClosed' });
      const id = String(req.body?.id || '');
      const have = block.bundles as Loose[];
      if (mongoose.isValidObjectId(id) && have.some((b) => b._id === id)) return res.json({ block: supplierBlockView(block, po), alreadySaved: true });
      if (have.length >= MAX_BUNDLES) return res.status(409).json({ message: `A block has up to ${MAX_BUNDLES} bundles.` });
      const n = Math.max(0, ...have.map((b) => b.n)) + 1;
      const added = { _id: mongoose.isValidObjectId(id) ? id : newId(), n, slabs: null, status: 'draft' };
      await answer(res, found, { bundles: [...have, added] }, block.sentAt ? [supplierLine(supplierOf(req).name, 'added a bundle', `bundle ${n}`)] : []);
    } catch (error) { fail(res, 'add bundle', error); }
  });

  const findBundle = (block: Loose, bid: string) => (block.bundles as Loose[]).find((b) => b._id === bid);

  router.put('/blocks/:id/bundles/:bid', auth, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await myBlock(req);
      if (!found) return res.status(404).json({ message: 'Block not found.' });
      const { block, po } = found;
      const bundle = findBundle(block, scalarParams(req).bid!);
      if (!bundle) return res.status(404).json({ message: 'Bundle not found.' });
      if (po.status !== 'open' || !supplierMayEdit(bundle)) return res.status(409).json({ message: 'This bundle is locked.', code: 'lockNote' });
      const slabs = req.body?.slabs;
      if (slabs !== null && slabsProblem(slabs)) return res.status(400).json({ message: 'How many slabs?', code: 'needSlabs' });
      await answer(res, found, { bundles: (block.bundles as Loose[]).map((b) => (b === bundle ? { ...b, slabs: slabs === null ? null : Number(slabs) } : b)) });
    } catch (error) { fail(res, 'slabs', error); }
  });

  router.delete('/blocks/:id/bundles/:bid', auth, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await myBlock(req);
      if (!found) return res.status(404).json({ message: 'Block not found.' });
      const { block, po } = found;
      const bundle = findBundle(block, scalarParams(req).bid!);
      if (!bundle) return res.json({ block: supplierBlockView(block, po), alreadyRemoved: true });
      if (bundle.status !== 'draft' || bundle.round) return res.status(409).json({ message: 'Only a bundle never sent can be removed.' });
      if (block.bundles.length <= 1) return res.status(409).json({ message: 'A block needs at least one bundle.' });
      await answer(res, found, { bundles: (block.bundles as Loose[]).filter((b) => b._id !== bundle._id) });
    } catch (error) { fail(res, 'remove bundle', error); }
  });

  router.post('/blocks/:id/bundles/:bid/photo', auth, validateScalarRequest, async (req: Request, res: Response) => {
    const data = req.body?.data;
    if (typeof data !== 'string' || !/^data:image\/(jpeg|jpg|png|webp|heic|heif);base64,/i.test(data) || data.length > MAX_PHOTO_CHARS) {
      return res.status(400).json({ message: 'Send a photo.', code: 'needPhoto' });
    }
    try {
      const found = await myBlock(req);
      if (!found) return res.status(404).json({ message: 'Block not found.' });
      const { po } = found;
      const bid = scalarParams(req).bid!;
      const first = findBundle(found.block, bid);
      if (!first) return res.status(404).json({ message: 'Bundle not found.' });
      if (po.status !== 'open' || !supplierMayEdit(first)) return res.status(409).json({ message: 'This bundle is locked.', code: 'lockNote' });
      // 1800px on the long side: enough to see a crack across a slab, small enough for a yard's signal.
      const url = await processBase64Image(data, 'SupplierBlocks', 1800);
      if (typeof url !== 'string' || url.startsWith('data:')) return res.status(502).json({ message: 'The photo could not be stored. Try again.', code: 'serverError' });
      // Read again after the upload (it takes seconds): another photo may have been saved meanwhile.
      const block = await found.store.blockById(String(found.block._id));
      const bundle = block ? findBundle(block, bid) : null;
      if (!block || !bundle || !supplierMayEdit(bundle)) return res.status(409).json({ message: 'This bundle is locked.', code: 'lockNote' });
      const at = new Date();
      const after = withNewPhoto({ ...bundle, id: bid } as never, url, at) as Loose;
      await answer(res, { ...found, block }, {
        bundles: (block.bundles as Loose[]).map((b) => (b === bundle ? { ...b, photoUrl: after.photoUrl, photoAt: at, previousPhotos: after.previousPhotos } : b))
      });
    } catch (error) { fail(res, 'photo', error); }
  });

  router.post('/blocks/:id/send', auth, validateScalarRequest, async (req: Request, res: Response) => {
    const me = supplierOf(req);
    try {
      const found = await myBlock(req);
      if (!found) return res.status(404).json({ message: 'Block not found.' });
      const { block, po } = found;
      if (po.status !== 'open') return res.status(409).json({ message: 'This PO is closed.', code: po.status === 'cancelled' ? 'poCancelled' : 'poClosed' });
      const like = blockLike(block);
      const check = sendProblems(like);
      if (!check.ok) return res.status(400).json({ message: 'Check what’s marked in red.', code: 'checkMarked', problems: check.problems });
      const at = new Date();
      const resent = Boolean(block.sentAt);
      const sentBundles = applySend(like.bundles, at);
      const next = (block.bundles as Loose[]).map((plain) => {
        const after = sentBundles.find((b) => b.id === plain._id)!;
        return check.toSend.includes(plain._id)
          ? { ...plain, status: after.status, round: after.round, step1: null, step2: null, reason: '', comment: null, sentAt: at }
          : plain;
      });
      const slabs = next.filter((b) => check.toSend.includes(b._id)).reduce((s, b) => s + (Number(b.slabs) || 0), 0);
      const saved = await answer(res, found, { bundles: next, sentAt: at, ...(block.firstSentAt ? {} : { firstSentAt: at }) },
        [{ at, by: me.name, side: 'supplier', action: resent ? 'sent changes' : 'sent for review', changes: `${check.toSend.length} bundle${check.toSend.length === 1 ? '' : 's'}, ${slabs} slabs` }], at);
      if (!saved) return;
      // The PO's buyer hears about it (after the answer: an email never holds up the supplier).
      const buyer = po.buyerId && mongoose.isValidObjectId(po.buyerId) ? await staffData.userById(po.buyerId, { select: 'email displayName username' }) : null;
      if (buyer?.email) {
        const base = (process.env.FRONTEND_URL || req.get('origin') || '').replace(/\/+$/, '');
        sendBlockOffered({
          to: buyer.email, buyerName: buyer.displayName || buyer.username || '', supplierName: me.supplierName, poNumber: po.poNumber,
          blockNumber: block.blockNumber, material: block.material, bundles: check.toSend.length, slabs,
          link: `${base}/sales?tab=supplier_pos&block=${String(block._id)}`, resent
        }).catch(() => undefined);
      }
    } catch (error) { fail(res, 'send', error); }
  });

  router.delete('/blocks/:id', auth, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const found = await myBlock(req);
      if (!found) return res.json({ deleted: true });
      if (found.block.firstSentAt) return res.status(409).json({ message: 'A block that was sent stays on record.' });
      await found.store.deleteUnsentBlock(String(found.block._id));
      res.json({ deleted: true });
    } catch (error) { fail(res, 'delete block', error); }
  });

  return router;
}

