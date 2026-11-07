import type { Request, RequestHandler, Response, NextFunction } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import { validateScalarRequest, scalarParams } from '../server/scalarRequest.ts';
import { Supplier, SupplierLogin, SupplierPO, SupplierBlock } from '../models/Suppliers.ts';
import User from '../models/User.ts';
import { SUPPLIER_POS } from '../utils/supplierAccess.ts';
import {
  applyEntry, applySend, sendProblems, blockStage, parseSize, cleanBlockNumber, ENTRY_PROBLEM_TEXT,
  type BlockSize, type BundleLike, type EntryBundle
} from '../utils/supplierBlocks.ts';
import { makeNote } from '../services/translate.ts';
import { sendBlockOffered } from '../services/supplierEmails.ts';
import { staffBlockView, blockLike } from '../services/supplierViews.ts';
import type { Loose } from '../types/records.ts';

/**
 * Purchasing enters a block for its supplier (2026-11-07, owner's ask): when
 * a supplier emails or WhatsApps the bundle photos instead of using the
 * portal. The block is the supplier's — it shows in their portal and they
 * hear the decisions as usual — marked "Added by <name>" on the block and in
 * its history. It goes through both steps like any other; whoever entered it
 * may give it step 1. The same bundles the supplier could change are open
 * here (a new photo asked, an unlocked one, a bundle added); one that's with
 * Easy Stones never is. Rules: applyEntry / sendProblems / applySend in
 * src/utils/supplierBlocks.ts.
 *
 *   POST /block-photos { data }               a photo, the moment it's picked → { url }
 *   POST /pos/:id/blocks { id, lineId, blockNumber, length, height, unit, note, bundles: [{ id, slabs, photoUrl }] }
 *                                             enter and send a block (the screen's own id: a repeat answers alreadySaved)
 *   PUT  /blocks/:id/entry { expectedUpdatedAt, blockNumber, length, height, unit, bundles }
 *                                             new photos / bundles the supplier sent for a block, sent again
 *
 * Every route needs Add / edit POs (manage_supplier_pos). Mounted inside
 * createSuppliersRouter, at /api/suppliers.
 */

type ReqUser = { id?: string; _id?: string; username?: string; displayName?: string; permissions?: string[] };
const userOf = (req: Request) => ((req as Request & { user?: ReqUser }).user || {}) as ReqUser;
const actorOf = (req: Request) => ({ id: String(userOf(req).id || userOf(req)._id || ''), name: userOf(req).displayName || userOf(req).username || '' });
const toPlain = (raw: unknown): Loose => (raw as { toObject: () => Loose }).toObject();
const isVersionError = (e: unknown) => (e as { name?: string })?.name === 'VersionError';
const MAX_PHOTO_CHARS = 15_000_000;
const siteBase = (req: Request) => (req.get('origin') || process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

/** sendProblems' answer in purchasing's words: { blockNumber, size, bundles: { [id]: message } }. */
function problemsText(problems: { block: Record<string, string>; bundles: Record<string, string[]> }) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(problems.block)) out[k] = ENTRY_PROBLEM_TEXT[v] || v;
  const bundles: Record<string, string> = {};
  for (const [id, list] of Object.entries(problems.bundles)) bundles[id] = list.map((k) => ENTRY_PROBLEM_TEXT[k] || k).join(' ');
  if (Object.keys(bundles).length) out.bundles = bundles;
  return out;
}

/** A bundle back into the block's stored shape, keeping what the entry doesn't touch (an unlock record…). */
const storedBundle = (b: BundleLike, before?: Loose) => ({
  ...(before || {}), _id: b.id, n: b.n, slabs: b.slabs, photoUrl: b.photoUrl, photoAt: b.photoAt || null,
  previousPhotos: b.previousPhotos || [], status: b.status, round: b.round || 0, sentAt: b.sentAt || null,
  step1: b.step1 || null, step2: b.step2 || null, reason: b.reason || '', comment: b.comment || null
});

const entryOf = (body: Loose): EntryBundle[] => (Array.isArray(body?.bundles) ? body.bundles : []).slice(0, 40).map((b: Loose) => ({
  id: String(b?.id || ''),
  ...(b?.slabs !== undefined ? { slabs: b.slabs === null || b.slabs === '' ? null : Number(b.slabs) } : {}),
  ...(b?.photoUrl ? { photoUrl: String(b.photoUrl) } : {})
}));

