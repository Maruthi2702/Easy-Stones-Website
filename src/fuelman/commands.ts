import type { z } from 'zod';
import type { Actor, AssignmentRecord, FuelStore } from '../db/fuelman/index.ts';
import { newId } from '../db/ids.ts';
import { checkedDraft, fleetTransaction, history, reportFor, scopeOf } from './storage.ts';
import { driverOptions } from './access.ts';
import { assignmentSchema, batchAssignmentSchema, mappingSchema, classificationSchema, dispositionSchema } from './schemas.ts';
import { HttpError } from './http.ts';
import { validDay } from './parserRows.ts';
import type { Allocation, Disposition, DriverOption } from './types.ts';
async function withDraft(id: string, version: number, token: string, actor: Actor, action: string, note: string,
  work: (report: Awaited<ReturnType<typeof reportFor>>, store: FuelStore, review: Awaited<ReturnType<typeof checkedDraft>>['review']) => Promise<unknown>) {
  const scopeKey = await scopeOf(id);
  return fleetTransaction(scopeKey, async store => {
    const { report, review } = await checkedDraft(id, version, token, store), detail = await work(report, store, review);
    await store.updateReport(report._id, { bump: true, version });
    await history(report, actor, action, note, detail, store);
    return { success: true };
  });
}
async function applyAssignment(report: Awaited<ReturnType<typeof reportFor>>, body: z.output<typeof mappingSchema>, actor: Actor,
  allowedLocations: string[], store: FuelStore, options: DriverOption[], preloaded?: Map<string, AssignmentRecord[]>) {
  const employee = report.parsed.employees.find(e => e.externalId === body.externalId);
  if (!employee) throw new HttpError(400, 'Choose an identity present in this report');
  if (body.from > report.parsed.end) throw new HttpError(400, 'The assignment starts after this report ends');
  const allocations: Allocation[] = body.allocations.map(a => ({ location: a.location,
    basisPoints: Number(a.percent.split('.')[0]) * 100 + Number((a.percent.split('.')[1] || '').padEnd(2, '0')) }));
  if (allocations.some(a => !allowedLocations.includes(a.location) || a.basisPoints <= 0) || new Set(allocations.map(a => a.location)).size !== allocations.length ||
    allocations.reduce((s, a) => s + a.basisPoints, 0) !== 10000) throw new HttpError(400, 'Choose distinct valid locations adding to exactly 100%');
  const option = options.find(d => d.kind === 'user' && d.key === body.driverKey);
  if (!option) throw new HttpError(400, 'Choose a user with a Driver profile in Users & Roles');
  const driverKey = option.key, driverName = option.name;
  const rows = preloaded?.get(body.externalId) ?? await store.assignmentsOf(report.scopeKey, [body.externalId]);
  const next = rows.find(a => a.from > body.from);
  for (const row of rows.filter(a => a.from < body.from && (!a.to || a.to > body.from)))
    await store.setAssignmentEnd([row._id], body.from, actor);
  const old = rows.find(a => a.from === body.from);
  const after = { scopeKey: report.scopeKey, externalId: body.externalId, reportedName: employee.name, driverKey, driverName, from: body.from,
    to: next?.from || old?.to || '', allocations, updatedBy: actor, updatedAt: new Date() };
  await store.saveAssignment(newId(), after);
  return { before: rows, after };
}
// One read for every identity in a batch (they are distinct, so none depends on another's write), not one per row.
async function loadAssignments(scopeKey: string, externalIds: string[], store: FuelStore) {
  const byId = new Map<string, AssignmentRecord[]>(externalIds.map(id => [id, []]));
  for (const row of await store.assignmentsOf(scopeKey, externalIds)) byId.get(row.externalId)!.push(row);
  return byId;
}
export function saveAssignment(id: string, body: z.output<typeof assignmentSchema>, actor: Actor, allowedLocations: string[]) {
  return withDraft(id, body.version, body.token, actor, 'assignment', body.note, async (report, store) =>
    applyAssignment(report, body, actor, allowedLocations, store, await driverOptions(store.session)));
}
export function saveAssignments(id: string, body: z.output<typeof batchAssignmentSchema>, actor: Actor, allowedLocations: string[]) {
  return withDraft(id, body.version, body.token, actor, 'assignments', body.note, async (report, store) => {
    if (new Set(body.assignments.map(a => a.externalId)).size !== body.assignments.length) throw new HttpError(400, 'Choose each reported driver only once');
    const options = await driverOptions(store.session), changes = [];
    const preloaded = await loadAssignments(report.scopeKey, body.assignments.map(a => a.externalId), store);
    for (const assignment of body.assignments) changes.push(await applyAssignment(report, assignment, actor, allowedLocations, store, options, preloaded));
    return { changes };
  });
}
export function saveDisposition(id: string, body: z.output<typeof dispositionSchema>, actor: Actor) {
  return withDraft(id, body.version, body.token, actor, 'missing-driver', body.note, async (report, store, review) => {
    if (!review.missing.some(m => m.externalId === body.externalId)) throw new HttpError(400, 'This identity is not missing from the current report');
    const effective = body.effectiveDate || report.parsed.start;
    if (!validDay(effective) || effective > report.parsed.end) throw new HttpError(400, 'Choose an effective date no later than the report end');
    if (body.reason === 'identifier_changed') {
      if (!body.replacementId || !report.parsed.employees.some(e => e.externalId === body.replacementId)) throw new HttpError(400, 'Choose the new identity from this report');
      const old = await store.assignmentUpTo(report.scopeKey, body.externalId, report.parsed.end);
      const replacement = review.drivers.find(d => d.externalId === body.replacementId);
      if (!old || !replacement?.driverKey || replacement.issues.length || replacement.driverKey !== old.driverKey)
        throw new HttpError(400, 'Assign the replacement identity to the same system driver first');
    }
    const before = report.dispositions.find(d => d.externalId === body.externalId);
    // Editing a reason must undo only the interval endings made by this
    // review, without reopening over a later dated assignment.
    for (const ended of before?.endedAssignments || []) {
      const row = await store.assignmentById(ended.id, report.scopeKey, body.externalId);
      if (!row || row.to !== ended.endedAt) continue;
      const next = await store.assignmentAfter(report.scopeKey, body.externalId, row.from);
      const limits = [ended.previousTo, next?.from].filter((v): v is string => !!v).sort();
      await store.setAssignmentEnd([row._id], limits[0] || '', actor);
    }
    const disposition: Disposition = { externalId: body.externalId, reason: body.reason, note: body.note, replacementId: body.replacementId, endedAssignments: [] };
    if (['retired', 'identifier_changed'].includes(body.reason)) {
      const ending = await store.assignmentsOpenAt(report.scopeKey, body.externalId, effective);
      disposition.endedAssignments = ending.map(a => ({ id: String(a._id), previousTo: a.to, endedAt: effective }));
      await store.setAssignmentEnd(ending.map(a => a._id), effective, actor);
    }
    await store.updateReport(report._id, { dispositions: [...report.dispositions.filter(d => d.externalId !== body.externalId), disposition] });
    return { before, after: disposition, effectiveDate: effective };
  });
}
export function saveClassifications(id: string, body: z.output<typeof classificationSchema>, actor: Actor) {
  return withDraft(id, body.version, body.token, actor, 'classification', body.rows.map(r => r.note).join('; '), async (report, store) => {
    const known = new Set(report.parsed.lines.map(l => l.index)), chosen = new Set(body.rows.map(r => r.index));
    if (chosen.size !== body.rows.length || body.rows.some(r => !known.has(r.index)))
      throw new HttpError(400, 'Choose distinct transaction lines from this report');
    const before = report.overrides, after = [...before.filter(o => !chosen.has(o.index)), ...body.rows];
    await store.updateReport(report._id, { overrides: after });
    return { before, after };
  });
}
