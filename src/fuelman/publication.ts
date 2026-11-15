import type { z } from 'zod';
import type { Actor } from '../db/fuelman/index.ts';
import { newId } from '../db/ids.ts';
import { reportFor, reviewFor, fleetTransaction, history, scopeOf } from './storage.ts';
import { publicationSchema, reverseSchema, closeSchema } from './schemas.ts';
import { HttpError } from './http.ts';
export async function publishReport(id: string, body: z.output<typeof publicationSchema>, actor: Actor, canReplace: boolean) {
  const scopeKey = await scopeOf(id);
  return fleetTransaction(scopeKey, async store => {
    const report = await reportFor(id, store), period = await store.period(report.periodKey);
    if (report.status === 'posted') {
      if (period?.publishedReportId === id) return { success: true, duplicate: true };
      throw new HttpError(409, 'The published period changed');
    }
    if (period?.closed) throw new HttpError(409, 'This period is closed. Reopen it before publishing a correction.');
    const review = await reviewFor(report, store);
    if (report.__v !== body.version || review.token !== body.token) throw new HttpError(409, 'Assignments, source data or review decisions changed. Refresh before approving.');
    if (!review.ready || review.facts.reduce((n, f) => n + f.amountCents, 0) !== report.parsed.totalCents) throw new HttpError(409, 'Resolve all driver, category and missing-driver issues before approving');
    if (report.parsed.lines.some(l => l.date < report.parsed.start) && !body.acknowledgePriorDates)
      throw new HttpError(400, 'Review and acknowledge transactions dated before this statement. Expenses are published to the statement month.');
    const previous = period?.publishedReportId ? await reportFor(period.publishedReportId, store) : null;
    if ((previous || report.status !== 'draft') && !canReplace) throw new HttpError(403, 'Correcting or restoring published expenses also requires the Reverse permission');
    if (previous && body.replaceReportId !== previous._id) throw new HttpError(409, 'Explicitly confirm the currently published revision before replacing it');
    if (previous) {
      await store.updateReport(previous._id, { status: 'superseded', bump: true });
      await history(previous, actor, 'superseded', body.note, { replacementId: id }, store);
    }
    // Drivers carried back from a later month are saved now, so the match is on record and ends where the later one begins.
    const implied = review.drivers.flatMap(d => d.assignments.filter(a => a.implied).map(a => ({ ...a, reportedName: a.reportedName ?? d.name })));
    if (report.status === 'draft' && implied.length) await store.addAssignmentsIfAbsent(implied.map(a => ({ id: newId(), a: {
      scopeKey: report.scopeKey, externalId: a.externalId, reportedName: a.reportedName, driverKey: a.driverKey, driverName: a.driverName, from: a.from, to: a.to,
      allocations: a.allocations, updatedBy: actor, updatedAt: new Date() } })));
    if (report.status === 'draft')
      await store.addFacts(review.facts.map(f => ({ id: newId(), fact: { ...f, reportId: report._id, month: report.parsed.month, scopeKey: report.scopeKey } })));
    await store.updatePeriod(report.periodKey, { publishedReportId: report._id });
    await store.updateReport(report._id, { status: 'posted', frozenReview: { ...review, facts: [] }, publishedAt: new Date(), note: body.note, bump: true, version: body.version });
    await history(report, actor, report.status === 'draft' ? 'published' : 'restored', body.note, { totalCents: report.parsed.totalCents, replacedReportId: previous ? String(previous._id) : null, accountingBasis: 'statement-month', priorDatesAcknowledged: body.acknowledgePriorDates, carriedBack: implied.map(a => a.externalId) }, store);
    return { success: true, duplicate: false };
  });
}
export async function reverseReport(id: string, body: z.output<typeof reverseSchema>, actor: Actor) {
  const scopeKey = await scopeOf(id);
  return fleetTransaction(scopeKey, async store => {
    const report = await reportFor(id, store), period = await store.period(report.periodKey);
    if (period?.closed) throw new HttpError(409, 'This period is closed');
    if (report.status !== 'posted' || report.__v !== body.version || period?.publishedReportId !== id) throw new HttpError(409, 'Only the current published revision can be reversed. Refresh the report.');
    await store.updatePeriod(report.periodKey, { publishedReportId: null });
    await store.updateReport(report._id, { status: 'reversed', note: body.note, bump: true });
    await history(report, actor, 'reversed', body.note, { totalCents: report.parsed.totalCents }, store);
    return { success: true };
  });
}
export async function closePeriod(id: string, body: z.output<typeof closeSchema>, actor: Actor) {
  const scopeKey = await scopeOf(id);
  return fleetTransaction(scopeKey, async store => {
    const report = await reportFor(id, store);
    await store.updatePeriod(report.periodKey, { closed: body.closed, closedBy: actor, closedAt: new Date() });
    await history(report, actor, body.closed ? 'period-closed' : 'period-reopened', body.note, { periodKey: report.periodKey }, store);
    return { success: true };
  });
}
