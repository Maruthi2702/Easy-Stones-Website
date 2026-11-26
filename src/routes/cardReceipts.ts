import { pushReceiptSentBack, pushReceiptReopened } from '../services/pushEvents.ts';
import { notifyAsked as defaultNotifyAsked, notifyAnswered as defaultNotifyAnswered, type AskNotifyDeps } from '../services/receiptAskNotify.ts';
import type { Request, RequestHandler, Response, NextFunction } from 'express';
import * as staffData from '../db/staff/index.ts';
import express from 'express';
import mongoose from 'mongoose';
import { validateScalarRequest, scalarQuery, scalarParams } from '../server/scalarRequest.ts';
import * as db from '../db/cardReceipts/index.ts';
import { customerById } from '../db/customers/index.ts';
import { StaleExpenseError, RepeatExpenseError, EXPENSE_LIST_CAP, isChargePlaceholder } from '../db/cardReceipts/types.ts';
import {
  type ApprovalState, type ApprovalViewer, type Slot, askOpen, slotFor, approverAs, fullyApproved, canSendBack, canAsk, canWithdrawAsk,
  canAnswer, canReopen, canFillDetails, mayBeAsked, slotForAnswer, waitingReason, approvalChips, secondNeeded, approveProblem,
  isAccountingSide, isBranchManagerOf, isManagerRole, isAdminRole, holderKindOf, mayViewHolderReceipts
} from '../utils/receiptApproval.ts';
import { newId } from '../db/ids.ts';
import { isBatchMarker, batchNote, type BatchMarker } from '../utils/receiptBatch.ts';
import rateLimit from 'express-rate-limit';
import { PostgresRateLimitStore } from '../services/rateLimitStore.ts';
import { isRealPdfDataUrl } from '../utils/receiptPdf.ts';
import { isReceiptHash, type PhotoDuplicate } from '../utils/receiptFile.ts';
import { createHash } from 'node:crypto';
import { isFilesCdnUrl, isCloudinaryUrl } from '../utils/fileUrls.ts';
import { getFileStore, type FileStore } from '../services/fileStore.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { displayNameOf } from '../utils/salesReps.ts';
import { ALL_PEOPLE } from '../utils/teamScope.ts';
import { afterReceiptSaved, afterCardSaved, amexChargeOf, amexNameLookup, nearReceiptsOf, matchByHand, statementMatches, NearMatchError } from '../db/cardStatements/hooks.ts';
import { missingFromFor } from '../utils/amexStatement.ts';
import {
  CARD_RECEIPTS, PAGE_PERMISSIONS, STARTING_CATEGORIES, startingSubcategories, categoryKey, cleanCategory, cleanCard, cleanExpense,
  statusAfterSave, statusAfterAnyEdit, mayStayIncomplete, INCOMPLETE_MESSAGE, anyoneMayEdit, deleteReasonProblem, missingFor, holderMayEdit, managerMayEdit, changeSummary, possibleRepeat, centsText,
  mergeableRepeat, mergeIntoSaved, repeatInfoOf, chooseCard, isMonth, rangeProblem, monthOf, BANK_FILTERS, onBank, matchedChangeProblem, isReceiptFolderUrl, isPrivateReceiptName, privateReceiptNameOf, privateReceiptUrlOfKey, PRIVATE_RECEIPT_ROUTE, PRIVATE_RECEIPT_KEY_PREFIX, type CleanExpense
} from '../utils/cardReceipts.ts';
import type { Loose } from '../types/records.ts';

/**
 * Credit Card Receipts (Accounting). Rules: src/utils/cardReceipts.ts.
 *
 *   GET    /me                       the caller's card, the categories, their role
 *   GET    /categories               the Admin list (hidden ones too; screens decide)
 *   POST   /categories               add              (add_receipt_categories)
 *   PUT    /:id under /categories    rename, fields, hide / show (edit_receipt_categories)
 *   PATCH  /categories/reorder       { ids } the whole list in its new order (reorder_receipt_categories)
 *   GET    /categories/:id/uses      how many expenses use it (delete_receipt_categories)
 *   DELETE /categories/:id           { replaceWith } when expenses use it: they move first
 *   GET    /cards                    cards and the people who can hold one (manage_company_cards, or view all)
 *   POST   /cards, PUT /cards/:id    (manage_company_cards) one active card per person
 *   POST   /attachments              { data } a photo or PDF → { url }, the moment it's picked
 *   GET    /expenses?scope=&month=   mine (default) · all (view all, or view branch: the caller's team) · waiting (what waits for the caller, any month)
 *                                     · todo (the caller's own Missing receipt / Draft / Sent back, any month)
 *   GET    /expenses/export?bank=    every month, one bank or both (export_all_card_receipts), the caller's own view's people
 *   POST   /expenses                 add, with the screen's own `id` (a repeat answers alreadySaved);
 *                                    the same day + total already saved answers 409 `repeat` unless `confirmRepeat`
 *   PUT    /expenses/:id             the cardholder, until it's approved
 *   POST   /expenses/:id/approve     { comment } (needed for a lost receipt): the Accounting or the second approval (receiptApproval.ts)
 *   POST   /expenses/:id/send-back   { comment } Accounting or an Admin; clears both approvals and the question
 *   GET    /expenses/:id/ask-targets who a question may go to
 *   POST   /expenses/:id/ask         { to, question } Accounting or an Admin; takes back an Accounting approval given
 *   POST   /expenses/:id/ask/withdraw
 *   POST   /expenses/:id/answer      { answer } the person asked; fills the second approval when theirs to give
 *   POST   /expenses/:id/reopen      { reason } approved → waiting, both approvals cleared
 *   PUT    /expenses/:id/details     { category, subcategory, customerId, note } an Admin's own receipt, by Accounting
 *   POST   /expenses/:id/void        { reason } the cardholder, until it's approved; anyone with Void any receipt, approved ones too
 *   DELETE /expenses/:id             { reason } Delete receipts (admins): a copy is kept first
 *   Every decision takes `expectedUpdatedAt` (409 `changed` when the receipt moved since).
 *
 *   app.use('/api/card-receipts', createCardReceiptsRouter({ authenticate, processBase64Image }));
 */

type ReqUser = { id?: string; _id?: string; username?: string; displayName?: string; role?: string; permissions?: string[]; location?: string; assignedLocations?: string[] };
const userOf = (req: Request) => ((req as Request & { user?: ReqUser }).user || {}) as ReqUser;
const userIdOf = (req: Request) => String(userOf(req).id || userOf(req)._id || '');
// The app-wide rule (a Display Name, else a tidied username) — a bare username like "babu" must not show lowercase.
const nameOf = (u: { displayName?: string | null; username?: string | null }) => displayNameOf(u);
const has = (req: Request, perm: string) => (userOf(req).permissions || []).includes(perm);
const homeOf = (u: { location?: string | null; assignedLocations?: string[] | null }) =>
  u.location || (u.assignedLocations || []).find((l) => l && l !== '*') || '';
const todayOf = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

/**
 * The receipt link must be a file this app stored for a receipt; one already on the expense may stay. A private
 * receipt (the app's own address) must be one the person uploaded themselves, so nobody attaches another's.
 * Also answers the file's fingerprint to save on the expense (`hash`): null = keep what the expense has (the same
 * file), '' = none known (no file, or one stored before fingerprints / on a store that keeps no metadata).
 */
