import type { Request, RequestHandler, Response, NextFunction } from 'express';
import * as staffData from '../db/staff/index.ts';
import express from 'express';
import mongoose from 'mongoose';
import { validateScalarRequest, scalarQuery, scalarParams } from '../server/scalarRequest.ts';
import * as db from '../db/cardReceipts/index.ts';
import { newId } from '../db/ids.ts';
import rateLimit from 'express-rate-limit';
import { isFilesCdnUrl, isCloudinaryUrl } from '../utils/fileUrls.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { ALL_PEOPLE } from '../utils/teamScope.ts';
import { afterReceiptSaved, afterCardSaved, amexChargeOf, amexNameLookup } from '../db/cardStatements/hooks.ts';
import {
  CARD_RECEIPTS, PAGE_PERMISSIONS, STARTING_CATEGORIES, startingSubcategories, categoryKey, cleanCategory, cleanCard, cleanExpense,
  statusAfterSave, holderMayEdit, changeSummary, possibleRepeat, canApprove, approvalStep, isBigReceipt, isBigReceiptApprover, BIG_RECEIPT_CENTS, cleanApproverRoles, decisionProblem,
  isMonth, monthOf, matchedChangeProblem, isReceiptFolderUrl, type CleanExpense
} from '../utils/cardReceipts.ts';
import type { Loose } from '../types/records.ts';

/**
 * Credit Card Receipts (Accounting). Rules: src/utils/cardReceipts.ts.
 *
 *   GET    /me                       the caller's card, the categories, whose receipts they approve
 *   GET    /categories               the Admin list (hidden ones too; screens decide)
 *   POST   /categories               add              (add_receipt_categories)
 *   PUT    /:id under /categories    rename, fields, hide / show (edit_receipt_categories)
 *   PATCH  /categories/reorder       { ids } the whole list in its new order (reorder_receipt_categories)
 *   GET    /categories/:id/uses      how many expenses use it (delete_receipt_categories)
 *   DELETE /categories/:id           { replaceWith } when expenses use it: they move first
 *   GET    /cards                    cards and the people who can hold one (manage_company_cards, or view all)
 *   POST   /cards, PUT /cards/:id    (manage_company_cards) one active card per person
 *   POST   /attachments              { data } a photo or PDF → { url }, the moment it's picked
 *   GET    /expenses?scope=&month=   mine (default) · all (view all, or view branch: the caller's team) · waiting (what the caller may approve, any month)
 *   POST   /expenses                 add, with the screen's own `id` (a repeat answers alreadySaved);
 *                                    the same day + total already saved answers 409 `repeat` unless `confirmRepeat`
 *   PUT    /expenses/:id             the cardholder, until it's approved
 *   POST   /expenses/:id/approve     { comment } (needed for a lost receipt)
 *   POST   /expenses/:id/send-back   { comment }
 *   POST   /expenses/:id/void        { reason } the cardholder, until it's approved
 *
 *   app.use('/api/card-receipts', createCardReceiptsRouter({ authenticate, processBase64Image }));
 */

type ReqUser = { id?: string; _id?: string; username?: string; displayName?: string; role?: string; permissions?: string[]; location?: string; assignedLocations?: string[] };
const userOf = (req: Request) => ((req as Request & { user?: ReqUser }).user || {}) as ReqUser;
const userIdOf = (req: Request) => String(userOf(req).id || userOf(req)._id || '');
const nameOf = (u: { displayName?: string | null; username?: string | null }) => u.displayName || u.username || '';
const has = (req: Request, perm: string) => (userOf(req).permissions || []).includes(perm);
const homeOf = (u: { location?: string | null; assignedLocations?: string[] | null }) =>
  u.location || (u.assignedLocations || []).find((l) => l && l !== '*') || '';
const todayOf = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

