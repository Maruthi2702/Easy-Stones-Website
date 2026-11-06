import type { Request, RequestHandler, Response, NextFunction } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import { validateScalarRequest, scalarQuery, scalarParams } from '../server/scalarRequest.ts';
import { CompanyCard, ReceiptCategory, CardExpense } from '../models/CardReceipts.ts';
import Role from '../models/Role.ts';
import User from '../models/User.ts';
import {
  CARD_RECEIPTS, PAGE_PERMISSIONS, STARTING_CATEGORIES, categoryKey, cleanCategory, cleanCard, cleanExpense,
  statusAfterSave, holderMayEdit, changeSummary, possibleRepeat, canApprove, cleanApproverRoles, decisionProblem,
  isMonth, monthOf, type CleanExpense
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
 *   GET    /expenses?scope=&month=   mine (default) · all (view all) · waiting (what the caller may approve, any month)
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

const anyOf = (...perms: readonly string[]) => (req: Request, res: Response, next: NextFunction) =>
  (perms.some((p) => has(req, p)) ? next() : res.status(403).json({ message: 'Access denied.' }));

const categoryView = (c: Loose) => ({
  _id: String(c._id), name: c.name, label: c.label, order: c.order ?? 0, active: c.active !== false,
  fields: { customer: Boolean(c.fields?.customer), attendees: Boolean(c.fields?.attendees), purpose: Boolean(c.fields?.purpose), recurring: Boolean(c.fields?.recurring) }
});
const cardView = (c: Loose) => ({ _id: String(c._id), userId: c.userId, label: c.label, issuer: c.issuer, lastDigits: c.lastDigits, active: c.active !== false });
const expenseView = (e: Loose, viewer: { id: string; approvable: Set<string> }) => ({
  id: String(e._id), userId: e.userId, holderName: e.holderName, cardId: e.cardId, cardLabel: e.cardLabel, location: e.location,
  date: e.date, merchant: e.merchant, cents: e.cents, subtotalCents: e.subtotalCents ?? null, taxCents: e.taxCents ?? null, tipCents: e.tipCents ?? null,
  category: e.category || '', customerId: e.customerId || '', customerName: e.customerName || '', attendees: e.attendees || [],
  purpose: e.purpose || '', note: e.note || '', recurring: Boolean(e.recurring), receiptUrl: e.receiptUrl || '', lostReason: e.lostReason || '',
  status: e.status, approval: e.approval || null, sentBack: e.sentBack || null,
  voided: e.voidedAt ? { at: e.voidedAt, by: e.voidedBy || '', reason: e.voidReason || '' } : null,
  createdAt: e.createdAt, updatedAt: e.updatedAt, history: e.history || [],
  mine: e.userId === viewer.id,
  canDecide: e.status === 'waiting' && !e.voidedAt && e.userId !== viewer.id && viewer.approvable.has(e.userId)
});

/** Seeds the starting list into an empty collection, once. */
async function categoriesList() {
  let list = await ReceiptCategory.find({}).sort({ order: 1, _id: 1 }).lean();
  if (!list.length) {
    const docs = STARTING_CATEGORIES.map((c, i) => ({ name: categoryKey(c.label), label: c.label, order: i, fields: { ...c.fields } }));
    await ReceiptCategory.insertMany(docs, { ordered: false }).catch(() => undefined);
    list = await ReceiptCategory.find({}).sort({ order: 1, _id: 1 }).lean();
  }
  return list;
}

/** The roles whose receipts this caller's role approves (Roles & Permissions), or none without the switch. */
async function approverRolesOf(req: Request) {
  if (!has(req, CARD_RECEIPTS.APPROVE)) return [];
  const role = await Role.findOne({ name: String(userOf(req).role || '').trim().toLowerCase() }, 'approvesCardReceiptsOf').lean();
  return cleanApproverRoles((role as Loose)?.approvesCardReceiptsOf);
}

/** The ids of every person whose receipts the caller may approve (never themselves). */
async function approvableIds(req: Request) {
  const roles = await approverRolesOf(req);
  if (!roles.length) return new Set<string>();
  const people = await User.find({ role: { $in: roles } }, '_id role').lean();
  const me = userIdOf(req);
  return new Set(people.map((p) => String(p._id)).filter((id) => id !== me));
}

export default function createCardReceiptsRouter({ authenticate, processBase64Image }: {
  authenticate: RequestHandler;
  processBase64Image: (data: string, folder?: string, maxSide?: number) => Promise<unknown>;
}) {
  const router = express.Router();
  const opener = [authenticate, anyOf(...PAGE_PERMISSIONS)];
  const actor = (req: Request) => nameOf(userOf(req));

  router.get('/me', opener, async (req: Request, res: Response) => {
    try {
      const me = userIdOf(req);
      const [card, categories, roles] = await Promise.all([
        CompanyCard.findOne({ userId: me, active: true }).lean(), categoriesList(), approverRolesOf(req)
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
      const saved = await ReceiptCategory.create({ name, ...value, order, updatedBy: actor(req) });
      res.status(201).json({ category: categoryView(saved.toObject()) });
    } catch (error) {
      console.error('[card-receipts] add category failed:', error);
      res.status(500).json({ message: 'Could not add the category.' });
    }
  });

  router.patch('/categories/reorder', authenticate, anyOf(CARD_RECEIPTS.CATEGORY_REORDER), async (req: Request, res: Response) => {
    const ids: unknown = req.body?.ids;
    try {
      const list = await ReceiptCategory.find({}, '_id').lean();
      const known = list.map((c) => String(c._id)).sort();
      if (!Array.isArray(ids) || [...new Set(ids.map(String))].sort().join() !== known.join()) {
        return res.status(400).json({ message: 'Send the whole list in its new order.' });
      }
      await ReceiptCategory.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: String(id) }, update: { $set: { order: i } } } })));
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
      const category = await ReceiptCategory.findById(id);
      if (!category) return res.status(404).json({ message: 'Category not found.' });
      const others = await ReceiptCategory.find({}, 'label').lean();
      const { value, problems } = cleanCategory(req.body || {}, others as never, id);
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      category.set({ ...value, ...(typeof req.body?.active === 'boolean' ? { active: req.body.active } : {}), updatedBy: actor(req) });
      await category.save();
      res.json({ category: categoryView(category.toObject()) });
    } catch (error) {
      console.error('[card-receipts] edit category failed:', error);
      res.status(500).json({ message: 'Could not save the category.' });
    }
  });

  router.get('/categories/:id/uses', authenticate, anyOf(CARD_RECEIPTS.CATEGORY_DELETE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Category not found.' });
    const category = await ReceiptCategory.findById(id).lean();
    if (!category) return res.status(404).json({ message: 'Category not found.' });
    res.json({ uses: await CardExpense.countDocuments({ category: category.name }) });
  });

  router.delete('/categories/:id', authenticate, anyOf(CARD_RECEIPTS.CATEGORY_DELETE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Category not found.' });
    try {
      const category = await ReceiptCategory.findById(id).lean();
      if (!category) return res.status(404).json({ message: 'Category not found.' });
      const uses = await CardExpense.countDocuments({ category: category.name });
      if (uses) {
        const targetId = String(req.body?.replaceWith || '');
        const target = mongoose.isValidObjectId(targetId) ? await ReceiptCategory.findById(targetId).lean() : null;
        if (!target || String(target._id) === id || target.active === false) {
          return res.status(409).json({ message: `${uses} expense${uses === 1 ? ' uses' : 's use'} it. Choose a shown category to move them to.`, uses });
        }
        // Moved before the category goes: a stop in between leaves the
        // expenses on the new category and the old one still listed — nothing lost.
        await CardExpense.updateMany({ category: category.name }, {
          $set: { category: target.name },
          $push: { history: { at: new Date(), by: actor(req), action: 'edited', changes: `category ${category.label} → ${target.label} (deleted)` } }
        });
      }
      await ReceiptCategory.deleteOne({ _id: id });
      res.json({ deleted: true, moved: uses });
    } catch (error) {
      console.error('[card-receipts] delete category failed:', error);
      res.status(500).json({ message: 'Could not delete the category.' });
    }
  });

  // ── Cards ─────────────────────────────────────────────────────────────────

  router.get('/cards', authenticate, anyOf(CARD_RECEIPTS.MANAGE_CARDS, CARD_RECEIPTS.VIEW_ALL), async (_req: Request, res: Response) => {
    try {
      const [cards, people] = await Promise.all([
        CompanyCard.find({}).sort({ active: -1, label: 1 }).lean(),
        User.find({}, 'username displayName role location assignedLocations isActive').sort({ displayName: 1 }).lean()
      ]);
      res.json({
        cards: cards.map(cardView),
        people: people.filter((p) => p.username !== 'admin').map((p) => ({
          id: String(p._id), name: nameOf(p), role: p.role || '', location: homeOf(p), active: p.isActive !== false
        }))
      });
    } catch (error) {
      console.error('[card-receipts] cards failed:', error);
      res.status(500).json({ message: 'Could not load the cards.' });
    }
  });

  const saveCard = async (req: Request, res: Response, card: mongoose.HydratedDocument<Loose> | null) => {
    const { value, problems } = cleanCard({ ...(card ? cardView(card.toObject()) : {}), ...(req.body || {}) });
    if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
    const active = typeof req.body?.active === 'boolean' ? req.body.active : (card ? card.active !== false : true);
    if (!mongoose.isValidObjectId(value.userId) || !(await User.exists({ _id: value.userId }))) {
      return res.status(400).json({ message: 'Some fields need attention.', problems: { userId: 'Choose the cardholder' } });
    }
    if (active) {
      const clash = await CompanyCard.findOne({ active: true, _id: { $ne: card?._id }, $or: [{ userId: value.userId }, { label: value.label }] }).lean();
      if (clash) {
        const problems = clash.userId === value.userId ? { userId: `They already have card ${clash.label}. Deactivate it first.` } : { label: 'Another active card has that ID' };
        return res.status(409).json({ message: 'One card per person.', problems });
      }
    }
    const doc = card || new CompanyCard();
    doc.set({ ...value, active, updatedBy: actor(req) });
    await doc.save();
    res.status(card ? 200 : 201).json({ card: cardView(doc.toObject()) });
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
      const card = await CompanyCard.findById(id);
      if (!card) return res.status(404).json({ message: 'Card not found.' });
      await saveCard(req, res, card as never);
    } catch (error) {
      console.error('[card-receipts] edit card failed:', error);
      res.status(500).json({ message: 'Could not save the card.' });
    }
  });

  // ── Receipts ──────────────────────────────────────────────────────────────

  router.post('/attachments', authenticate, anyOf(CARD_RECEIPTS.USE), async (req: Request, res: Response) => {
    const data = req.body?.data;
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
      let filter: Record<string, unknown>;
      if (scope === 'waiting') {
        filter = { status: 'waiting', voidedAt: null, userId: { $in: [...approvable] } };
      } else {
        if (!isMonth(month)) return res.status(400).json({ message: 'Provide a month as YYYY-MM.' });
        if (scope === 'all') {
          if (!has(req, CARD_RECEIPTS.VIEW_ALL)) return res.status(403).json({ message: 'You can see your own expenses only.' });
          filter = { month };
        } else {
          filter = { month, userId: me };
        }
      }
      const rows = await CardExpense.find(filter).sort({ date: -1, createdAt: -1 }).limit(5000).lean();
      res.json({ expenses: rows.map((e) => expenseView(e, { id: me, approvable })) });
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
      const existing = await CardExpense.findById(body.id).lean();
      if (existing) {
        if (existing.userId !== me) return res.status(409).json({ message: 'That id belongs to another expense.' });
        return res.json({ expense: expenseView(existing, { id: me, approvable: new Set() }), alreadySaved: true });
      }
      const card = await CompanyCard.findOne({ userId: me, active: true }).lean();
      if (!card) return res.status(409).json({ message: 'You don’t have a company card set up yet. Ask accounting to add it.' });
      const categories = await categoriesForSave();
      // A hidden category can't start a new expense.
      const shown = categories.filter((c) => c.active);
      const { value, problems, missing } = cleanExpense(body, { today: todayOf(), categories: shown });
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      if (body.confirmRepeat !== true) {
        const same = await CardExpense.find({ userId: me, date: value.date, cents: value.cents, voidedAt: null }).lean();
        const repeat = possibleRepeat(same.map((e) => ({ ...e, id: String(e._id) })), { userId: me, date: value.date, cents: value.cents });
        if (repeat) return res.status(409).json({ message: 'This receipt looks already uploaded.', repeat: { id: String(repeat._id), merchant: repeat.merchant, date: repeat.date, cents: repeat.cents } });
      }
      const u = userOf(req);
      const by = actor(req);
      const status = statusAfterSave(Object.keys(missing).length === 0);
      const saved = await CardExpense.create({
        _id: body.id, userId: me, holderName: nameOf(u), cardId: String(card._id), cardLabel: card.label, location: homeOf(u),
        ...value, month: monthOf(value.date), status, createdBy: by,
        history: [{ at: new Date(), by, action: 'added', changes: status === 'waiting' ? 'sent for approval' : '' }]
      });
      res.status(201).json({ expense: expenseView(saved.toObject(), { id: me, approvable: new Set() }) });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const again = await CardExpense.findById(body.id).lean();
        if (again) return res.json({ expense: expenseView(again, { id: me, approvable: new Set() }), alreadySaved: true });
      }
      console.error('[card-receipts] add failed:', error);
      res.status(500).json({ message: 'Could not save the receipt.' });
    }
  });

  const cleanOf = (e: Loose): CleanExpense => ({
    date: e.date, merchant: e.merchant, cents: e.cents, subtotalCents: e.subtotalCents ?? null, taxCents: e.taxCents ?? null,
    tipCents: e.tipCents ?? null, category: e.category || '', customerId: e.customerId || '', customerName: e.customerName || '',
    attendees: e.attendees || [], purpose: e.purpose || '', note: e.note || '', recurring: Boolean(e.recurring),
    receiptUrl: e.receiptUrl || '', lostReason: e.lostReason || ''
  });

  router.put('/expenses/:id', authenticate, anyOf(CARD_RECEIPTS.USE), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const me = userIdOf(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Expense not found.' });
    try {
      const expense = await CardExpense.findById(id);
      if (!expense || expense.userId !== me) return res.status(404).json({ message: 'Expense not found.' });
      if (!holderMayEdit({ status: expense.status, voided: expense.voidedAt })) {
        return res.status(409).json({ message: expense.voidedAt ? 'A voided expense can’t be changed.' : 'It’s approved, so it can’t be changed.' });
      }
      const categories = await categoriesForSave();
      // The category it already has stays valid even if it was hidden since.
      const allowed = categories.filter((c) => c.active || c.name === expense.category);
      const { value, problems, missing } = cleanExpense(req.body || {}, { today: todayOf(), categories: allowed });
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      const changes = changeSummary(cleanOf(expense.toObject()), value);
      const status = statusAfterSave(Object.keys(missing).length === 0, expense.status);
      if (!changes.length && status === expense.status) return res.json({ expense: expenseView(expense.toObject(), { id: me, approvable: new Set() }), unchanged: true });
      const by = actor(req);
      const sentForApproval = status === 'waiting' && expense.status !== 'waiting';
      expense.set({ ...value, month: monthOf(value.date), status });
      expense.history.push({ at: new Date(), by, action: 'edited', changes: [changes.join(', '), sentForApproval ? 'sent for approval' : ''].filter(Boolean).join(' · ') });
      await expense.save();
      res.json({ expense: expenseView(expense.toObject(), { id: me, approvable: new Set() }) });
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
      const expense = await CardExpense.findById(id);
      if (!expense) return res.status(404).json({ message: 'Expense not found.' });
      const holder = await User.findById(expense.userId, 'role').lean();
      const approver = { id: userIdOf(req), permissions: userOf(req).permissions || [] };
      if (!canApprove({ approver, approverRoles: await approverRolesOf(req), holder: holder ? { id: expense.userId, role: holder.role } : null })) {
        return res.status(403).json({ message: approver.id === expense.userId ? 'You can’t approve your own expense.' : 'You can’t approve this person’s receipts.' });
      }
      const problem = decisionProblem(action, { status: expense.status, lostReason: expense.lostReason, voided: expense.voidedAt }, comment);
      if (problem) return res.status(expense.status === 'waiting' ? 400 : 409).json({ message: problem, problems: { comment: problem } });
      const by = actor(req);
      const decision = { by: approver.id, byName: by, at: new Date(), comment };
      if (action === 'approve') expense.set({ status: 'approved', approval: decision });
      else expense.set({ status: 'sent_back', sentBack: decision, approval: null });
      expense.history.push({ at: new Date(), by, action: action === 'approve' ? 'approved' : 'sent back', changes: comment });
      await expense.save();
      res.json({ expense: expenseView(expense.toObject(), { id: approver.id, approvable: new Set() }) });
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
      const expense = await CardExpense.findById(id);
      if (!expense || expense.userId !== me) return res.status(404).json({ message: 'Expense not found.' });
      if (expense.voidedAt) return res.json({ expense: expenseView(expense.toObject(), { id: me, approvable: new Set() }), alreadyVoided: true });
      if (expense.status === 'approved') return res.status(409).json({ message: 'It’s approved, so it can’t be voided.' });
      const by = actor(req);
      expense.set({ voidedAt: new Date(), voidedBy: by, voidReason: reason });
      expense.history.push({ at: new Date(), by, action: 'voided', changes: reason });
      await expense.save();
      res.json({ expense: expenseView(expense.toObject(), { id: me, approvable: new Set() }) });
    } catch (error) {
      console.error('[card-receipts] void failed:', error);
      res.status(500).json({ message: 'Could not void the expense.' });
    }
  });

  return router;
}
