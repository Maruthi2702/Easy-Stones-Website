import type { Request, RequestHandler, Response, NextFunction } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import { validateScalarRequest, scalarQuery, scalarParams } from '../server/scalarRequest.ts';
import PaymentReceived from '../models/PaymentReceived.ts';
import DailyReport from '../models/DailyReport.ts';
import { BRANCH_NAMES, isBranch, branchNow } from '../config/branches.ts';
import {
  PAYMENTS, cleanPayment, changeSummary, isDay, paymentTotals, reportGridFrom, type CleanPayment
} from '../utils/paymentsReceived.ts';

/**
 * Payments received (Operations → Payments). One entry per payment for a
 * branch's day; the rules are src/utils/paymentsReceived.ts.
 *
 *   GET  /locations                 the branches this login may pick
 *   GET  /?location=&date=          the day's payments; '*' reads all assigned branches
 *   GET  /summary?location=&date=   the day's totals as the Daily Report grid holds them
 *   POST /                          add (the body's `id` is the new payment's _id: a repeat answers alreadySaved)
 *   PUT  /:id                       edit
 *   POST /:id/void                  void, with a reason
 *
 * A day whose Daily Report is submitted is locked: every write to it (and an
 * edit moving a payment into or out of it) answers 409. Branch access is the
 * Daily Report's: assignedLocations, '*' for every branch.
 *
 *   app.use('/api/payments-received', createPaymentsReceivedRouter({ authenticate, requirePermission }));
 */

type User = { username?: string; displayName?: string; permissions?: string[]; assignedLocations?: string[] };
const userOf = (req: Request) => (req as Request & { user?: User }).user || {};
const actor = (req: Request) => userOf(req).displayName || userOf(req).username || '';
const allowedLocations = (req: Request): readonly string[] => {
  const assigned = userOf(req).assignedLocations || [];
  return assigned.includes('*') ? BRANCH_NAMES : assigned.filter(isBranch);
};
const canSeeLocation = (req: Request, location: unknown) =>
  typeof location === 'string' && isBranch(location) && allowedLocations(req).includes(location);

const LOCKED = 'That day’s Daily Report is submitted, so its payments are locked. Reopen the report to change them.';

const isSubmitted = async (location: string, date: string) =>
  Boolean(await DailyReport.exists({ location, date, status: 'submitted' }));

/** The record as the screen reads it. */
const view = (p: mongoose.HydratedDocument<unknown> | Record<string, unknown>) => {
  const o = (typeof (p as { toObject?: unknown }).toObject === 'function'
    ? (p as unknown as { toObject: () => Record<string, unknown> }).toObject()
    : p) as Record<string, unknown>;
  return {
    id: String(o._id), location: o.location, date: o.date, customerId: o.customerId, customerName: o.customerName,
    method: o.method, cents: o.cents, invoice: o.invoice || '', reference: o.reference || '', note: o.note || '',
    enteredBy: o.enteredBy || '', createdAt: o.createdAt, updatedBy: o.updatedBy || '', updatedAt: o.updatedAt,
    voided: o.voidedAt ? { at: o.voidedAt, by: o.voidedBy || '', reason: o.voidReason || '' } : null,
    history: o.history || []
  };
};

const cleanOf = (p: Record<string, unknown>): CleanPayment => ({
  date: String(p.date), customerId: String(p.customerId), customerName: String(p.customerName), method: String(p.method) as CleanPayment['method'],
  cents: Number(p.cents), invoice: String(p.invoice || ''), reference: String(p.reference || ''), note: String(p.note || '')
});