export default function createBlockEntryRoutes({ authenticate, processBase64Image }: {
  authenticate: RequestHandler;
  processBase64Image?: (data: string, folder?: string, maxSide?: number) => Promise<unknown>;
}) {
  const router = express.Router();
  const may = (req: Request, res: Response, next: NextFunction) =>
    ((userOf(req).permissions || []).includes(SUPPLIER_POS.MANAGE_POS) ? next() : res.status(403).json({ message: 'You can’t enter blocks for suppliers.' }));
  const guard = [authenticate, may];
  const fail = (res: Response, what: string, error: unknown, message: string) => {
    console.error(`[suppliers] ${what} failed:`, error);
    res.status(500).json({ message });
  };
  const view = async (b: Loose, viewerId: string) => {
    const [po, supplier] = await Promise.all([SupplierPO.findById(b.poId, '-history').lean(), Supplier.findById(b.supplierId).lean()]);
    return staffBlockView(b, { viewerId, supplier, po });
  };
  /** The buyer hears about it unless they entered it themselves (after the answer: an email never holds up the save). */
  const tellBuyer = async (req: Request, po: Loose, block: Loose, bundles: number, slabs: number, resent: boolean) => {
    const who = actorOf(req);
    if (!po.buyerId || po.buyerId === who.id || !mongoose.isValidObjectId(po.buyerId)) return;
    const [buyer, supplier] = await Promise.all([User.findById(po.buyerId, 'email displayName username').lean(), Supplier.findById(po.supplierId, 'name').lean()]);
    if (!buyer?.email) return;
    sendBlockOffered({
      to: buyer.email, buyerName: buyer.displayName || buyer.username || '', supplierName: supplier?.name || po.supplierName || '', poNumber: po.poNumber,
      blockNumber: block.blockNumber, material: block.material, bundles, slabs, link: `${siteBase(req)}/sales?tab=supplier_pos&block=${String(block._id)}`,
      resent, enteredBy: who.name
    }).catch(() => undefined);
  };
  /** The languages the supplier's people read, for the note purchasing types. */
  const readers = async (supplierId: string) => {
    const [s, logins] = await Promise.all([Supplier.findById(supplierId, 'language').lean(), SupplierLogin.find({ supplierId, active: true }, 'language').lean()]);
    return [...new Set([s?.language || 'en', ...logins.map((l) => l.language || 'en')])];
  };
  /** Block # and size from the body; a size typed wrong is a problem. */
  const blockFields = (body: Loose, current: { blockNumber: string; size: BlockSize | null }): { blockNumber: string; size: BlockSize | null; sizeProblem: boolean } => {
    const blockNumber = body.blockNumber !== undefined ? cleanBlockNumber(body.blockNumber) : current.blockNumber;
    let size = current.size;
    const typed = `${body.length ?? ''}${body.height ?? ''}`.trim();
    if (body.length !== undefined || body.height !== undefined) size = typed ? parseSize(body.length, body.height, body.unit) : null;
    return { blockNumber, size, sizeProblem: Boolean(typed && !size) };
  };

  router.post('/block-photos', ...guard, async (req: Request, res: Response) => {
    const data = req.body?.data;
    if (typeof data !== 'string' || !/^data:image\/(jpeg|jpg|png|webp|heic|heif);base64,/i.test(data) || data.length > MAX_PHOTO_CHARS) {
      return res.status(400).json({ message: 'Choose a photo (JPEG, PNG, WebP or HEIC).' });
    }
    if (!processBase64Image) return res.status(503).json({ message: 'Photos can’t be stored right now.' });
    try {
      // 1800px on the long side, as the portal stores them.
      const url = await processBase64Image(data, 'SupplierBlocks', 1800);
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) return res.status(502).json({ message: 'The photo could not be stored. Try again.' });
      res.status(201).json({ url });
    } catch (error) { fail(res, 'block photo', error, 'The photo could not be stored. Try again.'); }
  });

  router.post('/pos/:id/blocks', ...guard, validateScalarRequest, async (req: Request, res: Response) => {
    const body = req.body || {};
    const blockId = String(body.id || '');
    if (!mongoose.isValidObjectId(blockId)) return res.status(400).json({ message: 'Reload the page and try again.' });
    const who = actorOf(req);
    try {
      const again = await SupplierBlock.findById(blockId).lean();
      if (again) {
        if (again.poId !== scalarParams(req).id) return res.status(409).json({ message: 'Reload the page and try again.' });
        return res.json({ block: await view(again, who.id), alreadySaved: true });
      }
      const { id } = scalarParams(req);
      const po = mongoose.isValidObjectId(id) ? await SupplierPO.findById(id, '-history').lean() : null;
      if (!po) return res.status(404).json({ message: 'PO not found.' });
      if (po.status !== 'open') return res.status(409).json({ message: po.status === 'cancelled' ? 'This PO was cancelled.' : 'This PO is closed. Reopen it first.' });
      const line = (po.lines || []).find((l) => String(l._id) === String(body.lineId || ''));
      if (!line) return res.status(400).json({ message: 'Some fields need attention.', problems: { lineId: 'Choose the material' } });
      const fields = blockFields(body, { blockNumber: '', size: null });
      const at = new Date();
      const entered = applyEntry([], entryOf(body), at);
      if (entered.problem) return res.status(409).json({ message: entered.problem });
      const check = sendProblems({ blockNumber: fields.blockNumber, size: fields.size, bundles: entered.bundles });
      if (fields.sizeProblem || !check.ok) {
        return res.status(400).json({ message: 'Some fields need attention.', problems: { ...problemsText(check.problems), ...(fields.sizeProblem ? { size: ENTRY_PROBLEM_TEXT.size } : {}) } });
      }
      const sent = applySend(entered.bundles, at);
      const slabs = sent.reduce((s, b) => s + (Number(b.slabs) || 0), 0);
      const noteText = String(body.note || '').trim().slice(0, 1500);
      const note = noteText ? await makeNote(noteText, 'en', await readers(po.supplierId), who.name) : null;
      const doc = await SupplierBlock.create({
        _id: blockId, poId: String(po._id), poNumber: po.poNumber, supplierId: po.supplierId, lineId: String(line._id),
        material: line.material, thickness: line.thickness || '', finish: line.finish || '',
        blockNumber: fields.blockNumber, size: fields.size, note, bundles: sent.map((b) => storedBundle(b)),
        stage: blockStage({ bundles: sent, sentAt: at }), firstSentAt: at, sentAt: at, createdBy: who.name, enteredBy: who.name, enteredById: who.id,
        history: [{ at, by: who.name, side: 'staff', action: 'entered for the supplier', changes: `${sent.length} bundle${sent.length === 1 ? '' : 's'}, ${slabs} slabs` }]
      });
      res.status(201).json({ block: await view(doc.toObject(), who.id) });
      tellBuyer(req, po, doc.toObject(), sent.length, slabs, false).catch(() => undefined);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const dup = await SupplierBlock.findById(blockId).lean();
        if (dup) return res.json({ block: await view(dup, who.id), alreadySaved: true });
      }
      fail(res, 'enter block', error, 'Could not save the block.');
    }
  });

  router.put('/blocks/:id/entry', ...guard, validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const body = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Block not found.' });
    const who = actorOf(req);
    try {
      const block = await SupplierBlock.findById(id);
      if (!block) return res.status(404).json({ message: 'Block not found.' });
      // The supplier is still putting a block together in the portal: it's theirs until they send it.
      if (!block.sentAt) return res.status(409).json({ message: 'The supplier is still putting this block together in the portal.' });
      const po = await SupplierPO.findById(block.poId, '-history').lean();
      if (!po || po.status !== 'open') return res.status(409).json({ message: po?.status === 'cancelled' ? 'This PO was cancelled.' : 'This PO is closed. Reopen it first.' });
      // Saved over something newer (the supplier sent a photo, someone decided): reload first.
      if (body.expectedUpdatedAt && block.updatedAt && new Date(String(body.expectedUpdatedAt)).getTime() !== new Date(block.updatedAt).getTime()) {
        return res.status(409).json({ message: 'This block changed since you opened it. Close it and open it again.', code: 'stale' });
      }
      const before = blockLike(block.toObject());
      const fields = blockFields(body, { blockNumber: before.blockNumber, size: before.size });
      const at = new Date();
      const entered = applyEntry(before.bundles, entryOf(body), at);
      if (entered.problem) return res.status(409).json({ message: entered.problem });
      const check = sendProblems({ blockNumber: fields.blockNumber, size: fields.size, bundles: entered.bundles });
      if (fields.sizeProblem || !check.ok) {
        return res.status(400).json({ message: 'Some fields need attention.', problems: { ...problemsText(check.problems), ...(fields.sizeProblem ? { size: ENTRY_PROBLEM_TEXT.size } : {}) } });
      }
      const sent = applySend(entered.bundles, at);
      const plain = new Map(block.bundles.map((raw) => { const p = toPlain(raw); return [String(p._id), p]; }));
      block.set({ blockNumber: fields.blockNumber, size: fields.size, bundles: sent.map((b) => storedBundle(b, plain.get(b.id))), sentAt: at });
      block.set({ stage: blockStage({ bundles: sent, sentAt: at }) });
      const goes = sent.filter((b) => check.toSend.includes(b.id));
      const slabs = goes.reduce((s, b) => s + (Number(b.slabs) || 0), 0);
      const photos = goes.filter((b) => (b.round || 0) > 1 && b.photoAt && new Date(b.photoAt).getTime() === at.getTime()).length;
      block.history.push({
        at, by: who.name, side: 'staff', action: 'entered changes for the supplier',
        changes: `${goes.length} bundle${goes.length === 1 ? '' : 's'}, ${slabs} slabs${photos ? ` · ${photos} new photo${photos === 1 ? '' : 's'}` : ''}`
      });
      await block.save();
      res.json({ block: await view(block.toObject(), who.id) });
      tellBuyer(req, po, block.toObject(), goes.length, slabs, true).catch(() => undefined);
    } catch (error) {
      if (isVersionError(error)) return res.status(409).json({ message: 'This block changed since you opened it. Close it and open it again.', code: 'stale' });
      fail(res, 'enter changes', error, 'Could not save the block.');
    }
  });

  return router;
}
