import type { ClientSession } from 'mongoose';
import type { z } from 'zod';
import { FuelAssignment, FuelReport } from './models.ts';
import type { Actor } from './models.ts';
import { checkedDraft, fleetTransaction, history, reportFor, reviewFor } from './storage.ts';
import { driverOptions } from './access.ts';
import { assignmentSchema, batchAssignmentSchema, mappingSchema, classificationSchema, dispositionSchema } from './schemas.ts';
import { HttpError } from './http.ts';
import { validDay } from './parserRows.ts';
import type { Allocation, Disposition, DriverOption } from './types.ts';
async function withDraft(id: string, version: number, token: string, actor: Actor, action: string, note: string,
  work: (report: Awaited<ReturnType<typeof reportFor>>, session: ClientSession) => Promise<unknown>) {
  const source = await reportFor(id);
  return fleetTransaction(source.scopeKey, async session => {
    const report = await checkedDraft(id, version, token, session), detail = await work(report, session);
    await FuelReport.updateOne({ _id: report._id, __v: version }, { $inc: { __v: 1 } }, { session });
    await history(report, actor, action, note, detail, session);
    return { success: true };
  });
}
async function applyAssignment(report: Awaited<ReturnType<typeof reportFor>>, body: z.output<typeof mappingSchema>, actor: Actor,
  allowedLocations: string[], session: ClientSession, options: DriverOption[]) {
  if (!report.parsed.employees.some(e => e.externalId === body.externalId)) throw new HttpError(400, 'Choose an identity present in this report');
  if (body.from > report.parsed.end) throw new HttpError(400, 'The assignment starts after this report ends');
  const allocations: Allocation[] = body.allocations.map(a => ({ location: a.location,
    basisPoints: Number(a.percent.split('.')[0]) * 100 + Number((a.percent.split('.')[1] || '').padEnd(2, '0')) }));
  if (allocations.some(a => !allowedLocations.includes(a.location) || a.basisPoints <= 0) || new Set(allocations.map(a => a.location)).size !== allocations.length ||
    allocations.reduce((s, a) => s + a.basisPoints, 0) !== 10000) throw new HttpError(400, 'Choose distinct valid locations adding to exactly 100%');
  const option = options.find(d => d.kind === 'user' && d.key === body.driverKey);
  if (!option) throw new HttpError(400, 'Choose a user with a Driver profile in Users & Roles');
  const driverKey = option.key, driverName = option.name;
  const rows = await FuelAssignment.find({ scopeKey: report.scopeKey, externalId: body.externalId }).session(session).sort({ from: 1 }).lean();
  const next = rows.find(a => a.from > body.from);
  for (const row of rows.filter(a => a.from < body.from && (!a.to || a.to > body.from)))
    await FuelAssignment.updateOne({ _id: row._id }, { $set: { to: body.from, updatedBy: actor, updatedAt: new Date() } }, { session });
  const old = rows.find(a => a.from === body.from);
  const after = { scopeKey: report.scopeKey, externalId: body.externalId, reportedName: report.parsed.employees.find(e => e.externalId === body.externalId)!.name, driverKey, driverName, from: body.from,
    to: next?.from || old?.to || '', allocations, updatedBy: actor, updatedAt: new Date() };
  await FuelAssignment.findOneAndUpdate({ scopeKey: report.scopeKey, externalId: body.externalId, from: body.from }, { $set: after }, { session, upsert: true });
  return { before: rows, after };
}
export function saveAssignment(id: string, body: z.output<typeof assignmentSchema>, actor: Actor, allowedLocations: string[]) {
  return withDraft(id, body.version, body.token, actor, 'assignment', body.note, async (report, session) =>
    applyAssignment(report, body, actor, allowedLocations, session, await driverOptions(session)));
}
export function saveAssignments(id: string, body: z.output<typeof batchAssignmentSchema>, actor: Actor, allowedLocations: string[]) {
  return withDraft(id, body.version, body.token, actor, 'assignments', body.note, async (report, session) => {
    if (new Set(body.assignments.map(a => a.externalId)).size !== body.assignments.length) throw new HttpError(400, 'Choose each reported driver only once');
    const options = await driverOptions(session), changes = [];
    for (const assignment of body.assignments) changes.push(await applyAssignment(report, assignment, actor, allowedLocations, session, options));
    return { changes };
  });
}
export function saveDisposition(id: string, body: z.output<typeof dispositionSchema>, actor: Actor) {
  return withDraft(id, body.version, body.token, actor, 'missing-driver', body.note, async (report, session) => {
    const review = await reviewFor(report, session);
    if (!review.missing.some(m => m.externalId === body.externalId)) throw new HttpError(400, 'This identity is not missing from the current report');
    const effective = body.effectiveDate || report.parsed.start;
    if (!validDay(effective) || effective > report.parsed.end) throw new HttpError(400, 'Choose an effective date no later than the report end');
    if (body.reason === 'identifier_changed') {
      if (!body.replacementId || !report.parsed.employees.some(e => e.externalId === body.replacementId)) throw new HttpError(400, 'Choose the new identity from this report');
      const old = await FuelAssignment.findOne({ scopeKey: report.scopeKey, externalId: body.externalId, from: { $lte: report.parsed.end } }).session(session).sort({ from: -1 }).lean();
      const replacement = review.drivers.find(d => d.externalId === body.replacementId);
      if (!old || !replacement?.driverKey || replacement.issues.length || replacement.driverKey !== old.driverKey)
        throw new HttpError(400, 'Assign the replacement identity to the same system driver first');
    }
    const before = report.dispositions.find(d => d.externalId === body.externalId);
    // Editing a reason must undo only the interval endings made by this
    // review, without reopening over a later dated assignment.
    for (const ended of before?.endedAssignments || []) {
      const row = await FuelAssignment.findOne({ _id: ended.id, scopeKey: report.scopeKey, externalId: body.externalId }).session(session).lean();
      if (!row || row.to !== ended.endedAt) continue;
      const next = await FuelAssignment.findOne({ scopeKey: report.scopeKey, externalId: body.externalId, from: { $gt: row.from } }).session(session).sort({ from: 1 }).lean();
      const limits = [ended.previousTo, next?.from].filter((v): v is string => !!v).sort();
      await FuelAssignment.updateOne({ _id: row._id }, { $set: { to: limits[0] || '', updatedBy: actor, updatedAt: new Date() } }, { session });
    }
    const disposition: Disposition = { externalId: body.externalId, reason: body.reason, note: body.note, replacementId: body.replacementId, endedAssignments: [] };
    if (['retired', 'identifier_changed'].includes(body.reason)) {
      const ending = await FuelAssignment.find({ scopeKey: report.scopeKey, externalId: body.externalId, from: { $lte: effective }, $or: [{ to: '' }, { to: { $gt: effective } }] }).session(session).lean();
      disposition.endedAssignments = ending.map(a => ({ id: String(a._id), previousTo: a.to, endedAt: effective }));
      await FuelAssignment.updateMany({ _id: { $in: ending.map(a => a._id) } }, { $set: { to: effective, updatedBy: actor, updatedAt: new Date() } }, { session });
    }
    await FuelReport.updateOne({ _id: report._id }, { $set: { dispositions: [...report.dispositions.filter(d => d.externalId !== body.externalId), disposition] } }, { session });
    return { before, after: disposition, effectiveDate: effective };
  });
}
export function saveClassifications(id: string, body: z.output<typeof classificationSchema>, actor: Actor) {
  return withDraft(id, body.version, body.token, actor, 'classification', body.rows.map(r => r.note).join('; '), async (report, session) => {
    if (new Set(body.rows.map(r => r.index)).size !== body.rows.length || body.rows.some(r => !report.parsed.lines.some(l => l.index === r.index)))
      throw new HttpError(400, 'Choose distinct transaction lines from this report');
    const before = report.overrides, after = [...before.filter(o => !body.rows.some(r => r.index === o.index)), ...body.rows];
    await FuelReport.updateOne({ _id: report._id }, { $set: { overrides: after } }, { session });
    return { before, after };
  });
}