export default function createPaymentsReceivedRouter({ authenticate, requirePermission }: {
  authenticate: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
}) {
  const router = express.Router();
  const canView = [authenticate, requirePermission(PAYMENTS.VIEW)];
  // The Daily Report's comparison line: anyone who can open the report or this page.
  const canSeeTotals = [authenticate, (req: Request, res: Response, next: NextFunction) => {
    const perms = userOf(req).permissions || [];
    return perms.includes(PAYMENTS.VIEW) || perms.includes('view_daily_report') ? next() : res.status(403).json({ message: 'Access denied.' });
  }];

  router.get('/locations', canView, (req: Request, res: Response) => {
    res.json({ locations: allowedLocations(req) });
  });

  router.get('/', canView, validateScalarRequest, async (req: Request, res: Response) => {
    const { location, date } = scalarQuery(req);
    if (!isDay(date)) return res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' });
    const all = location === '*';
    const locations = all ? allowedLocations(req) : canSeeLocation(req, location) ? [location as string] : [];
    if (!locations.length) return res.status(403).json({ message: 'That branch is not assigned to you.' });
    try {
      const [rows, report] = await Promise.all([
        PaymentReceived.find({ location: all ? { $in: locations } : location, date }).sort({ createdAt: 1, _id: 1 }).lean(),
        // Report locks belong to individual branches. The combined view is
        // read-only; choose a branch before making changes.
        all ? Promise.resolve(null) : DailyReport.findOne({ location, date }, 'status submittedBy submittedAt autoSubmitted').lean()
      ]);
      res.json({
        payments: rows.map(view),
        day: {
          submitted: report?.status === 'submitted',
          submittedBy: report?.submittedBy || '',
          submittedAt: report?.submittedAt || null,
          autoSubmitted: Boolean(report?.autoSubmitted)
        },
        // Some branches have already crossed midnight while others have not.
        // The combined reader can show the latest current day among its branches.
        today: locations.map(name => branchNow(name).date).sort().at(-1)
      });
    } catch (error) {
      console.error('[payments-received] list failed:', error);
      res.status(500).json({ message: 'Could not load the payments.' });
    }
  });

  router.get('/summary', canSeeTotals, validateScalarRequest, async (req: Request, res: Response) => {
    const { location, date } = scalarQuery(req);
    if (!isDay(date)) return res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' });
    if (!canSeeLocation(req, location)) return res.status(403).json({ message: 'That branch is not assigned to you.' });
    try {
      const rows = await PaymentReceived.find({ location, date }, 'method cents voidedAt').lean();
      const list = rows.map(r => ({ method: r.method, cents: r.cents, voided: r.voidedAt }));
      const t = paymentTotals(list);
      res.json({ count: t.count, net: t.net, taken: t.taken, returned: t.returned, grid: reportGridFrom(list) });
    } catch (error) {
      console.error('[payments-received] summary failed:', error);
      res.status(500).json({ message: 'Could not load the totals.' });
    }
  });

  router.post('/', authenticate, requirePermission(PAYMENTS.ADD), async (req: Request, res: Response) => {
    const body = req.body || {};
    const location = body.location;
    if (!canSeeLocation(req, location)) return res.status(403).json({ message: 'That branch is not assigned to you.' });
    if (!mongoose.isValidObjectId(body.id)) return res.status(400).json({ message: 'The payment has no id. Reload the page and try again.' });
    try {
      const existing = await PaymentReceived.findById(body.id).lean();
      if (existing) {
        if (existing.location !== location) return res.status(409).json({ message: 'That id belongs to another payment.' });
        return res.json({ payment: view(existing), alreadySaved: true });
      }
      const { value, problems } = cleanPayment(body, branchNow(location).date);
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      if (await isSubmitted(location, value.date)) return res.status(409).json({ message: LOCKED });
      const by = actor(req);
      const saved = await PaymentReceived.create({
        _id: body.id, location, ...value, enteredBy: by, updatedBy: by,
        history: [{ at: new Date(), by, action: 'added' }]
      });
      res.status(201).json({ payment: view(saved) });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const again = await PaymentReceived.findById(body.id).lean();
        if (again) return res.json({ payment: view(again), alreadySaved: true });
      }
      console.error('[payments-received] add failed:', error);
      res.status(500).json({ message: 'Could not save the payment.' });
    }
  });

  router.put('/:id', authenticate, requirePermission(PAYMENTS.EDIT), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Payment not found.' });
    try {
      const payment = await PaymentReceived.findById(id);
      if (!payment || !canSeeLocation(req, payment.location)) return res.status(404).json({ message: 'Payment not found.' });
      if (payment.voidedAt) return res.status(409).json({ message: 'A voided payment can’t be edited.' });
      const { value, problems } = cleanPayment(req.body || {}, branchNow(payment.location).date);
      if (!value) return res.status(400).json({ message: 'Some fields need attention.', problems });
      const days = [...new Set([payment.date, value.date])];
      for (const day of days) {
        if (await isSubmitted(payment.location, day)) return res.status(409).json({ message: LOCKED });
      }
      const changes = changeSummary(cleanOf(payment.toObject()), value);
      if (!changes.length) return res.json({ payment: view(payment), unchanged: true });
      const by = actor(req);
      payment.set({ ...value, updatedBy: by });
      payment.history.push({ at: new Date(), by, action: 'edited', changes: changes.join(', ') });
      await payment.save();
      res.json({ payment: view(payment) });
    } catch (error) {
      console.error('[payments-received] edit failed:', error);
      res.status(500).json({ message: 'Could not save the change.' });
    }
  });

  router.post('/:id/void', authenticate, requirePermission(PAYMENTS.VOID), validateScalarRequest, async (req: Request, res: Response) => {
    const { id } = scalarParams(req);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Payment not found.' });
    if (!reason) return res.status(400).json({ message: 'Say why it’s being voided.', problems: { reason: 'Say why it’s being voided' } });
    try {
      const payment = await PaymentReceived.findById(id);
      if (!payment || !canSeeLocation(req, payment.location)) return res.status(404).json({ message: 'Payment not found.' });
      if (payment.voidedAt) return res.json({ payment: view(payment), alreadyVoided: true });
      if (await isSubmitted(payment.location, payment.date)) return res.status(409).json({ message: LOCKED });
      const by = actor(req);
      payment.set({ voidedAt: new Date(), voidedBy: by, voidReason: reason, updatedBy: by });
      payment.history.push({ at: new Date(), by, action: 'voided', changes: reason });
      await payment.save();
      res.json({ payment: view(payment) });
    } catch (error) {
      console.error('[payments-received] void failed:', error);
      res.status(500).json({ message: 'Could not void the payment.' });
    }
  });

  return router;
}