const receiptFileOf = async (store: FileStore | null, url: string, current: string, me: string): Promise<{ problem: string; hash: string | null }> => {
  if (url === current) return { problem: '', hash: null };
  if (!url) return { problem: '', hash: '' };
  const again = { problem: 'Upload the receipt again', hash: '' };
  const name = privateReceiptNameOf(url);
  if (name) {
    const file = await store?.get(`${PRIVATE_RECEIPT_KEY_PREFIX}${name}`);
    if (file?.metadata.uploader !== me) return again;
    return { problem: '', hash: isReceiptHash(file.metadata.sha256) ? file.metadata.sha256 : '' };
  }
  if (!(isReceiptFolderUrl(url) && (isFilesCdnUrl(url) || isCloudinaryUrl(url) || /^\/uploads\//.test(url)))) return again;
  // Review S3 (2026-11-24): a public link (a receipt saved before receipts went private, or on a store that can't keep one
  // private) is just an address, so it must not be someone else's already-saved receipt.
  const holder = await db.findExpenseByReceipt(url);
  return holder && String(holder.userId) !== String(me) ? again : { problem: '', hash: '' };
};
/** The fingerprint of an upload: the browser's (of the file as picked), else the bytes that arrived. */
const fingerprintOf = (sent: unknown, data: string) =>
  (isReceiptHash(sent) ? sent : createHash('sha256').update(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')).digest('hex'));
/** The address to save for a file just stored: private ones become the app's own address. */
const savedAddressOf = (url: string) => {
  const m = /\/(private\/CardReceipts\/[^/?#]+)$/.exec(url.split('?')[0] || '');
  return (m && privateReceiptUrlOfKey(decodeURIComponent(m[1]!))) || url;
};
// A PDF goes up as it is (20 MB as base64); a photo is shrunk by the browser first, so it is far smaller than this.
const MAX_PDF_CHARS = 28_000_000;
const MAX_PHOTO_CHARS = 14_000_000;

const anyOf = (...perms: readonly string[]) => (req: Request, res: Response, next: NextFunction) =>
  (perms.some((p) => has(req, p)) ? next() : res.status(403).json({ message: 'Access denied.' }));

const categoryView = (c: Loose) => ({
  _id: String(c._id), name: c.name, label: c.label, order: c.order ?? 0, active: c.active !== false,
  fields: { customer: Boolean(c.fields?.customer), note: Boolean(c.fields?.note), recurring: Boolean(c.fields?.recurring) },
  subcategories: ((c.subcategories || []) as Loose[]).map((s) => ({
    name: String(s.name), label: String(s.label), active: s.active !== false, isDefault: Boolean(s.isDefault),
    fields: { customer: Boolean(s.fields?.customer), note: Boolean(s.fields?.note), recurring: Boolean(s.fields?.recurring) }
  }))
});
const cardView = (c: Loose) => ({ _id: String(c._id), userId: c.userId, label: c.label, issuer: c.issuer, lastDigits: c.lastDigits, amexName: c.amexName || '', location: c.location || '', active: c.active !== false });
/** A decision as both databases answer it (MongoDB may add `as: null` to an old one, Postgres keeps no `as` on a send-back). */
const decisionView = (d: Loose | null | undefined, withAs = true) => (d && typeof d === 'object'
  ? { by: String(d.by ?? ''), byName: String(d.byName ?? ''), at: d.at ?? null, comment: String(d.comment ?? ''), ...(withAs ? { as: d.as ?? null } : {}) }
  : null);
const askView = (a: Loose | null | undefined) => (a && typeof a === 'object'
  ? { to: String(a.to ?? ''), toName: String(a.toName ?? ''), by: String(a.by ?? ''), byName: String(a.byName ?? ''), at: a.at ?? null,
      question: String(a.question ?? ''), answer: String(a.answer ?? ''), answeredAt: a.answeredAt ?? null }
  : null);

/** What the approval rules read off a stored expense (receiptApproval.ts), with its cardholder's role now. */
const stateOf = (e: Loose, holderRole: string): ApprovalState => ({
  userId: String(e.userId ?? ''), holderRole, location: e.location || '', cents: Number(e.cents) || 0, status: String(e.status || ''),
  voided: e.voidedAt || null, approval: decisionView(e.approval), secondApproval: decisionView(e.secondApproval), ask: askView(e.ask),
  addedById: e.addedById ? String(e.addedById) : null, statementKind: e.statementKind ? String(e.statementKind) : ''
});

const expenseView = (e: Loose, viewer: ApprovalViewer, holderRole = '', issuer = 'amex', onStatement: boolean | null = null) => {
  const s = stateOf(e, holderRole);
  const actions = {
    approve: slotFor(viewer, s), sendBack: canSendBack(viewer, s), ask: canAsk(viewer, s), withdrawAsk: canWithdrawAsk(viewer, s),
    answer: canAnswer(viewer, s), reopen: canReopen(viewer, s), fillDetails: canFillDetails(viewer, s)
  };
  return {
    id: String(e._id), userId: e.userId, holderName: e.holderName, holderRole, cardId: e.cardId, cardLabel: e.cardLabel, issuer: issuer || 'amex', location: e.location,
    date: e.date, merchant: e.merchant, cents: e.cents, subtotalCents: e.subtotalCents ?? null, feesCents: e.feesCents ?? null, taxCents: e.taxCents ?? null, tipCents: e.tipCents ?? null,
    category: e.category || '', subcategory: e.subcategory || '', customerId: e.customerId || '', customerName: e.customerName || '', attendees: e.attendees || [],
    purpose: e.purpose || '', note: e.note || '', recurring: Boolean(e.recurring), receiptUrl: e.receiptUrl || '', lostReason: e.lostReason || '',
    /** '' for a receipt; refund / fee / refunded_charge for a row made from a bank statement line (src/utils/statementRows.ts). */
    statementKind: e.statementKind || '',
    status: e.status, approval: s.approval ?? null, secondApproval: s.secondApproval ?? null, ask: s.ask ?? null, sentBack: decisionView(e.sentBack, false),
    /** On a bank statement's line (true), not on one yet (false) or not known (null) — the Expenses list's green / amber rows. */
    onStatement,
    voided: e.voidedAt ? { at: e.voidedAt, by: e.voidedBy || '', reason: e.voidReason || '' } : null,
    createdAt: e.createdAt, updatedAt: e.updatedAt, history: e.history || [],
    reminders: (e.reminders && typeof e.reminders === 'object' ? e.reminders : {}) as Loose,
    mine: e.userId === viewer.id,
    /** Added on the cardholder's behalf: who typed it (they can't approve it). */
    addedByName: e.addedById ? String(e.createdBy || '') : '',
    addedById: e.addedById ? String(e.addedById) : '',
    needsSecond: secondNeeded(s),
    chips: approvalChips(s),
    waitingReason: waitingReason(viewer, s),
    actions,
    canDecide: actions.approve != null || actions.answer
  };
};

/** Each card's bank, by card id — the expense carries only its card, and the screens filter by bank. */
const issuersByCard = async () => new Map((await db.listCards()).map((c) => [String(c._id), String(c.issuer || 'amex')]));

/** The cardholders' roles now, read once for a whole list (never one query per row); unknown → '' (staff). */
async function holderRolesOf(rows: readonly Loose[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((e) => String(e.userId ?? '')).filter((id) => /^[0-9a-f]{24}$/i.test(id)))];
  if (!ids.length) return new Map();
  const people = await staffData.findUsers({ _id: { $in: ids } }, { select: '_id role' });
  return new Map(people.map((p) => [String(p._id), String(p.role || '')]));
}

/** Expenses as the screens get them: each with its card's bank and its holder's role. */
async function viewsOf(rows: readonly Loose[], viewer: ApprovalViewer) {
  const [issuers, roles, linked] = await Promise.all([issuersByCard(), holderRolesOf(rows), statementMatches(rows.map((e) => String(e._id ?? e.id ?? '')))]);
  return rows.map((e) => {
    const issuer = issuers.get(String(e.cardId));
    // Matched = a statement line answers it. Not matched only counts from the day the check began and on a bank we read
    // statements for; before that (or off Postgres) nothing is known, so nothing is claimed.
    const checked = (issuer === 'amex' || issuer === 'encore') && String(e.date ?? '') >= missingFromFor(issuer);
    const onStatement = !linked ? null : linked.has(String(e._id ?? e.id ?? '').toLowerCase()) ? true : checked ? false : null;
    return expenseView(e, viewer, roles.get(String(e.userId)) ?? '', issuer, onStatement);
  });
}
/** One expense as the screens get it. */
const viewOf = async (e: Loose, viewer: ApprovalViewer) => (await viewsOf([e], viewer))[0]!;

/** Seeds the starting list into an empty collection, once. */
async function categoriesList() {
  let list = await db.listCategories();
  if (!list.length) {
    await db.seedCategories(STARTING_CATEGORIES.map((c, i) => ({ _id: newId(), name: categoryKey(c.label), label: c.label, order: i, fields: { ...c.fields }, subcategories: startingSubcategories(c) })));
    list = await db.listCategories();
  }
  return list;
}

/** The caller as the approval rules see them (receiptApproval.ts). */
const approvalViewerOf = (req: Request): ApprovalViewer => {
  const u = userOf(req);
  return { id: userIdOf(req), role: u.role || '', permissions: u.permissions || [], location: u.location || '', assignedLocations: u.assignedLocations || [] };
};
const siteBase = (req: Request) => (req.get('origin') || process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

export default function createCardReceiptsRouter({ authenticate, processBase64Image, fileStore = getFileStore, notify = {} }: {
  authenticate: RequestHandler;
  processBase64Image: (data: string, folder?: string, maxSide?: number, options?: { private?: boolean; format?: 'jpeg'; metadata?: Record<string, string> }) => Promise<unknown>;
  fileStore?: () => FileStore | null;
  /** Ask / answer notices (src/services/receiptAskNotify.ts); tests pass their own. */
  notify?: { asked?: (expense: Loose, ask: Loose, deps?: AskNotifyDeps) => unknown; answered?: (expense: Loose, ask: Loose, deps?: AskNotifyDeps) => unknown };
}) {
  const notifyAsked = notify.asked ?? defaultNotifyAsked;
  const notifyAnswered = notify.answered ?? defaultNotifyAnswered;
  const router = express.Router();
  const opener = [authenticate, anyOf(...PAGE_PERMISSIONS)];
  const uploader = (req: Request) => userIdOf(req) || 'anonymous';
  const uploadLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 100, keyGenerator: uploader, store: new PostgresRateLimitStore('card-receipt-upload'), passOnStoreError: true, standardHeaders: true, legacyHeaders: false, validate: false, message: { message: 'Too many uploads. Wait a few minutes.' } });
  const actor = (req: Request) => nameOf(userOf(req));
  const actorOf = (req: Request) => ({ id: userIdOf(req), name: actor(req) });

  router.get('/me', opener, async (req: Request, res: Response) => {
    try {
      const me = userIdOf(req);
      const [cards, categories] = await Promise.all([db.activeCardsOf(me), categoriesList()]);
      const card = cards[0] || null;
      const u = userOf(req);
      res.json({
        user: { id: me, name: nameOf(u), location: homeOf(u) },
        role: String(u.role || ''),
        card: card ? cardView(card) : null,
        cards: cards.map(cardView),
        categories: categories.map(categoryView),
        today: todayOf()
      });
    } catch (error) {
      console.error('[card-receipts] me failed:', error);
      res.status(500).json({ message: 'Could not load Credit Card Receipts.' });
    }
  });

  // ── Categories ────────────────────────────────────────────────────────────

  const categoryOpeners = [CARD_RECEIPTS.CATEGORY_ADD, CARD_RECEIPTS.CATEGORY_EDIT, CARD_RECEIPTS.CATEGORY_REORDER, CARD_RECEIPTS.CATEGORY_DELETE];
  router.get('/categories', authenticate, anyOf(...PAGE_PERMISSIONS, ...categoryOpeners), async (_req: Request, res: Response) => {
    try {
      res.json({ categories: (await categoriesList()).map(categoryView) });
    } catch (error) {
      console.error('[card-receipts] categories failed:', error);
      res.status(500).json({ message: 'Could not load the categories.' });
    }
  });

  router.post('/categories', authenticate, anyOf(CARD_RECEIPTS.CATEGORY_ADD), async (req: Request, res: Response) => {
    try {
      const list = await categoriesList();
      const { value, problems } = cleanCategory(req.body || {}, list as never);
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      let name = categoryKey(value.label) || 'category';
      for (let n = 2; list.some((c) => c.name === name); n += 1) name = `${categoryKey(value.label)}_${n}`;
      const order = Math.max(-1, ...list.map((c) => c.order ?? 0)) + 1;
      const saved = await db.addCategory(newId(), { name, ...value, order, updatedBy: actor(req) });
      res.status(201).json({ category: categoryView(saved) });
    } catch (error) {
      console.error('[card-receipts] add category failed:', error);
      res.status(500).json({ message: 'Could not add the category.' });
    }
  });

  router.patch('/categories/reorder', authenticate, anyOf(CARD_RECEIPTS.CATEGORY_REORDER), async (req: Request, res: Response) => {
    const ids: unknown = req.body?.ids;
    try {
      const known = (await db.categoryIds()).sort();
      if (!Array.isArray(ids) || [...new Set(ids.map(String))].sort().join() !== known.join()) {
        return res.status(400).json({ message: 'Send the whole list in its new order.' });
      }
      await db.reorderCategories(ids.map(String));
      res.json({ categories: (await categoriesList()).map(categoryView) });
    } catch (error) {
      console.error('[card-receipts] reorder failed:', error);
      res.status(500).json({ message: 'Could not save the order.' });
    }
  });

  router.put('/categories/:id', authenticate, anyOf(CARD_RECEIPTS.CATEGORY_EDIT), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Category not found.' });
    try {
      const found = await db.findCategory(id);
      if (!found) return res.status(404).json({ message: 'Category not found.' });
      const others = await db.listCategories();
      const { value, problems } = cleanCategory(req.body || {}, others as never, id, (found.subcategories || []) as never);
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      const category = await db.changeCategory(id, { ...value, ...(typeof req.body?.active === 'boolean' ? { active: req.body.active } : {}), updatedBy: actor(req) });
      if (!category) return res.status(404).json({ message: 'Category not found.' });
      res.json({ category: categoryView(category) });
    } catch (error) {
      console.error('[card-receipts] edit category failed:', error);
      res.status(500).json({ message: 'Could not save the category.' });
    }
  });

  router.get('/categories/:id/uses', authenticate, anyOf(CARD_RECEIPTS.CATEGORY_DELETE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Category not found.' });
    const category = await db.findCategory(id);
    if (!category) return res.status(404).json({ message: 'Category not found.' });
    res.json({ uses: await db.categoryUses(category.name) });
  });

  router.delete('/categories/:id', authenticate, anyOf(CARD_RECEIPTS.CATEGORY_DELETE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Category not found.' });
    try {
      const category = await db.findCategory(id);
      if (!category) return res.status(404).json({ message: 'Category not found.' });
      const uses = await db.categoryUses(category.name);
      let move: { to: string; entry: db.ExpenseHistoryEntry } | null = null;
      if (uses) {
        const targetId = String(req.body?.replaceWith || '');
        const target = mongoose.isValidObjectId(targetId) ? await db.findCategory(targetId) : null;
        if (!target || String(target._id) === id || target.active === false) {
          return res.status(409).json({ message: `${uses} expense${uses === 1 ? ' uses' : 's use'} it. Choose a shown category to move them to.`, uses });
        }
        // Approved receipts are history: if the new category asks for something they don't have (a customer,
        // a note…), moving them would leave approved receipts that fail its rules. Hide the category instead.
        const targetView = categoryView(target);
        const approved = await db.approvedInCategory(category.name);
        const failing = approved.filter((e) => Object.keys(missingFor({ receiptUrl: e.receiptUrl || '', lostReason: e.lostReason || '', category: target.name, customerId: e.customerId || '', note: e.note || '', subcategory: '' }, targetView)).length);
        if (failing.length) {
          // Approved history keeps its category: the category is hidden (never offered for new receipts) instead of deleted.
          await db.changeCategory(id, { active: false });
          return res.json({ deleted: false, hidden: true, kept: failing.length, moved: 0 });
        }
        // Moved before the category goes: a stop in between leaves the
        // expenses on the new category and the old one still listed — nothing lost.
        move = { to: target.name, entry: { at: new Date(), by: actor(req), action: 'edited', changes: `category ${category.label} → ${target.label} (deleted)` } };
      }
      await db.deleteCategory(id, category.name, move);
      res.json({ deleted: true, moved: uses });
    } catch (error) {
      console.error('[card-receipts] delete category failed:', error);
      res.status(500).json({ message: 'Could not delete the category.' });
    }
  });

  // ── Cards ─────────────────────────────────────────────────────────────────

  router.get('/cards', authenticate, anyOf(CARD_RECEIPTS.MANAGE_CARDS, CARD_RECEIPTS.VIEW_ALL), async (req: Request, res: Response) => {
    try {
      const [cards, people, amexName] = await Promise.all([
        db.listCards(),
        staffData.findUsers({}, { select: 'username displayName role location assignedLocations isActive', sort: { displayName: 1 } }),
        amexNameLookup()
      ]);
      const viewer = approvalViewerOf(req);
      const roleOf = new Map(people.map((p) => [String(p._id), String(p.role || '')]));
      res.json({
        // statementName: the Card Member name on the uploaded Amex statements for this card, the starting value for amexName (Amex check).
        // View all without Manage cards (a director): an Admin's cards stay with Accounting and Admins, like their receipts.
        cards: cards
          .filter((c) => !c.userId || has(req, CARD_RECEIPTS.MANAGE_CARDS) || mayViewHolderReceipts(viewer, roleOf.get(String(c.userId)), c.userId))
          .map((c) => ({ ...cardView(c), statementName: amexName(String(c.lastDigits || ''), String(c.issuer || 'amex')) })),
        people: people.filter((p) => p.username !== 'admin').map((p) => ({
          id: String(p._id), name: nameOf(p), role: p.role || '', location: homeOf(p), active: p.isActive !== false
        }))
      });
    } catch (error) {
      console.error('[card-receipts] cards failed:', error);
      res.status(500).json({ message: 'Could not load the cards.' });
    }
  });

  // Who a receipt can be added for (the switch "Add receipts for others"): active people with an active card, and those cards.
  router.get('/add-for-holders', authenticate, anyOf(CARD_RECEIPTS.ADD_FOR_OTHERS), async (_req: Request, res: Response) => {
    try {
      const [cards, people] = await Promise.all([
        db.listCards(),
        staffData.findUsers({}, { select: 'username displayName isActive', sort: { displayName: 1 } })
      ]);
      const byId = new Map(people.map((p) => [String(p._id), p]));
      const by = new Map<string, Loose[]>();
      for (const c of cards) {
        if (c.active === false || !c.userId) continue;
        const id = String(c.userId);
        by.set(id, [...(by.get(id) || []), c]);
      }
      const holders = [...by].flatMap(([id, list]) => {
        const person = byId.get(id);
        return person && person.username !== 'admin' && person.isActive !== false ? [{ id, name: nameOf(person), cards: list.map(cardView) }] : [];
      }).sort((a, b) => a.name.localeCompare(b.name));
      res.json({ holders });
    } catch (error) {
      console.error('[card-receipts] add-for-holders failed:', error);
      res.status(500).json({ message: 'Could not load the cardholders.' });
    }
  });

  // Everyone with a company card (active or not, a holder set), for the Cardholder filter — even with no expense this
  // month. Limited like the expenses list: View all → everyone, View branch → the caller's team (by where the person works).
  router.get('/cardholders', opener, async (req: Request, res: Response) => {
    try {
      let team: typeof ALL_PEOPLE | Set<string> = ALL_PEOPLE;
      if (!has(req, CARD_RECEIPTS.VIEW_ALL)) {
        if (!has(req, CARD_RECEIPTS.VIEW_BRANCH)) return res.status(403).json({ message: 'You can see your own expenses only.' });
        team = await teamOfRequest(req);
      }
      const [cards, people] = await Promise.all([
        db.listCards(),
        staffData.findUsers({}, { select: 'username displayName isActive role', sort: { displayName: 1 } })
      ]);
      const byId = new Map(people.map((p) => [String(p._id), p]));
      const viewer = approvalViewerOf(req);
      const ids = [...new Set(cards.map((c) => String(c.userId || '')).filter(Boolean))]
        .filter((id) => (team === ALL_PEOPLE || team.has(id)) && mayViewHolderReceipts(viewer, byId.get(id)?.role, id));
      res.json({ holders: ids.flatMap((id) => {
        const person = byId.get(id);
        return person && person.username !== 'admin' ? [{ id, name: nameOf(person), active: person.isActive !== false }] : [];
      }) });
    } catch (error) {
      console.error('[card-receipts] cardholders failed:', error);
      res.status(500).json({ message: 'Could not load the cardholders.' });
    }
  });

  const saveCard = async (req: Request, res: Response, card: Loose | null) => {
    // A card set up from the Amex check with no holder yet may be saved without one (deactivated, renamed); a new card needs its holder.
    const { value, problems } = cleanCard({ ...(card ? cardView(card) : {}), ...(req.body || {}) }, { allowUnassigned: Boolean(card && !card.userId) });
    if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
    const active = typeof req.body?.active === 'boolean' ? req.body.active : (card ? card.active !== false : true);
    if (value.userId && (!mongoose.isValidObjectId(value.userId) || !(await staffData.userExists({ _id: value.userId })))) {
      return res.status(400).json({ message: 'Some fields need attention.', problems: { userId: 'Choose the cardholder' } });
    }
    // A card ID is never used twice, deactivated ones included (reactivate that card instead).
    if (!card || value.label !== card.label) {
      const same = await db.cardWithLabel(value.label, card ? String(card._id) : null);
      if (same) {
        return res.status(409).json({ message: 'That card ID already exists.', problems: { label: same.active === false ? `Card ${same.label} already exists but is deactivated. Reactivate it instead.` : 'Another card has that ID' } });
      }
    }
    if (active) {
      const clash = await db.activeCardClash(value.userId, value.label, card ? String(card._id) : null, value.issuer as 'amex' | 'encore' | 'other');
      if (clash) {
        const problems = value.userId && clash.userId === value.userId ? { userId: `They already have ${value.issuer === 'encore' ? 'an Encore' : value.issuer === 'other' ? 'this kind of' : 'an Amex'} card, ${clash.label}. Deactivate it first.` } : { label: 'Another active card has that ID' };
        return res.status(409).json({ message: 'One card per person.', problems });
      }
    }
    const fields = { ...value, active, updatedBy: actor(req) };
    const saved = card ? await db.changeCard(String(card._id), fields) : await db.addCard(newId(), fields);
    if (!saved) return res.status(404).json({ message: 'Card not found.' });
    // The Amex check: a card that just got its holder asks for the receipts its charges are missing.
    await afterCardSaved(actorOf(req), String(value.issuer || 'amex'));
    res.status(card ? 200 : 201).json({ card: cardView(saved) });
  };

  router.post('/cards', authenticate, anyOf(CARD_RECEIPTS.MANAGE_CARDS), async (req: Request, res: Response) => {
    try { await saveCard(req, res, null); } catch (error) {
      console.error('[card-receipts] add card failed:', error);
      res.status(500).json({ message: 'Could not save the card.' });
    }
  });

  router.put('/cards/:id', authenticate, anyOf(CARD_RECEIPTS.MANAGE_CARDS), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Card not found.' });
    try {
      const card = await db.findCard(id);
      if (!card) return res.status(404).json({ message: 'Card not found.' });
      await saveCard(req, res, card);
    } catch (error) {
      console.error('[card-receipts] edit card failed:', error);
      res.status(500).json({ message: 'Could not save the card.' });
    }
  });

  // A card nobody logged anything on (a leftover from an upload, a mistake). One with expenses is deactivated instead, never deleted.
  router.delete('/cards/:id', authenticate, anyOf(CARD_RECEIPTS.MANAGE_CARDS), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Card not found.' });
    try {
      const result = await db.deleteCard(id);
      if (result.deleted) return res.json({ deleted: true });
      if (result.reason === 'missing') return res.status(404).json({ message: 'Card not found.' });
      const n = result.expenses || 0;
      return res.status(409).json({ message: `This card has ${n} expense${n === 1 ? '' : 's'} on it, so it can’t be deleted. Deactivate it instead.` });
    } catch (error) {
      console.error('[card-receipts] delete card failed:', error);
      res.status(500).json({ message: 'Could not delete the card.' });
    }
  });

  // ── Receipts ──────────────────────────────────────────────────────────────

  /**
   * The same photo twice (2026-11-24): a live receipt that already has this file. Its details only when the uploader may
   * see that receipt (mayViewReceipt), else only that there is one; `except` is the receipt being edited. A warning only —
   * a lookup that fails says nothing rather than failing the upload.
   */
  const duplicateOf = async (req: Request, hash: string, except: string): Promise<PhotoDuplicate | null> => {
    try {
      const found = (await db.expensesWithReceiptHash(hash)).filter((e) => String(e._id).toLowerCase() !== except.toLowerCase());
      if (!found.length) return null;
      for (const e of found) {
        if (!(await mayViewReceipt(req, e))) continue;
        return { seen: true, own: String(e.userId) === userIdOf(req), holderName: String(e.holderName || ''), merchant: String(e.merchant || ''), date: String(e.date || ''), cents: Number(e.cents) || 0, status: String(e.status || '') };
      }
      return { seen: false };
    } catch (error) {
      console.error('[card-receipts] duplicate photo lookup failed:', error);
      return null;
    }
  };

  router.post('/attachments', authenticate, anyOf(CARD_RECEIPTS.USE), uploadLimit, async (req: Request, res: Response) => {
    const data = req.body?.data;
    if (typeof data === 'string' && data.length > (data.startsWith('data:application/pdf') ? MAX_PDF_CHARS : MAX_PHOTO_CHARS)) return res.status(413).json({ message: 'That file is too large. Use a photo, or a PDF under 20 MB.' });
    if (typeof data !== 'string' || !/^data:(image\/|application\/pdf)/.test(data)) {
      return res.status(400).json({ message: 'Send a photo or a PDF of the receipt.' });
    }
    // Review S5: a file that says it is a PDF must start like one.
    if (data.startsWith('data:application/pdf') && !isRealPdfDataUrl(data)) {
      return res.status(400).json({ message: 'That file isn’t a PDF. Send a photo or a PDF of the receipt.' });
    }
    try {
      const sha256 = fingerprintOf(req.body?.hash, data);
      // Receipts keep up to 2000px (visit photos 1000) so the print stays readable when zoomed.
      // Kept private where the store can (S3): the CDN never serves it, GET /files/:name does, to whoever may see the expense.
      const url = await processBase64Image(data, 'CardReceipts', 2000, { private: true, format: 'jpeg', metadata: { uploader: userIdOf(req), sha256 } });
      // processBase64Image hands the data back when the upload fails.
      if (typeof url !== 'string' || url.startsWith('data:')) return res.status(502).json({ message: 'Could not store the receipt. Try again.' });
      res.json({ url: savedAddressOf(url), duplicate: await duplicateOf(req, sha256, String(req.body?.except ?? '')) });
    } catch (error) {
      console.error('[card-receipts] attachment failed:', error);
      res.status(502).json({ message: 'Could not store the receipt. Try again.' });
    }
  });

  router.get('/expenses', opener, validateScalarRequest, async (req: Request, res: Response) => {
    const { scope = '', month = '', from = '', to = '' } = scalarQuery(req) as { scope?: string; month?: string; from?: string; to?: string };
    const me = userIdOf(req);
    try {
      const viewer = approvalViewerOf(req);
      let filter: db.ExpenseFilter;
      if (scope === 'waiting') {
        filter = { kind: 'waiting' };
      } else if (scope === 'todo') {
        // Review B1 (2026-11-24): the caller's own receipts still to finish, from any month — a charge from
        // last month found by this month's statement must not hide behind the month stepper.
        filter = { kind: 'todo', userId: me };
      } else {
        // A custom From–To (the Expenses tab's Custom) or a month; the same people either way.
        let period: { kind: 'month'; month: string } | { kind: 'range'; from: string; to: string };
        if (from || to) {
          const problem = rangeProblem(from, to);
          if (problem) return res.status(400).json({ message: problem });
          period = { kind: 'range', from, to };
        } else {
          if (!isMonth(month)) return res.status(400).json({ message: 'Provide a month as YYYY-MM.' });
          period = { kind: 'month', month };
        }
        if (scope === 'all') {
          if (has(req, CARD_RECEIPTS.VIEW_ALL)) {
            filter = { ...period };
          } else if (has(req, CARD_RECEIPTS.VIEW_BRANCH)) {
            // Everyone on the caller's team, by where the person works (the Visits rule, teamScope.ts).
            const team = await teamOfRequest(req);
            filter = team === ALL_PEOPLE ? { ...period } : { ...period, userIds: [...team] };
          } else {
            return res.status(403).json({ message: 'You can see your own expenses only.' });
          }
        } else {
          filter = { ...period, userId: me };
        }
      }
      const rows = await db.listExpenses(filter);
      // An Admin's own receipts only reach Accounting and Admins, whatever View all / View branch say.
      let views = (await viewsOf(rows, viewer)).filter((v) => mayViewHolderReceipts(viewer, v.holderRole, v.userId));
      // Waiting for me: what the rules say waits for the caller (an approval theirs to give, or a question to them).
      if (scope === 'waiting') views = views.filter((v) => v.waitingReason != null);
      res.json({ expenses: views, ...(rows.length >= EXPENSE_LIST_CAP ? { truncated: true } : {}) });
    } catch (error) {
      console.error('[card-receipts] list failed:', error);
      res.status(500).json({ message: 'Could not load the expenses.' });
    }
  });

  /**
   * Export all (2026-11-23): every month at once, for one bank (`?bank=amex|encore`) or both. Only with the Export all
   * switch, and only the expenses the caller may see on screen: View all → everyone's, View branch → their team's,
   * else their own. Registered before anything with an :id.
   */
  router.get('/expenses/export', authenticate, anyOf(CARD_RECEIPTS.EXPORT, CARD_RECEIPTS.EXPORT_ALL), validateScalarRequest, async (req: Request, res: Response) => {
    const { bank = '', month = '' } = scalarQuery(req) as { bank?: string; month?: string };
    if (bank && !BANK_FILTERS.some((b) => b.key === bank)) return res.status(400).json({ message: 'Pick Amex, Encore or every bank.' });
    // Review S2 (2026-11-24): "Export" is one month's file, "Export all" every month — each enforced here, not only by the
    // screen's buttons, and every export is logged (who, which scope, how many).
    if (month ? !isMonth(month) : !has(req, CARD_RECEIPTS.EXPORT_ALL)) {
      return res.status(month ? 400 : 403).json({ message: month ? 'Provide a month as YYYY-MM.' : 'Access denied.' });
    }
    const me = userIdOf(req);
    try {
      const people = has(req, CARD_RECEIPTS.VIEW_ALL) ? {}
        : has(req, CARD_RECEIPTS.VIEW_BRANCH) ? await (async () => { const team = await teamOfRequest(req); return team === ALL_PEOPLE ? {} : { userIds: [...team] }; })()
          : { userId: me };
      const filter: db.ExpenseFilter = month ? { kind: 'month', month, ...people } : { kind: 'all', ...people };
      const rows = await db.listExpenses(filter);
      console.log(`[card-receipts] export by ${me}: ${month || 'all months'}${bank ? ` · ${bank}` : ''} · ${rows.length} expenses`);
      const viewer = approvalViewerOf(req);
      const views = (await viewsOf(rows, viewer)).filter((v) => onBank(v, bank) && mayViewHolderReceipts(viewer, v.holderRole, v.userId));
      res.json({ expenses: views, ...(rows.length >= EXPENSE_LIST_CAP ? { truncated: true } : {}) });
    } catch (error) {
      console.error('[card-receipts] export failed:', error);
      res.status(500).json({ message: 'Could not load the expenses.' });
    }
  });

  /**
   * A customer a receipt names must exist; its name is the record's own, never what the request typed.
   * Returns a problem to show, or '' (and sets `value.customerName`) when it's fine or there is no customer.
   */
  const customerProblem = async (value: { customerId: string; customerName: string }): Promise<string> => {
    if (!value.customerId) return '';
    if (!mongoose.isValidObjectId(value.customerId)) return 'Choose the customer from the list';
    const customer = await customerById(value.customerId);
    if (!customer) return 'That customer no longer exists. Choose another';
    value.customerName = String(customer.company || customer.contactName || value.customerName || '');
    return '';
  };

  const categoriesForSave = async () => (await categoriesList()).map(categoryView);

  /**
   * What a repeat's answer says about the receipt already saved. "Update the saved one" is offered only to whoever may edit it
   * (the edit route's own rule: Edit any, or the holder, or Manage cards on a draft / sent-back one) and only while it isn't approved.
   */
  const repeatInfoFor = (req: Request, existing: Loose) => {
    const own = String(existing.userId) === userIdOf(req);
    const mayEdit = has(req, CARD_RECEIPTS.EDIT_ANY) || (own ? has(req, CARD_RECEIPTS.USE) : has(req, CARD_RECEIPTS.MANAGE_CARDS) && managerMayEdit({ status: existing.status, voided: existing.voidedAt }));
    return repeatInfoOf(existing, { keepsApprovals: has(req, CARD_RECEIPTS.EDIT_ANY), mayEdit });
  };

  router.post('/expenses', authenticate, anyOf(CARD_RECEIPTS.USE, CARD_RECEIPTS.ADD_FOR_OTHERS), async (req: Request, res: Response) => {
    const body = req.body || {};
    const actorId = userIdOf(req);
    // Added on someone's behalf: it is theirs (their card, their name, their edits); only the history says who typed it.
    const forId = String(body.onBehalfOf || '').trim();
    const behalf = Boolean(forId) && forId !== actorId;
    if (behalf && !has(req, CARD_RECEIPTS.ADD_FOR_OTHERS)) return res.status(403).json({ message: 'You can add your own receipts only.' });
    if (!behalf && !has(req, CARD_RECEIPTS.USE)) return res.status(403).json({ message: 'Choose whose receipt this is.' });
    // One of a batch (Add several): its own switch on top of adding for others; the history keeps "3 of 5".
    const batch = body.batch;
    if (batch !== undefined && !isBatchMarker(batch)) return res.status(400).json({ message: 'That batch isn’t valid.' });
    if (batch !== undefined && !(has(req, CARD_RECEIPTS.ADD_SEVERAL) && has(req, CARD_RECEIPTS.ADD_FOR_OTHERS))) return res.status(403).json({ message: 'You can add one receipt at a time.' });
    if (behalf && !mongoose.isValidObjectId(forId)) return res.status(400).json({ message: 'Some fields need attention.', problems: { holder: 'Choose a cardholder.' } });
    const me = behalf ? forId : actorId;
    if (!mongoose.isValidObjectId(body.id)) return res.status(400).json({ message: 'The receipt has no id. Reload the page and try again.' });
    try {
      const existing = await db.findExpense(body.id);
      if (existing) {
        if (existing.userId !== me) return res.status(409).json({ message: 'That id belongs to another expense.' });
        return res.json({ expense: await viewOf(existing, approvalViewerOf(req)), alreadySaved: true });
      }
      let holder: Loose = userOf(req);
      if (behalf) {
        const [found] = await staffData.findUsers({ _id: { $in: [forId] } }, { select: 'username displayName location assignedLocations isActive' });
        if (!found || found.isActive === false) return res.status(400).json({ message: 'Some fields need attention.', problems: { holder: 'Choose an active cardholder.' } });
        holder = found;
      }
      const mine = await db.activeCardsOf(me);
      if (!mine.length) return res.status(409).json({ message: behalf ? `${nameOf(holder)} doesn’t have a company card set up yet.` : 'You don’t have a company card set up yet. Ask accounting to add it.' });
      const chosen = chooseCard(mine, body.cardId);
      if (!chosen.card) return res.status(400).json({ message: 'Some fields need attention.', problems: { card: chosen.problem } });
      const card = chosen.card;
      const categories = await categoriesForSave();
      // A hidden category can't start a new expense.
      const shown = categories.filter((c) => c.active);
      const { value, problems, missing } = cleanExpense(body, { today: todayOf(), categories: shown });
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      // No drafts (owner, 2026-11-26): nothing incomplete is saved.
      if (Object.keys(missing).length) return res.status(400).json({ message: INCOMPLETE_MESSAGE, problems: missing, incomplete: true });
      const file = await receiptFileOf(fileStore(), value.receiptUrl, '', actorId); // the file is the uploader's
      if (file.problem) return res.status(400).json({ message: 'Some fields need attention.', problems: { receipt: file.problem } });
      const noCustomer = await customerProblem(value);
      if (noCustomer) return res.status(400).json({ message: 'Some fields need attention.', problems: { customer: noCustomer } });
      if (body.confirmRepeat !== true) {
        // A Missing receipt row (an Amex charge with no upload yet) isn't a repeat: this upload takes its place.
        // Nor is an Admin's own charge still waiting for Accounting with nothing on it: the receipt replaces it too.
        const same = (await db.sameDayAmount(me, value.date, value.cents)).filter((e) => !isChargePlaceholder(e));
        const repeat = possibleRepeat(same.map((e) => ({ ...e, id: String(e._id) })) as never, { userId: me, date: value.date, cents: value.cents }) as Loose | null | undefined;
        if (repeat) return res.status(409).json({ message: 'This receipt looks already uploaded.', repeat: repeatInfoFor(req, repeat) });
      }
      const u = holder as { displayName?: string | null; username?: string | null; location?: string | null; assignedLocations?: string[] | null };
      const by = actor(req);
      const status = statusAfterSave(Object.keys(missing).length === 0, undefined, true);
      const changes = [behalf ? `on behalf of ${nameOf(u)}` : '', batch !== undefined ? batchNote(batch as BatchMarker) : '', status === 'waiting' ? 'sent for approval' : ''].filter(Boolean).join(' · ');
      const saved = await db.addExpense(body.id, {
        repeatCheck: body.confirmRepeat !== true,
        userId: me, holderName: nameOf(u), cardId: String(card._id), cardLabel: card.label, location: homeOf(u) || card.location || '',
        ...value, receiptHash: file.hash ?? '', month: monthOf(value.date), status, createdBy: by, addedById: behalf ? actorId : '',
        history: [{ at: new Date(), by, action: 'added', changes }]
      });
      if (!saved) {
        // The same save arrived twice at once: the other one got there first.
        const again = await db.findExpense(body.id);
        // The id is one person's: never hand back someone else's receipt.
        if (again && again.userId !== me) return res.status(409).json({ message: 'That id belongs to another expense.' });
        if (again) return res.json({ expense: await viewOf(again, approvalViewerOf(req)), alreadySaved: true });
        return res.status(500).json({ message: 'Could not save the receipt.' });
      }
      // The Amex check: a charge waiting for this receipt points at it, and its Missing receipt row goes.
      const replacedMissing = await afterReceiptSaved(saved, { id: actorId, name: by });
      res.status(201).json({ expense: await viewOf(saved, approvalViewerOf(req)), ...(replacedMissing ? { replacedMissing } : {}) });
    } catch (error) {
      if (error instanceof RepeatExpenseError) {
        return res.status(409).json({ message: error.message, repeat: repeatInfoFor(req, error.existing) });
      }
      console.error('[card-receipts] add failed:', error);
      res.status(500).json({ message: 'Could not save the receipt.' });
    }
  });

  const cleanOf = (e: Loose): CleanExpense => ({
    date: e.date, merchant: e.merchant, cents: e.cents, subtotalCents: e.subtotalCents ?? null, feesCents: e.feesCents ?? null, taxCents: e.taxCents ?? null,
    tipCents: e.tipCents ?? null, category: e.category || '', subcategory: e.subcategory || '', customerId: e.customerId || '', customerName: e.customerName || '',
    attendees: e.attendees || [], purpose: e.purpose || '', note: e.note || '', recurring: Boolean(e.recurring),
    receiptUrl: e.receiptUrl || '', lostReason: e.lostReason || ''
  });

  /** An edit of one expense (PUT, and "Update the saved one" below, which sends the merged body here). `note` is a word for the history line. */
  const editExpense = async (req: Request, res: Response, note = '') => {
    const { id } = scalarParams(req);
    const me = userIdOf(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    try {
      const expense = await db.findExpense(id);
      if (!expense) return res.status(404).json({ message: 'Expense not found.' });
      // "Edit any receipt" (Accounting): anyone's, approved ones too. "Manage cards": someone else's draft or sent-back one. Else the holder's own, until it is approved.
      const any = has(req, CARD_RECEIPTS.EDIT_ANY);
      const onBehalf = expense.userId !== me;
      if (any) {
        if (!anyoneMayEdit({ voided: expense.voidedAt })) return res.status(409).json({ message: 'A voided expense can’t be changed.' });
      } else if (onBehalf) {
        // Not theirs: only someone who manages cards, and only a draft or a sent-back one.
        if (!has(req, CARD_RECEIPTS.MANAGE_CARDS)) return res.status(404).json({ message: 'Expense not found.' });
        if (!managerMayEdit({ status: expense.status, voided: expense.voidedAt })) {
          return res.status(409).json({ message: expense.voidedAt ? 'A voided expense can’t be changed.' : 'Only a draft or a sent-back receipt can be changed for someone else.' });
        }
      } else {
        if (!has(req, CARD_RECEIPTS.USE)) return res.status(404).json({ message: 'Expense not found.' });
        if (!holderMayEdit({ status: expense.status, voided: expense.voidedAt })) {
          return res.status(409).json({ message: expense.voidedAt ? 'A voided expense can’t be changed.' : 'It’s approved, so it can’t be changed.' });
        }
      }
      // Accounting's change to a waiting or approved receipt keeps its status and approvals; the card choice is the holder's.
      const keepsState = any && (expense.status === 'waiting' || expense.status === 'approved');
      const holderId = String(expense.userId);
      const categories = await categoriesForSave();
      // The category it already has stays valid even if it was hidden since.
      const allowed = categories.filter((c) => c.active || c.name === expense.category);
      const { value, problems, missing } = cleanExpense(req.body || {}, { today: todayOf(), categories: allowed, currentSubcategory: expense.subcategory || '', currentLostReason: expense.lostReason || '' });
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      // No drafts (owner, 2026-11-26): an edit is complete too, except a statement row or an Admin's charge that needs no receipt.
      const stays = mayStayIncomplete(expense);
      if (Object.keys(missing).length && !stays) return res.status(400).json({ message: INCOMPLETE_MESSAGE, problems: missing, incomplete: true });
      const file = await receiptFileOf(fileStore(), value.receiptUrl, expense.receiptUrl || '', me);
      if (file.problem) return res.status(400).json({ message: 'Some fields need attention.', problems: { receipt: file.problem } });
      // A customer deleted since doesn't block editing the rest; picking a different one is checked.
      if (value.customerId && value.customerId !== (expense.customerId || '')) {
        const noCustomer = await customerProblem(value);
        if (noCustomer) return res.status(400).json({ message: 'Some fields need attention.', problems: { customer: noCustomer } });
      }
      // Matched to an Amex charge: Amex's day and amount stand.
      if ((value.date !== expense.date || value.cents !== expense.cents) && await amexChargeOf(id)) {
        return res.status(409).json({ message: matchedChangeProblem({ date: expense.date, cents: expense.cents }, value), problems: { total: 'Matched to Amex' } });
      }
      // A different card: one of this person's own, and not once the charge on a statement has claimed it.
      let newCard: Loose | null = null;
      const wantedCard = String(req.body?.cardId ?? '').trim();
      if (wantedCard && wantedCard !== String(expense.cardId)) {
        const chosen = chooseCard(await db.activeCardsOf(holderId), wantedCard);
        if (!chosen.card) return res.status(400).json({ message: 'Some fields need attention.', problems: { card: chosen.problem || 'Choose one of your cards.' } });
        if (await amexChargeOf(id)) return res.status(409).json({ message: 'It’s matched to a charge on a statement, so its card stands.', problems: { card: 'Matched to a statement charge' } });
        newCard = chosen.card;
      }
      const changes = [...changeSummary(cleanOf(expense), value), ...(newCard ? [`card ${expense.cardLabel} → ${newCard.label}`] : [])];
      const complete = Object.keys(missing).length === 0;
      const hasProof = Boolean(value.receiptUrl || value.lostReason);
      const status = !complete ? expense.status : any ? statusAfterAnyEdit(expense.status, complete, hasProof) : statusAfterSave(complete, expense.status, hasProof);
      if (!changes.length && status === expense.status) return res.json({ expense: await viewOf(expense, approvalViewerOf(req)), unchanged: true });
      const by = actor(req);
      const sentForApproval = status === 'waiting' && expense.status !== 'waiting';
      // An edit takes back every approval already given: the receipt starts its approvals again (an open question stays).
      const clearsApprovals = !keepsState && Boolean(expense.approval || expense.secondApproval) && changes.length > 0;
      const saved = await db.changeExpense(id, { ...value, ...(file.hash !== null ? { receiptHash: file.hash } : {}), ...(newCard ? { cardId: String(newCard._id), cardLabel: newCard.label } : {}), month: monthOf(value.date), status, ...(clearsApprovals ? { approval: null, secondApproval: null } : {}) },
        { at: new Date(), by, action: 'edited', expectedUpdatedAt: expense.updatedAt as Date, changes: [changes.join(', '), onBehalf ? `on behalf of ${String(expense.holderName || '').split(' ')[0] || 'the cardholder'}` : '', note, clearsApprovals ? 'approvals cleared' : '', sentForApproval ? 'sent for approval' : ''].filter(Boolean).join(' · ') });
      if (!saved) return res.status(404).json({ message: 'Expense not found.' });
      // A corrected day or total may now answer a charge that has a Missing receipt row: look again (no-op if it's already linked).
      const replacedMissing = changes.some((c) => c === 'date' || c === 'total') ? await afterReceiptSaved(saved, { id: me, name: by }) : null;
      res.json({ expense: await viewOf(saved, approvalViewerOf(req)), ...(replacedMissing ? { replacedMissing } : {}) });
    } catch (error) {
      if (error instanceof StaleExpenseError) return res.status(409).json({ message: error.message, changed: true });
      console.error('[card-receipts] edit failed:', error);
      res.status(500).json({ message: 'Could not save the change.' });
    }
  };
  router.put('/expenses/:id', authenticate, anyOf(CARD_RECEIPTS.USE, CARD_RECEIPTS.EDIT_ANY), validateScalarRequest, (req: Request, res: Response) => editExpense(req, res));

  /**
   * "Update the saved one" (owner, 2026-11-25): the receipt being added looked like one already saved (the 409 `repeat`), and it is.
   * Body: the new receipt's fields, as for an add. The saved one takes its photo, total and category (`mergeIntoSaved`), keeps its
   * merchant (the bank's report's) and everything else, and is edited like any other: the same who-may-edit rules, history and
   * approvals. An approved or voided one is refused for everyone, Accounting included.
   */
  router.post('/expenses/:id/merge', authenticate, anyOf(CARD_RECEIPTS.USE, CARD_RECEIPTS.EDIT_ANY), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    try {
      const expense = await db.findExpense(id);
      if (!expense) return res.status(404).json({ message: 'Expense not found.' });
      if (!mergeableRepeat({ status: expense.status, voided: expense.voidedAt })) {
        return res.status(409).json({ message: expense.voidedAt ? 'A voided expense can’t be changed.' : 'It’s approved, so it can’t be changed. Save this one as its own receipt instead.' });
      }
      const shown = (await categoriesForSave()).filter((c) => c.active);
      const incoming = cleanExpense(req.body || {}, { today: todayOf(), categories: shown });
      if (!incoming.value) return res.status(400).json({ message: 'Some fields need attention.', problems: incoming.problems });
      req.body = mergeIntoSaved(cleanOf(expense), incoming.value);
      return editExpense(req, res, 'updated from a new upload');
    } catch (error) {
      console.error('[card-receipts] merge failed:', error);
      res.status(500).json({ message: 'Could not save the change.' });
    }
  });

  // ── Approvals (rules: src/utils/receiptApproval.ts) ───────────────────────

  type Loaded = { expense: Loose; s: ApprovalState; viewer: ApprovalViewer };
  const trimmed = (v: unknown) => String(v ?? '').trim();
  const notLive = (s: ApprovalState) => (s.voided ? 'This expense was voided.' : s.status === 'approved' ? 'It’s already approved.' : 'It isn’t waiting for approval.');
  const OWN = 'You can’t decide on your own receipt.';
  const ACCOUNTING_ONLY = 'Only Accounting or an Admin can do that.';

  /**
   * The expense a decision is about, with the rules' view of it (its holder's role now). Answers 404 / 409 itself
   * and returns null then. The decision is made on what the person saw: if the receipt changed since, they look again.
   */
  const loadForDecision = async (req: Request, res: Response): Promise<Loaded | null> => {
    const { id } = scalarParams(req);
    const expense = mongoose.isValidObjectId(id) ? await db.findExpense(id) : null;
    if (!expense) { res.status(404).json({ message: 'Expense not found.' }); return null; }
    const seen = req.body?.expectedUpdatedAt;
    if (seen != null && new Date(String(seen)).getTime() !== new Date(expense.updatedAt as string).getTime()) {
      res.status(409).json({ message: 'This receipt changed after you opened it. Look at it again, then decide.', changed: true });
      return null;
    }
    const roles = await holderRolesOf([expense]);
    return { expense, s: stateOf(expense, roles.get(String(expense.userId)) ?? ''), viewer: approvalViewerOf(req) };
  };

  /** Writes under the stale check (refused if the row moved since it was read) and answers with the view. */
  const saveDecision = async (req: Request, res: Response, expense: Loose, set: Loose, action: db.ExpenseHistoryEntry['action'], changes: string) => {
    const saved = await db.changeExpense(String(expense._id), set, { at: new Date(), by: actor(req), action, expectedUpdatedAt: expense.updatedAt as Date, changes });
    if (!saved) { res.status(404).json({ message: 'Expense not found.' }); return null; }
    res.json({ expense: await viewOf(saved, approvalViewerOf(req)) });
    return saved;
  };

  const guarded = (label: string, fail: string, handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof StaleExpenseError) return res.status(409).json({ message: error.message, changed: true });
      console.error(`[card-receipts] ${label} failed:`, error);
      res.status(500).json({ message: fail });
    }
  };
  /** A refusal for an action the rules said no to: whose it is, whether it's still open, else `otherwise`. */
  const refuse = (res: Response, { s, viewer }: Loaded, otherwise: string, closed = notLive(s)) => {
    if (String(viewer.id) === String(s.userId)) return res.status(403).json({ message: OWN });
    if (s.voided || s.status !== 'waiting') return res.status(409).json({ message: closed });
    return res.status(403).json({ message: otherwise });
  };
  const fire = (label: string, job: () => unknown) => {
    void Promise.resolve().then(job).catch((e) => console.error(`[card-receipts] ${label} notice failed:`, (e as Error)?.message || e));
  };
  const personViewer = (p: Loose): ApprovalViewer => ({ id: String(p._id), role: String(p.role || ''), location: p.location || '', assignedLocations: p.assignedLocations || [] });
  // Who can be asked: someone who can approve (an answer approves), so their role must hold the Approve switch.
  const opensPage = (permissions: unknown) => Array.isArray(permissions) && permissions.includes(CARD_RECEIPTS.APPROVE);
  const slotLabel = (slot: Slot, as: string) =>
    slot === 'accounting' ? (as === 'admin' ? 'Accounting approval (Admin)' : 'Accounting approval') : `Second approval (${as === 'admin' ? 'Admin' : 'manager'})`;

  router.post('/expenses/:id/approve', authenticate, anyOf(CARD_RECEIPTS.APPROVE), validateScalarRequest, guarded('approve', 'Could not save your decision.', async (req, res) => {
    const comment = trimmed(req.body?.comment).slice(0, 500);
    const got = await loadForDecision(req, res);
    if (!got) return;
    const { expense, s, viewer } = got;
    if (s.voided || s.status !== 'waiting') return res.status(409).json({ message: notLive(s) });
    if (String(viewer.id) === String(s.userId)) return res.status(403).json({ message: 'You can’t approve your own receipt.' });
    if (askOpen(s)) {
      return res.status(403).json({ message: String(s.ask?.to) === String(viewer.id) ? 'A question is waiting for you: answer it to approve.' : 'A question about this receipt is still open. It can be approved once it’s answered.' });
    }
    const slot = slotFor(viewer, s);
    if (!slot) {
      const gaveOne = [s.approval, s.secondApproval].some((d) => d && String(d.by) === String(viewer.id));
      return res.status(403).json({ message: gaveOne ? 'You already gave one approval. The other must come from someone else.' : 'This receipt isn’t yours to approve.' });
    }
    const problem = approveProblem({ ...s, lostReason: expense.lostReason || '', receiptUrl: expense.receiptUrl || '', category: expense.category || '' }, comment);
    if (problem) return res.status(400).json({ message: problem, problems: holderKindOf(s.holderRole) === 'admin' ? { category: problem } : { comment: problem } });
    const as = approverAs(slot, viewer);
    const decision = { by: viewer.id, byName: actor(req), at: new Date(), comment, as };
    const next: ApprovalState = slot === 'accounting' ? { ...s, approval: decision } : { ...s, secondApproval: decision };
    const complete = fullyApproved(next);
    await saveDecision(req, res, expense, { [slot === 'accounting' ? 'approval' : 'secondApproval']: decision, status: complete ? 'approved' : 'waiting' }, 'approved',
      [slotLabel(slot, as), complete ? 'approved' : slot === 'accounting' ? 'waiting for the second approval' : 'waiting for Accounting', comment].filter(Boolean).join(' · '));
  }));

  router.post('/expenses/:id/send-back', authenticate, anyOf(CARD_RECEIPTS.APPROVE), validateScalarRequest, guarded('send back', 'Could not save your decision.', async (req, res) => {
    const comment = trimmed(req.body?.comment).slice(0, 500);
    const got = await loadForDecision(req, res);
    if (!got) return;
    if (!canSendBack(got.viewer, got.s)) return refuse(res, got, 'Only Accounting or an Admin sends a receipt back.');
    if (!comment) return res.status(400).json({ message: 'Say why it’s going back.', problems: { comment: 'Say why it’s going back' } });
    const sentBack = { by: got.viewer.id, byName: actor(req), at: new Date(), comment };
    const saved = await saveDecision(req, res, got.expense, { status: 'sent_back', sentBack, approval: null, secondApproval: null, ask: null }, 'sent back', comment);
    if (saved) pushReceiptSentBack(saved, comment); // the cardholder is told, with the reason
  }));

  router.get('/expenses/:id/ask-targets', authenticate, anyOf(CARD_RECEIPTS.APPROVE), validateScalarRequest, guarded('ask targets', 'Could not load who to ask.', async (req, res) => {
    const got = await loadForDecision(req, res);
    if (!got) return;
    const { s, viewer } = got;
    if (!canAsk(viewer, s)) return refuse(res, got, askOpen(s) ? 'A question is already open.' : ACCOUNTING_ONLY);
    const [people, roles] = await Promise.all([
      staffData.findUsers({}, { select: 'username displayName role location assignedLocations isActive' }),
      staffData.findRoles({}, { select: 'name permissions' })
    ]);
    const opens = new Set(roles.filter((r) => opensPage(r.permissions)).map((r) => String(r.name || '').trim().toLowerCase()));
    const rank = (p: Loose) => (isManagerRole(p.role) ? 0 : isAdminRole(p.role) ? 1 : 2);
    const list = people
      .filter((p) => p.isActive !== false && p.username !== 'admin' && opens.has(String(p.role || '').trim().toLowerCase()) && mayBeAsked(personViewer(p), s, viewer.id))
      .sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)));
    res.json({ people: list.map((p) => ({ id: String(p._id), name: nameOf(p), role: String(p.role || ''), branch: homeOf(p) })) });
  }));

  router.post('/expenses/:id/ask', authenticate, anyOf(CARD_RECEIPTS.APPROVE), validateScalarRequest, guarded('ask', 'Could not send the question.', async (req, res) => {
    const question = trimmed(req.body?.question);
    const to = trimmed(req.body?.to);
    const got = await loadForDecision(req, res);
    if (!got) return;
    const { expense, s, viewer } = got;
    if (!canAsk(viewer, s)) return askOpen(s) && s.status === 'waiting' && !s.voided
      ? res.status(409).json({ message: 'A question about this receipt is already open.' })
      : refuse(res, got, ACCOUNTING_ONLY);
    if (question.length < 5 || question.length > 500) {
      const why = question.length > 500 ? 'Keep the question under 500 characters' : 'Write the question';
      return res.status(400).json({ message: `${why}.`, problems: { question: why } });
    }
    const person = /^[0-9a-f]{24}$/i.test(to) ? await staffData.userById(to, { select: 'username displayName role location assignedLocations isActive' }) : null;
    if (!person || person.isActive === false || person.username === 'admin' || !mayBeAsked(personViewer(person), s, viewer.id)) {
      const why = holderKindOf(s.holderRole) === 'staff' ? 'Ask the cardholder’s branch manager or an Admin' : 'Ask an Admin';
      return res.status(400).json({ message: `${why}.`, problems: { to: why } });
    }
    const role = await staffData.findRole({ name: String(person.role || '').trim().toLowerCase() }, { select: 'permissions' });
    if (!opensPage(role?.permissions)) {
      return res.status(400).json({ message: 'They can’t approve receipts. Ask someone who can.', problems: { to: 'They can’t approve receipts' } });
    }
    const ask = { to: String(person._id), toName: nameOf(person), by: viewer.id, byName: actor(req), at: new Date(), question, answer: '', answeredAt: null };
    const tookBack = Boolean(s.approval);
    const saved = await saveDecision(req, res, expense, { ask, ...(tookBack ? { approval: null } : {}) }, 'asked',
      [`to ${ask.toName}: ${question}`, tookBack ? 'Accounting approval taken back' : ''].filter(Boolean).join(' · '));
    if (saved) fire('ask', () => notifyAsked(saved, ask, { base: siteBase(req) }));
  }));

  router.post('/expenses/:id/ask/withdraw', authenticate, anyOf(CARD_RECEIPTS.APPROVE), validateScalarRequest, guarded('withdraw', 'Could not withdraw the question.', async (req, res) => {
    const got = await loadForDecision(req, res);
    if (!got) return;
    const { expense, s, viewer } = got;
    if (!canWithdrawAsk(viewer, s)) return !askOpen(s) && s.status === 'waiting' && !s.voided
      ? res.status(409).json({ message: 'No question is open.' })
      : refuse(res, got, ACCOUNTING_ONLY);
    await saveDecision(req, res, expense, { ask: null }, 'question withdrawn', `${s.ask!.toName}: ${s.ask!.question}`);
  }));

  // The person asked answers (they may lack the Approve switch: the question is theirs).
  router.post('/expenses/:id/answer', opener, validateScalarRequest, guarded('answer', 'Could not save your answer.', async (req, res) => {
    const answer = trimmed(req.body?.answer);
    const got = await loadForDecision(req, res);
    if (!got) return;
    const { expense, s, viewer } = got;
    if (!canAnswer(viewer, s)) {
      if (s.voided || s.status !== 'waiting') return res.status(409).json({ message: notLive(s) });
      if (!askOpen(s)) return res.status(409).json({ message: 'This question was withdrawn or already answered.' });
      return res.status(403).json({ message: 'This question was for someone else.' });
    }
    if (answer.length < 2 || answer.length > 500) {
      const why = answer.length > 500 ? 'Keep the answer under 500 characters' : 'Write your answer';
      return res.status(400).json({ message: `${why}.`, problems: { answer: why } });
    }
    const now = new Date();
    const slot = slotForAnswer(viewer, s);
    const answered = { ...s.ask!, answer, answeredAt: now };
    const as = slot ? approverAs(slot, viewer) : null;
    const second = slot ? { by: viewer.id, byName: actor(req), at: now, comment: answer, as } : null;
    const complete = fullyApproved({ ...s, ask: answered, ...(second ? { secondApproval: second } : {}) });
    const saved = await saveDecision(req, res, expense, { ask: answered, ...(second ? { secondApproval: second } : {}), ...(complete ? { status: 'approved' } : {}) }, 'answered',
      [answer, slot && as ? slotLabel(slot, as) : '', complete ? 'approved' : ''].filter(Boolean).join(' · '));
    if (saved) fire('answer', () => notifyAnswered(saved, answered, { base: siteBase(req) }));
  }));

  router.post('/expenses/:id/reopen', authenticate, anyOf(CARD_RECEIPTS.APPROVE), validateScalarRequest, guarded('reopen', 'Could not reopen it.', async (req, res) => {
    const reason = trimmed(req.body?.reason);
    const got = await loadForDecision(req, res);
    if (!got) return;
    const { expense, s, viewer } = got;
    if (!canReopen(viewer, s)) {
      if (String(viewer.id) === String(s.userId)) return res.status(403).json({ message: OWN });
      if (s.voided || s.status !== 'approved') return res.status(409).json({ message: 'Only an approved receipt can be reopened.' });
      return res.status(403).json({ message: 'Only Accounting or an Admin reopens a receipt.' });
    }
    if (reason.length < 5 || reason.length > 300) {
      const why = reason.length > 300 ? 'Keep the reason under 300 characters' : 'Say why it’s being reopened';
      return res.status(400).json({ message: `${why}.`, problems: { reason: why } });
    }
    const saved = await saveDecision(req, res, expense, { status: 'waiting', approval: null, secondApproval: null }, 'reopened', reason);
    if (saved) pushReceiptReopened(saved, reason); // the cardholder is told, with the reason
  }));

  // An Admin's own receipt (their statement charge waits for Accounting): Accounting picks the category, type, customer and note.
  router.put('/expenses/:id/details', authenticate, anyOf(CARD_RECEIPTS.APPROVE), validateScalarRequest, guarded('details', 'Could not save the details.', async (req, res) => {
    const body = req.body || {};
    const got = await loadForDecision(req, res);
    if (!got) return;
    const { expense, s, viewer } = got;
    if (!canFillDetails(viewer, s)) return refuse(res, got, 'Only an Admin’s own receipt is filled in by Accounting or another Admin.');
    if (trimmed(body.note).length > 500) return res.status(400).json({ message: 'Some fields need attention.', problems: { note: 'Keep the note under 500 characters' } });
    const categories = await categoriesForSave();
    const allowed = categories.filter((c) => c.active || c.name === expense.category);
    // The receipt's own fields stay as they are: only what Accounting fills in comes from the request.
    const before = cleanOf(expense);
    const { value, problems } = cleanExpense({
      date: before.date, merchant: before.merchant, total: centsText(before.cents), subtotal: centsText(before.subtotalCents), fees: centsText(before.feesCents), tax: centsText(before.taxCents),
      tip: centsText(before.tipCents), receiptUrl: before.receiptUrl, lostReason: before.lostReason, attendees: before.attendees, purpose: before.purpose,
      recurring: before.recurring, category: body.category, subcategory: body.subcategory, customerId: body.customerId, customerName: '', note: body.note
    }, { today: todayOf(), categories: allowed, currentSubcategory: expense.subcategory || '', currentLostReason: expense.lostReason || '' });
    if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
    if (value.customerId && value.customerId !== before.customerId) {
      const noCustomer = await customerProblem(value);
      if (noCustomer) return res.status(400).json({ message: 'Some fields need attention.', problems: { customer: noCustomer } });
    } else if (value.customerId) {
      value.customerName = before.customerName;
    }
    const filled = { category: value.category, subcategory: value.subcategory, customerId: value.customerId, customerName: value.customerName, note: value.note };
    const changes = changeSummary(before, { ...before, ...filled });
    if (!changes.length) return res.json({ expense: await viewOf(expense, viewer), unchanged: true });
    await saveDecision(req, res, expense, filled, 'edited', `${changes.join(', ')} · filled in by ${actor(req)}`);
  }));

  /** Whether the caller may see this expense's receipt: the same people who may see the expense. */
  const mayViewReceipt = async (req: Request, e: Loose) => {
    if (String(e.userId) === userIdOf(req)) return true;
    // An Admin's own receipt: Accounting and Admins only (a director with View all, or the branch's manager, never).
    const holderRole = (await holderRolesOf([e])).get(String(e.userId)) ?? '';
    if (!mayViewHolderReceipts(approvalViewerOf(req), holderRole, e.userId)) return false;
    if (has(req, CARD_RECEIPTS.VIEW_ALL)) return true;
    if (has(req, CARD_RECEIPTS.VIEW_BRANCH)) {
      const team = await teamOfRequest(req);
      if (team === ALL_PEOPLE || team.has(String(e.userId))) return true;
    }
    const viewer = approvalViewerOf(req);
    // Who approves it: Accounting / an Admin, or a branch manager of the cardholder's branch (with Approve).
    if (has(req, CARD_RECEIPTS.APPROVE) && (isAccountingSide(viewer.role) || isBranchManagerOf(viewer, e.location))) return true;
    // The person a question about it went to (open or answered).
    if (e.ask && typeof e.ask === 'object' && String((e.ask as Loose).to) === viewer.id) return true;
    return false;
  };

  // A private receipt's file. Anyone else (and any name that isn't a receipt's) gets the same 404.
  router.get('/files/:name', opener, validateScalarRequest, async (req: Request, res: Response) => {
    const { name } = scalarParams(req);
    try {
      const store = fileStore();
      if (!isPrivateReceiptName(name) || !store) return res.status(404).json({ message: 'Receipt not found.' });
      const file = await store.get(`${PRIVATE_RECEIPT_KEY_PREFIX}${name}`);
      if (!file) return res.status(404).json({ message: 'Receipt not found.' });
      const expense = await db.findExpenseByReceipt(`${PRIVATE_RECEIPT_ROUTE}${name}`);
      // Not on an expense yet: only the person who uploaded it (the form is still open).
      const allowed = expense ? await mayViewReceipt(req, expense) : file.metadata.uploader === userIdOf(req);
      if (!allowed) return res.status(404).json({ message: 'Receipt not found.' });
      const type = /^(image\/(webp|jpeg|png|gif)|application\/pdf)$/.test(file.contentType) ? file.contentType : 'application/octet-stream';
      res.set({
        'Content-Type': type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox", 'Content-Disposition': 'inline'
      });
      res.send(file.body);
    } catch (error) {
      console.error('[card-receipts] receipt file failed:', error);
      res.status(500).json({ message: 'Could not open the receipt.' });
    }
  });

  /**
   * Review B2 (2026-11-24): a Missing receipt row's charge, with the holder's own receipts close to it
   * (amount within $5 / 10%, a week either side) — the receipt they may already have uploaded. Holder only.
   */
  router.get('/expenses/:id/near-receipts', authenticate, anyOf(CARD_RECEIPTS.USE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    try {
      const expense = await db.findExpense(id);
      if (!expense || expense.userId !== userIdOf(req)) return res.status(404).json({ message: 'Expense not found.' });
      const found = await nearReceiptsOf(id);
      res.json(found ?? { charge: null, receipts: [] });
    } catch (error) {
      console.error('[card-receipts] near receipts failed:', error);
      res.status(500).json({ message: 'Could not look for your receipts.' });
    }
  });

  /**
   * "This is my receipt" (review B2): the charge behind this Missing receipt row is answered by `receiptId`, a
   * receipt the holder already saved; the row is voided. Answers the receipt as it is now and `replacedMissing`.
   */
  router.post('/expenses/:id/use-receipt', authenticate, anyOf(CARD_RECEIPTS.USE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const me = userIdOf(req);
    const receiptId = String(req.body?.receiptId ?? '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    if (!mongoose.isValidObjectId(receiptId)) return res.status(400).json({ message: 'Pick the receipt this charge is.' });
    try {
      const expense = await db.findExpense(id);
      if (!expense || expense.userId !== me) return res.status(404).json({ message: 'Expense not found.' });
      const done = await matchByHand(id, receiptId, me, actorOf(req));
      const saved = await db.findExpense(done.receiptId);
      if (!saved) return res.status(404).json({ message: 'Expense not found.' });
      res.json({ expense: await viewOf(saved, approvalViewerOf(req)), replacedMissing: done.voided });
    } catch (error) {
      if (error instanceof NearMatchError) return res.status(409).json({ message: error.message });
      console.error('[card-receipts] match by hand failed:', error);
      res.status(500).json({ message: 'Could not use that receipt. Try again.' });
    }
  });

  router.post('/expenses/:id/void', authenticate, anyOf(CARD_RECEIPTS.USE, CARD_RECEIPTS.VOID_ANY), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const me = userIdOf(req);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    if (!reason) return res.status(400).json({ message: 'Say why it’s being voided.', problems: { reason: 'Say why it’s being voided' } });
    try {
      const expense = await db.findExpense(id);
      // "Void any receipt" (Accounting): anyone's, approved ones too. Otherwise only the holder's own, until it is approved.
      const any = has(req, CARD_RECEIPTS.VOID_ANY);
      if (!expense || !((expense.userId === me && has(req, CARD_RECEIPTS.USE)) || any)) return res.status(404).json({ message: 'Expense not found.' });
      if (expense.voidedAt) return res.json({ expense: await viewOf(expense, approvalViewerOf(req)), alreadyVoided: true });
      if (expense.status === 'approved' && !any) return res.status(409).json({ message: 'It’s approved, so it can’t be voided.' });
      // A receipt matched to a statement charge can't be voided. A **Missing receipt row** can (2026-11-25, owner), but only by
      // Void any receipt: the holder can't clear their own. The charge then reads "Removed" and the check makes no new row.
      if (await amexChargeOf(id)) {
        if (expense.status !== 'missing') return res.status(409).json({ message: 'This is a charge on the bank statement, so it can’t be voided. Add the receipt, or say why it’s lost.' });
        if (!any) return res.status(409).json({ message: 'A Missing receipt row is removed by Accounting. Add the receipt, or say why it’s lost.' });
      }
      const by = actor(req);
      const saved = await db.changeExpense(id, { voidedAt: new Date(), voidedBy: by, voidReason: reason }, { at: new Date(), by, action: 'voided', expectedUpdatedAt: expense.updatedAt as Date, changes: reason });
      if (!saved) return res.status(404).json({ message: 'Expense not found.' });
      res.json({ expense: await viewOf(saved, approvalViewerOf(req)) });
    } catch (error) {
      if (error instanceof StaleExpenseError) return res.status(409).json({ message: error.message, changed: true });
      console.error('[card-receipts] void failed:', error);
      res.status(500).json({ message: 'Could not void the expense.' });
    }
  });

  /**
   * Delete a receipt for good ("Delete receipts", admins). The whole record is saved to card_expense_deletions first, with who and
   * why. A receipt matched to a bank statement charge can't be deleted; a Missing receipt row can, and the saved copy stops the check making it again.
   */
  router.delete('/expenses/:id', authenticate, anyOf(CARD_RECEIPTS.DELETE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    const why = deleteReasonProblem(reason);
    if (why) return res.status(400).json({ message: why + '.', problems: { reason: why } });
    try {
      const expense = await db.findExpense(id);
      if (!expense) return res.status(404).json({ message: 'Expense not found.' });
      // A receipt matched to a statement charge can't be deleted, but a Missing receipt row can (2026-11-25, owner): the copy kept
      // in card_expense_deletions is what tells the check not to make it again.
      if (expense.status !== 'missing' && await amexChargeOf(id)) return res.status(409).json({ message: 'This is a charge on a bank statement, so it can’t be deleted. Add the receipt, or say why it’s lost.' });
      const gone = await db.deleteExpense(id, actor(req), reason);
      if (!gone) return res.status(404).json({ message: 'Expense not found.' });
      console.log(`[card-receipts] deleted ${id} (${expense.merchant}, ${expense.cents}c, ${expense.userId}) by ${actor(req)}: ${reason}`);
      res.json({ deleted: true, id });
    } catch (error) {
      console.error('[card-receipts] delete failed:', error);
      res.status(500).json({ message: 'Could not delete the expense.' });
    }
  });

  return router;
}
