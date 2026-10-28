import type { z } from 'zod';
import { FuelReport, FuelExpense, FuelPeriod } from './models.ts';
import type { Actor } from './models.ts';
import { reportFor, reviewFor, fleetTransaction, history, scopeOf } from './storage.ts';
import { publicationSchema, reverseSchema, closeSchema } from './schemas.ts';
import { HttpError } from './http.ts';
export async function publishReport(id: string, body: z.output<typeof publicationSchema>, actor: Actor, canReplace: boolean) {
  const scopeKey = await scopeOf(id);
  return fleetTransaction(scopeKey, async session => {
    const report = await reportFor(id, session), period = await FuelPeriod.findById(report.periodKey).session(session).lean();
    if (report.status === 'posted') {
      if (String(period?.publishedReportId) === id) return { success: true, duplicate: true };
      throw new HttpError(409, 'The published period changed');
    }
    if (period?.closed) throw new HttpError(409, 'This period is closed. Reopen it before publishing a correction.');
    const review = await reviewFor(report, session);
    if (report.__v !== body.version || review.token !== body.token) throw new HttpError(409, 'Assignments, source data or review decisions changed. Refresh before approving.');
    if (!review.ready || review.facts.reduce((n, f) => n + f.amountCents, 0) !== report.parsed.totalCents) throw new HttpError(409, 'Resolve all driver, category and missing-driver issues before approving');
    if (report.parsed.lines.some(l => l.date < report.parsed.start) && !body.acknowledgePriorDates)
      throw new HttpError(400, 'Review and acknowledge transactions dated before this statement. Expenses are published to the statement month.');
    const previous = period?.publishedReportId ? await reportFor(String(period.publishedReportId), session) : null;
    if ((previous || report.status !== 'draft') && !canReplace) throw new HttpError(403, 'Correcting or restoring published expenses also requires the Reverse permission');
    if (previous && body.replaceReportId !== String(previous._id)) throw new HttpError(409, 'Explicitly confirm the currently published revision before replacing it');
    if (previous) {
      await FuelReport.updateOne({ _id: previous._id }, { $set: { status: 'superseded' }, $inc: { __v: 1 } }, { session });
      await history(previous, actor, 'superseded', body.note, { replacementId: id }, session);
    }
    if (report.status === 'draft') {
      for (let n = 0; n < review.facts.length; n += 1000)
        await FuelExpense.insertMany(review.facts.slice(n, n + 1000).map(f => ({ ...f, reportId: report._id, month: report.parsed.month, scopeKey: report.scopeKey })), { session });
    }
    await FuelPeriod.updateOne({ _id: report.periodKey }, { $set: { publishedReportId: report._id } }, { session });
    await FuelReport.updateOne({ _id: report._id, __v: body.version }, { $set: { status: 'posted', frozenReview: { ...review, facts: [] }, publishedAt: new Date(), note: body.note }, $inc: { __v: 1 } }, { session });
    await history(report, actor, report.status === 'draft' ? 'published' : 'restored', body.note, { totalCents: report.parsed.totalCents, replacedReportId: previous ? String(previous._id) : null, accountingBasis: 'statement-month', priorDatesAcknowledged: body.acknowledgePriorDates }, session);
    return { success: true, duplicate: false };
  });
}
export async function reverseReport(id: string, body: z.output<typeof reverseSchema>, actor: Actor) {
  const scopeKey = await scopeOf(id);
  return fleetTransaction(scopeKey, async session => {
    const report = await reportFor(id, session), period = await FuelPeriod.findById(report.periodKey).session(session).lean();
    if (period?.closed) throw new HttpError(409, 'This period is closed');
    if (report.status !== 'posted' || report.__v !== body.version || String(period?.publishedReportId) !== id) throw new HttpError(409, 'Only the current published revision can be reversed. Refresh the report.');
    await FuelPeriod.updateOne({ _id: report.periodKey }, { $set: { publishedReportId: null } }, { session });
    await FuelReport.updateOne({ _id: report._id }, { $set: { status: 'reversed', note: body.note }, $inc: { __v: 1 } }, { session });
    await history(report, actor, 'reversed', body.note, { totalCents: report.parsed.totalCents }, session);
    return { success: true };
  });
}
export async function closePeriod(id: string, body: z.output<typeof closeSchema>, actor: Actor) {
  const scopeKey = await scopeOf(id);
  return fleetTransaction(scopeKey, async session => {
    const report = await reportFor(id, session);
    await FuelPeriod.updateOne({ _id: report.periodKey }, { $set: { closed: body.closed, closedBy: actor, closedAt: new Date() } }, { session });
    await history(report, actor, body.closed ? 'period-closed' : 'period-reopened', body.note, { periodKey: report.periodKey }, session);
    return { success: true };
  });
}