/** The receipt link must be a file this app stored for a receipt; one already on the expense may stay. */
const receiptLinkProblem = (url: string, current = '') =>
  !url || url === current || (isReceiptFolderUrl(url) && (isFilesCdnUrl(url) || isCloudinaryUrl(url) || /^\/uploads\//.test(url)))
    ? '' : 'Upload the receipt again';
const MAX_UPLOAD_CHARS = 14_000_000; // about a 10 MB file as base64

const anyOf = (...perms: readonly string[]) => (req: Request, res: Response, next: NextFunction) =>
  (perms.some((p) => has(req, p)) ? next() : res.status(403).json({ message: 'Access denied.' }));

const categoryView = (c: Loose) => ({
  _id: String(c._id), name: c.name, label: c.label, order: c.order ?? 0, active: c.active !== false,
  fields: { customer: Boolean(c.fields?.customer), attendees: Boolean(c.fields?.attendees), purpose: Boolean(c.fields?.purpose), recurring: Boolean(c.fields?.recurring) },
  subcategories: ((c.subcategories || []) as Loose[]).map((s) => ({
    name: String(s.name), label: String(s.label), active: s.active !== false, isDefault: Boolean(s.isDefault),
    fields: { customer: Boolean(s.fields?.customer), attendees: Boolean(s.fields?.attendees), purpose: Boolean(s.fields?.purpose), recurring: Boolean(s.fields?.recurring) }
  }))
});
const cardView = (c: Loose) => ({ _id: String(c._id), userId: c.userId, label: c.label, issuer: c.issuer, lastDigits: c.lastDigits, amexName: c.amexName || '', active: c.active !== false });
const expenseView = (e: Loose, viewer: { id: string; approvable: Set<string>; bigApprover?: boolean }) => ({
  id: String(e._id), userId: e.userId, holderName: e.holderName, cardId: e.cardId, cardLabel: e.cardLabel, location: e.location,
  date: e.date, merchant: e.merchant, cents: e.cents, subtotalCents: e.subtotalCents ?? null, taxCents: e.taxCents ?? null, tipCents: e.tipCents ?? null,
  category: e.category || '', subcategory: e.subcategory || '', customerId: e.customerId || '', customerName: e.customerName || '', attendees: e.attendees || [],
  purpose: e.purpose || '', note: e.note || '', recurring: Boolean(e.recurring), receiptUrl: e.receiptUrl || '', lostReason: e.lostReason || '',
  status: e.status, approval: e.approval || null, sentBack: e.sentBack || null,
  voided: e.voidedAt ? { at: e.voidedAt, by: e.voidedBy || '', reason: e.voidReason || '' } : null,
  createdAt: e.createdAt, updatedAt: e.updatedAt, history: e.history || [],
  mine: e.userId === viewer.id,
  canDecide: e.status === 'waiting' && !e.voidedAt && e.userId !== viewer.id && (approvalStep(e) === 2 ? Boolean(viewer.bigApprover) && e.approval?.by !== viewer.id : viewer.approvable.has(e.userId)),
  step: approvalStep({ ...e, voided: e.voidedAt })
});

/** Seeds the starting list into an empty collection, once. */
async function categoriesList() {
  let list = await db.listCategories();
  if (!list.length) {
    await db.seedCategories(STARTING_CATEGORIES.map((c, i) => ({ _id: newId(), name: categoryKey(c.label), label: c.label, order: i, fields: { ...c.fields }, subcategories: startingSubcategories(c) })));
    list = await db.listCategories();
  }
  return list;
}

/** The roles whose receipts this caller's role approves (Roles & Permissions), or none without the switch. */
async function approverRolesOf(req: Request) {
  if (!has(req, CARD_RECEIPTS.APPROVE)) return [];
  const role = await staffData.findRole({ name: String(userOf(req).role || '').trim().toLowerCase() }, { select: 'approvesCardReceiptsOf' });
  return cleanApproverRoles((role as Loose)?.approvesCardReceiptsOf);
}

/** The ids of every person whose receipts the caller may approve (never themselves). */
async function approvableIds(req: Request) {
  const roles = await approverRolesOf(req);
  if (!roles.length) return new Set<string>();
  const people = await staffData.findUsers({ role: { $in: roles } }, { select: '_id role' });
  const me = userIdOf(req);
  return new Set(people.map((p) => String(p._id)).filter((id) => id !== me));
}

export default function createCardReceiptsRouter({ authenticate, processBase64Image }: {
  authenticate: RequestHandler;
  processBase64Image: (data: string, folder?: string, maxSide?: number) => Promise<unknown>;
}) {
  const router = express.Router();
  const opener = [authenticate, anyOf(...PAGE_PERMISSIONS)];
  const uploader = (req: Request) => userIdOf(req) || 'anonymous';
  const uploadLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 40, keyGenerator: uploader, standardHeaders: true, legacyHeaders: false, validate: false, message: { message: 'Too many uploads. Wait a few minutes.' } });
  const actor = (req: Request) => nameOf(userOf(req));
  const actorOf = (req: Request) => ({ id: userIdOf(req), name: actor(req) });

  router.get('/me', opener, async (req: Request, res: Response) => {
    try {
      const me = userIdOf(req);
      const [card, categories, roles] = await Promise.all([
        db.activeCardOf(me), categoriesList(), approverRolesOf(req)
      ]);
      const u = userOf(req);
      res.json({
        user: { id: me, name: nameOf(u), location: homeOf(u) },
        card: card ? cardView(card) : null,
        categories: categories.map(categoryView),
        approverRoles: roles,
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

  router.get('/cards', authenticate, anyOf(CARD_RECEIPTS.MANAGE_CARDS, CARD_RECEIPTS.VIEW_ALL), async (_req: Request, res: Response) => {
    try {
      const [cards, people, amexName] = await Promise.all([
        db.listCards(),
        staffData.findUsers({}, { select: 'username displayName role location assignedLocations isActive', sort: { displayName: 1 } }),
        amexNameLookup()
      ]);
      res.json({
        // statementName: the Card Member name on the uploaded Amex statements for this card, the starting value for amexName (Amex check).
        cards: cards.map((c) => ({ ...cardView(c), statementName: amexName(String(c.lastDigits || '')) })),
        people: people.filter((p) => p.username !== 'admin').map((p) => ({
          id: String(p._id), name: nameOf(p), role: p.role || '', location: homeOf(p), active: p.isActive !== false
        }))
      });
    } catch (error) {
      console.error('[card-receipts] cards failed:', error);
      res.status(500).json({ message: 'Could not load the cards.' });
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
    if (active) {
      const clash = await db.activeCardClash(value.userId, value.label, card ? String(card._id) : null);
      if (clash) {
        const problems = value.userId && clash.userId === value.userId ? { userId: `They already have card ${clash.label}. Deactivate it first.` } : { label: 'Another active card has that ID' };
        return res.status(409).json({ message: 'One card per person.', problems });
      }
    }
    const fields = { ...value, active, updatedBy: actor(req) };
    const saved = card ? await db.changeCard(String(card._id), fields) : await db.addCard(newId(), fields);
    if (!saved) return res.status(404).json({ message: 'Card not found.' });
    // The Amex check: a card that just got its holder asks for the receipts its charges are missing.
    await afterCardSaved(actorOf(req));
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

  // ── Receipts ──────────────────────────────────────────────────────────────

  router.post('/attachments', authenticate, anyOf(CARD_RECEIPTS.USE), uploadLimit, async (req: Request, res: Response) => {
    const data = req.body?.data;
    if (typeof data === 'string' && data.length > MAX_UPLOAD_CHARS) return res.status(413).json({ message: 'That file is too large. Use a photo under 10 MB.' });
    if (typeof data !== 'string' || !/^data:(image\/|application\/pdf)/.test(data)) {
      return res.status(400).json({ message: 'Send a photo or a PDF of the receipt.' });
    }
    try {
      // Receipts keep up to 2000px (visit photos 1000) so the print stays readable when zoomed.
      const url = await processBase64Image(data, 'CardReceipts', 2000);
      // processBase64Image hands the data back when the upload fails.
      if (typeof url !== 'string' || url.startsWith('data:')) return res.status(502).json({ message: 'Could not store the receipt. Try again.' });
      res.json({ url });
    } catch (error) {
      console.error('[card-receipts] attachment failed:', error);
      res.status(502).json({ message: 'Could not store the receipt. Try again.' });
    }
  });

  router.get('/expenses', opener, validateScalarRequest, async (req: Request, res: Response) => {
    const { scope = '', month = '' } = scalarQuery(req) as { scope?: string; month?: string };
    const me = userIdOf(req);
    try {
      const approvable = await approvableIds(req);
      const bigApprover = has(req, CARD_RECEIPTS.APPROVE) && isBigReceiptApprover(userOf(req).role);
      let filter: db.ExpenseFilter;
      if (scope === 'waiting') {
        filter = { kind: 'waiting', userIds: [...approvable], ...(bigApprover ? { overCents: BIG_RECEIPT_CENTS } : {}) };
      } else {
        if (!isMonth(month)) return res.status(400).json({ message: 'Provide a month as YYYY-MM.' });
        if (scope === 'all') {
          if (has(req, CARD_RECEIPTS.VIEW_ALL)) {
            filter = { kind: 'month', month };
          } else if (has(req, CARD_RECEIPTS.VIEW_BRANCH)) {
            // Everyone on the caller's team, by where the person works (the Visits rule, teamScope.ts).
            const team = await teamOfRequest(req);
            filter = team === ALL_PEOPLE ? { kind: 'month', month } : { kind: 'month', month, userIds: [...team] };
          } else {
            return res.status(403).json({ message: 'You can see your own expenses only.' });
          }
        } else {
          filter = { kind: 'month', month, userId: me };
        }
      }
      let rows = await db.listExpenses(filter);
      // Waiting for me: a big receipt is the Accounting / Director / Admin step alone, never your own.
      if (scope === 'waiting') rows = rows.filter((e) => e.userId !== me && (approvalStep(e) === 2 ? bigApprover && e.approval?.by !== me : approvable.has(e.userId)));
      res.json({ expenses: rows.map((e) => expenseView(e, { id: me, approvable, bigApprover })) });
    } catch (error) {
      console.error('[card-receipts] list failed:', error);
      res.status(500).json({ message: 'Could not load the expenses.' });
    }
  });

  const categoriesForSave = async () => (await categoriesList()).map(categoryView);

  router.post('/expenses', authenticate, anyOf(CARD_RECEIPTS.USE), async (req: Request, res: Response) => {
    const body = req.body || {};
    const me = userIdOf(req);
    if (!mongoose.isValidObjectId(body.id)) return res.status(400).json({ message: 'The receipt has no id. Reload the page and try again.' });
    try {
      const existing = await db.findExpense(body.id);
      if (existing) {
        if (existing.userId !== me) return res.status(409).json({ message: 'That id belongs to another expense.' });
        return res.json({ expense: expenseView(existing, { id: me, approvable: new Set() }), alreadySaved: true });
      }
      const card = await db.activeCardOf(me);
      if (!card) return res.status(409).json({ message: 'You don’t have a company card set up yet. Ask accounting to add it.' });
      const categories = await categoriesForSave();
      // A hidden category can't start a new expense.
      const shown = categories.filter((c) => c.active);
      const { value, problems, missing } = cleanExpense(body, { today: todayOf(), categories: shown });
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      const linkProblem = receiptLinkProblem(value.receiptUrl);
      if (linkProblem) return res.status(400).json({ message: 'Some fields need attention.', problems: { receipt: linkProblem } });
      if (body.confirmRepeat !== true) {
        // A Missing receipt row (an Amex charge with no upload yet) isn't a repeat: this upload takes its place.
        const same = (await db.sameDayAmount(me, value.date, value.cents)).filter((e) => e.status !== 'missing');
        const repeat = possibleRepeat(same.map((e) => ({ ...e, id: String(e._id) })) as never, { userId: me, date: value.date, cents: value.cents }) as Loose | null | undefined;
        if (repeat) return res.status(409).json({ message: 'This receipt looks already uploaded.', repeat: { id: String(repeat._id), merchant: repeat.merchant, date: repeat.date, cents: repeat.cents } });
      }
      const u = userOf(req);
      const by = actor(req);
      const status = statusAfterSave(Object.keys(missing).length === 0);
      const saved = await db.addExpense(body.id, {
        userId: me, holderName: nameOf(u), cardId: String(card._id), cardLabel: card.label, location: homeOf(u),
        ...value, month: monthOf(value.date), status, createdBy: by,
        history: [{ at: new Date(), by, action: 'added', changes: status === 'waiting' ? 'sent for approval' : '' }]
      });
      if (!saved) {
        // The same save arrived twice at once: the other one got there first.
        const again = await db.findExpense(body.id);
        if (again) return res.json({ expense: expenseView(again, { id: me, approvable: new Set() }), alreadySaved: true });
        return res.status(500).json({ message: 'Could not save the receipt.' });
      }
      // The Amex check: a charge waiting for this receipt points at it, and its Missing receipt row goes.
      const replacedMissing = await afterReceiptSaved(saved, { id: me, name: by });
      res.status(201).json({ expense: expenseView(saved, { id: me, approvable: new Set() }), ...(replacedMissing ? { replacedMissing } : {}) });
    } catch (error) {
      console.error('[card-receipts] add failed:', error);
      res.status(500).json({ message: 'Could not save the receipt.' });
    }
  });

  const cleanOf = (e: Loose): CleanExpense => ({
    date: e.date, merchant: e.merchant, cents: e.cents, subtotalCents: e.subtotalCents ?? null, taxCents: e.taxCents ?? null,
    tipCents: e.tipCents ?? null, category: e.category || '', subcategory: e.subcategory || '', customerId: e.customerId || '', customerName: e.customerName || '',
    attendees: e.attendees || [], purpose: e.purpose || '', note: e.note || '', recurring: Boolean(e.recurring),
    receiptUrl: e.receiptUrl || '', lostReason: e.lostReason || ''
  });

  router.put('/expenses/:id', authenticate, anyOf(CARD_RECEIPTS.USE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const me = userIdOf(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    try {
      const expense = await db.findExpense(id);
      if (!expense || expense.userId !== me) return res.status(404).json({ message: 'Expense not found.' });
      if (!holderMayEdit({ status: expense.status, voided: expense.voidedAt })) {
        return res.status(409).json({ message: expense.voidedAt ? 'A voided expense can’t be changed.' : 'It’s approved, so it can’t be changed.' });
      }
      const categories = await categoriesForSave();
      // The category it already has stays valid even if it was hidden since.
      const allowed = categories.filter((c) => c.active || c.name === expense.category);
      const { value, problems, missing } = cleanExpense(req.body || {}, { today: todayOf(), categories: allowed, currentSubcategory: expense.subcategory || '' });
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      const linkProblem = receiptLinkProblem(value.receiptUrl, expense.receiptUrl || '');
      if (linkProblem) return res.status(400).json({ message: 'Some fields need attention.', problems: { receipt: linkProblem } });
      // Matched to an Amex charge: Amex's day and amount stand.
      if ((value.date !== expense.date || value.cents !== expense.cents) && await amexChargeOf(id)) {
        return res.status(409).json({ message: matchedChangeProblem({ date: expense.date, cents: expense.cents }, value), problems: { total: 'Matched to Amex' } });
      }
      const changes = changeSummary(cleanOf(expense), value);
      const status = statusAfterSave(Object.keys(missing).length === 0, expense.status);
      if (!changes.length && status === expense.status) return res.json({ expense: expenseView(expense, { id: me, approvable: new Set() }), unchanged: true });
      const by = actor(req);
      const sentForApproval = status === 'waiting' && expense.status !== 'waiting';
      // An edit takes back a step 1 already given: the receipt starts its approvals again.
      const clearsStep1 = Boolean(expense.approval?.by) && changes.length > 0;
      const saved = await db.changeExpense(id, { ...value, month: monthOf(value.date), status, ...(clearsStep1 ? { approval: null } : {}) },
        { at: new Date(), by, action: 'edited', changes: [changes.join(', '), clearsStep1 ? 'step 1 approval cleared' : '', sentForApproval ? 'sent for approval' : ''].filter(Boolean).join(' · ') });
      if (!saved) return res.status(404).json({ message: 'Expense not found.' });
      res.json({ expense: expenseView(saved, { id: me, approvable: new Set() }) });
    } catch (error) {
      console.error('[card-receipts] edit failed:', error);
      res.status(500).json({ message: 'Could not save the change.' });
    }
  });

  const decide = (action: 'approve' | 'send_back') => async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const comment = String(req.body?.comment ?? '').trim().slice(0, 500);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    try {
      const expense = await db.findExpense(id);
      if (!expense) return res.status(404).json({ message: 'Expense not found.' });
      // The approver decides on what they saw: if the cardholder changed it since, they look again.
      const seen = req.body?.expectedUpdatedAt;
      if (seen != null && new Date(String(seen)).getTime() !== new Date(expense.updatedAt as string).getTime()) {
        return res.status(409).json({ message: 'This receipt changed after you opened it. Look at it again, then decide.', changed: true });
      }
      const holder = await staffData.userById(expense.userId, { select: 'role' });
      const approver = { id: userIdOf(req), role: userOf(req).role, permissions: userOf(req).permissions || [] };
      if (!canApprove({ approver, approverRoles: await approverRolesOf(req), holder: holder ? { id: expense.userId, role: holder.role } : null, cents: expense.cents, step1By: expense.approval?.by })) {
        return res.status(403).json({ message: approver.id === expense.userId ? 'You can’t approve your own expense.' : approvalStep(expense) === 2 ? 'This receipt is over $150 and waits for Accounting, a Director or an Admin (not the person who gave step 1).' : 'You can’t approve this person’s receipts.' });
      }
      const problem = decisionProblem(action, { status: expense.status, lostReason: expense.lostReason, voided: expense.voidedAt }, comment);
      if (problem) return res.status(expense.status === 'waiting' ? 400 : 409).json({ message: problem, problems: { comment: problem } });
      const by = actor(req);
      const decision = { by: approver.id, byName: by, at: new Date(), comment };
      // Over $150 the first approval only moves it to Accounting: it stays waiting, with step 1 kept in `approval`.
      const stepOne = action === 'approve' && isBigReceipt(expense.cents) && !expense.approval?.by;
      const saved = await db.changeExpense(id,
        action === 'approve' ? { status: stepOne ? 'waiting' : 'approved', approval: decision } : { status: 'sent_back', sentBack: decision, approval: null },
        { at: new Date(), by, action: action === 'approve' ? 'approved' : 'sent back',
          changes: [action === 'approve' && isBigReceipt(expense.cents) ? (stepOne ? 'Step 1 of 2, now with Accounting' : 'Step 2 of 2') : '', comment].filter(Boolean).join(' · ') });
      if (!saved) return res.status(404).json({ message: 'Expense not found.' });
      res.json({ expense: expenseView(saved, { id: approver.id, approvable: new Set() }) });
    } catch (error) {
      console.error(`[card-receipts] ${action} failed:`, error);
      res.status(500).json({ message: 'Could not save your decision.' });
    }
  };
  router.post('/expenses/:id/approve', authenticate, anyOf(CARD_RECEIPTS.APPROVE), validateScalarRequest, decide('approve'));
  router.post('/expenses/:id/send-back', authenticate, anyOf(CARD_RECEIPTS.APPROVE), validateScalarRequest, decide('send_back'));

  router.post('/expenses/:id/void', authenticate, anyOf(CARD_RECEIPTS.USE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const me = userIdOf(req);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    if (!reason) return res.status(400).json({ message: 'Say why it’s being voided.', problems: { reason: 'Say why it’s being voided' } });
    try {
      const expense = await db.findExpense(id);
      if (!expense || expense.userId !== me) return res.status(404).json({ message: 'Expense not found.' });
      if (expense.voidedAt) return res.json({ expense: expenseView(expense, { id: me, approvable: new Set() }), alreadyVoided: true });
      if (expense.status === 'approved') return res.status(409).json({ message: 'It’s approved, so it can’t be voided.' });
      if (await amexChargeOf(id)) return res.status(409).json({ message: 'This is a charge on the Amex statement, so it can’t be voided. Add the receipt, or say why it’s lost.' });
      const by = actor(req);
      const saved = await db.changeExpense(id, { voidedAt: new Date(), voidedBy: by, voidReason: reason }, { at: new Date(), by, action: 'voided', changes: reason });
      if (!saved) return res.status(404).json({ message: 'Expense not found.' });
      res.json({ expense: expenseView(saved, { id: me, approvable: new Set() }) });
    } catch (error) {
      console.error('[card-receipts] void failed:', error);
      res.status(500).json({ message: 'Could not void the expense.' });
    }
  });

  return router;
}
