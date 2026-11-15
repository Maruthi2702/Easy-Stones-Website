/**
 * Fuel Man on Postgres, answering in MongoDB's shape (types.ts). Rows are what the copy would make of the
 * MongoDB records (src/db/copy/accountingRows.ts); fuelman.parity.test.ts compares every table after every
 * request, so a field written here and not there shows up.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import {
  fuelReports, fuelAssignments, fuelAssignmentAllocations, fuelSources, fuelExpenses, fuelState, fuelPeriods, fuelHistory
} from '../schema/accounting.ts';
import type {
  Actor, AssignmentRecord, AuditRecord, FactRecord, FuelStore, ListRow, PeriodRecord, ReportRecord
} from './types.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;
type ReportRow = typeof fuelReports.$inferSelect;
type AssignmentRow = typeof fuelAssignments.$inferSelect;

const person = (id: string | null, name: string | null): Actor => ({ id: id ?? '', name: name ?? '' });
const optPerson = (id: string | null, name: string | null): Actor | undefined => (id == null && name == null ? undefined : person(id, name));

function reportOf(r: ReportRow): ReportRecord {
  return {
    _id: r.id, __v: r.version, scopeKey: r.scopeKey, fileHash: r.fileHash, contentHash: r.contentHash, periodKey: r.periodKey,
    filename: r.filename as string, parsed: r.parsed as ReportRecord['parsed'], revision: r.revision as number,
    status: r.status as ReportRecord['status'], dispositions: r.dispositions as ReportRecord['dispositions'], overrides: r.overrides as ReportRecord['overrides'],
    importedAt: r.importedAt as Date, importedBy: person(r.importedById, r.importedByName),
    ...(r.frozenReview != null && { frozenReview: r.frozenReview as ReportRecord['frozenReview'] }),
    ...(r.publishedAt != null && { publishedAt: r.publishedAt }),
    ...(r.note != null && { note: r.note })
  };
}

const COLUMNS = {
  status: 'status', frozenReview: 'frozenReview', publishedAt: 'publishedAt', note: 'note', dispositions: 'dispositions', overrides: 'overrides'
} as const;

const anyOf = <T>(column: Parameters<typeof inArray>[0], values: T[]): SQL => (values.length ? inArray(column, values as never[]) : sql`false`);

export function pgStore(q: Q): FuelStore {
  async function allocationsOf(rows: AssignmentRow[]): Promise<AssignmentRecord[]> {
    if (!rows.length) return [];
    const parts = await q.select().from(fuelAssignmentAllocations)
      .where(inArray(fuelAssignmentAllocations.assignmentId, rows.map(r => r.id))).orderBy(asc(fuelAssignmentAllocations.position));
    const byId = new Map<string, { location: string; basisPoints: number }[]>();
    for (const p of parts) {
      const list = byId.get(p.assignmentId) ?? [];
      list.push({ location: p.location as string, basisPoints: p.basisPoints as number });
      byId.set(p.assignmentId, list);
    }
    return rows.map(r => ({
      _id: r.id, scopeKey: r.scopeKey, externalId: r.externalId, ...(r.reportedName != null && { reportedName: r.reportedName }),
      driverKey: r.driverKey as string, driverName: r.driverName as string, from: r.fromDay ?? '', to: r.toDay ?? '',
      allocations: byId.get(r.id) ?? [], updatedBy: person(r.updatedById, r.updatedByName), updatedAt: r.updatedAt as Date
    }));
  }
  const oneAssignment = async (where: SQL | undefined, order: SQL[]) => (await allocationsOf(await q.select().from(fuelAssignments).where(where).orderBy(...order).limit(1)))[0] ?? null;

  const factOf = (r: typeof fuelExpenses.$inferSelect): FactRecord => ({
    _id: r.id, __v: 0, reportId: r.reportId, month: r.month as string, scopeKey: r.scopeKey as string, externalId: r.externalId as string,
    driverKey: r.driverKey as string, driverName: r.driverName as string, location: r.location as string, category: r.category as FactRecord['category'],
    amountCents: r.amountCents as number, sourceLine: r.sourceLine as number, date: r.day ?? ''
  } as FactRecord);
  const periodOf = (r: typeof fuelPeriods.$inferSelect): PeriodRecord => ({
    _id: r.id, scopeKey: r.scopeKey as string, month: r.month as string, publishedReportId: r.publishedReportId, closed: r.closed,
    ...(optPerson(r.closedById, r.closedByName) && { closedBy: optPerson(r.closedById, r.closedByName) }),
    ...(r.closedAt != null && { closedAt: r.closedAt })
  });

  return {
    session: null,

    async getReport(id) {
      const [r] = await q.select().from(fuelReports).where(eq(fuelReports.id, id));
      return r ? reportOf(r) : null;
    },
    async reportScope(id) {
      const [r] = await q.select({ scopeKey: fuelReports.scopeKey }).from(fuelReports).where(eq(fuelReports.id, id));
      return r?.scopeKey ?? null;
    },
    async reportExists(id) {
      return (await q.select({ id: fuelReports.id }).from(fuelReports).where(eq(fuelReports.id, id))).length > 0;
    },
    async reportTotals(id) {
      const [r] = await q.select({ total: sql<string | null>`${fuelReports.parsed} ->> 'totalCents'`, revision: fuelReports.revision }).from(fuelReports).where(eq(fuelReports.id, id));
      return r ? { totalCents: Number(r.total), revision: r.revision as number } : null;
    },
    async findDuplicate({ fileHash, scopeKey, contentHash }) {
      const [r] = await q.select({ id: fuelReports.id, month: sql<string>`${fuelReports.parsed} ->> 'month'` }).from(fuelReports)
        .where(or(eq(fuelReports.fileHash, fileHash), and(eq(fuelReports.scopeKey, scopeKey), eq(fuelReports.contentHash, contentHash)))).limit(1);
      return r ? { id: r.id, month: r.month } : null;
    },
    async latestRevision(periodKey) {
      const [r] = await q.select({ revision: fuelReports.revision }).from(fuelReports).where(eq(fuelReports.periodKey, periodKey)).orderBy(desc(fuelReports.revision)).limit(1);
      return r?.revision ?? 0;
    },
    async createReport(id, doc, pdf) {
      const [row] = await q.insert(fuelReports).values({
        id, scopeKey: doc.scopeKey, fileHash: doc.fileHash, contentHash: doc.contentHash, periodKey: doc.periodKey, filename: doc.filename,
        parsed: doc.parsed, revision: doc.revision, status: doc.status, dispositions: doc.dispositions, overrides: doc.overrides,
        importedAt: doc.importedAt, importedById: doc.importedBy.id, importedByName: doc.importedBy.name, version: 0
      }).returning();
      await q.insert(fuelSources).values({ id: id, reportId: id, pdf });
      return reportOf(row!);
    },
    async updateReport(id, change) {
      const { bump, version, ...fields } = change;
      const set: Record<string, unknown> = {};
      for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) if (key in fields) set[COLUMNS[key]] = fields[key] ?? null;
      if (bump) set.version = sql`${fuelReports.version} + 1`;
      const where = version === undefined ? eq(fuelReports.id, id) : and(eq(fuelReports.id, id), eq(fuelReports.version, version));
      if (!Object.keys(set).length) return (await q.select({ id: fuelReports.id }).from(fuelReports).where(where)).length > 0;
      return (await q.update(fuelReports).set(set).where(where).returning({ id: fuelReports.id })).length > 0;
    },
    async listReports({ ids, page, limit }) {
      const where = ids ? anyOf(fuelReports.id, ids) : undefined;
      const [count] = await q.select({ n: sql<number>`count(*)::int` }).from(fuelReports).where(where);
      const array = (key: string) => sql<number>`case when jsonb_typeof(${fuelReports.parsed} -> ${key}) = 'array' then jsonb_array_length(${fuelReports.parsed} -> ${key}) else 0 end`;
      const text = (key: string) => sql<string | null>`${fuelReports.parsed} ->> ${key}`;
      const rows = await q.select({
        id: fuelReports.id, version: fuelReports.version, filename: fuelReports.filename, status: fuelReports.status, revision: fuelReports.revision,
        importedAt: fuelReports.importedAt, importedByName: fuelReports.importedByName,
        company: text('company'), month: text('month'), start: text('start'), end: text('end'), total: text('totalCents'),
        employeeCount: array('employees'), lineCount: array('lines')
      }).from(fuelReports).where(where)
        .orderBy(sql`${text('month')} desc nulls last`, sql`${fuelReports.revision} desc nulls last`, sql`${fuelReports.importedAt} desc nulls last`, desc(fuelReports.id))
        .limit(limit).offset((page - 1) * limit);
      return { total: count?.n ?? 0, rows: rows.map(r => ({
        _id: r.id, __v: r.version, filename: r.filename as string, status: r.status as ListRow['status'], revision: r.revision as number,
        importedAt: r.importedAt as Date, importedBy: { name: r.importedByName as string },
        parsed: { company: r.company as string, month: r.month as string, start: r.start as string, end: r.end as string, totalCents: Number(r.total) },
        employeeCount: r.employeeCount, lineCount: r.lineCount
      })) };
    },
    async sourcePdf(reportId) {
      const [r] = await q.select({ pdf: fuelSources.pdf }).from(fuelSources).where(eq(fuelSources.reportId, reportId));
      return r ? Buffer.from(r.pdf) : null;
    },
    async revisionTotal() {
      const [r] = await q.select({ n: sql<number>`coalesce(sum(${fuelState.revision}), 0)::int` }).from(fuelState);
      return r?.n ?? 0;
    },

    async assignmentsOfScope(scopeKey) {
      return allocationsOf(await q.select().from(fuelAssignments).where(eq(fuelAssignments.scopeKey, scopeKey)).orderBy(asc(fuelAssignments.externalId), asc(fuelAssignments.fromDay)));
    },
    async assignmentsOf(scopeKey, externalIds) {
      return allocationsOf(await q.select().from(fuelAssignments)
        .where(and(eq(fuelAssignments.scopeKey, scopeKey), anyOf(fuelAssignments.externalId, externalIds))).orderBy(asc(fuelAssignments.fromDay)));
    },
    assignmentById: (id, scopeKey, externalId) => oneAssignment(and(eq(fuelAssignments.id, id), eq(fuelAssignments.scopeKey, scopeKey), eq(fuelAssignments.externalId, externalId)), []),
    assignmentUpTo: (scopeKey, externalId, day) => oneAssignment(and(eq(fuelAssignments.scopeKey, scopeKey), eq(fuelAssignments.externalId, externalId), lte(fuelAssignments.fromDay, day)), [desc(fuelAssignments.fromDay)]),
    assignmentAfter: (scopeKey, externalId, from) => oneAssignment(and(eq(fuelAssignments.scopeKey, scopeKey), eq(fuelAssignments.externalId, externalId), gt(fuelAssignments.fromDay, from)), [asc(fuelAssignments.fromDay)]),
    async assignmentsOpenAt(scopeKey, externalId, day) {
      return allocationsOf(await q.select().from(fuelAssignments).where(and(
        eq(fuelAssignments.scopeKey, scopeKey), eq(fuelAssignments.externalId, externalId), lte(fuelAssignments.fromDay, day),
        or(isNull(fuelAssignments.toDay), gt(fuelAssignments.toDay, day)))));
    },
    async setAssignmentEnd(ids, to, actor) {
      if (!ids.length) return;
      await q.update(fuelAssignments).set({ toDay: to || null, updatedById: actor.id, updatedByName: actor.name, updatedAt: new Date() }).where(inArray(fuelAssignments.id, ids));
    },
    async saveAssignment(id, a) {
      const values = {
        scopeKey: a.scopeKey, externalId: a.externalId, reportedName: a.reportedName ?? null, driverKey: a.driverKey, driverName: a.driverName,
        fromDay: a.from, toDay: a.to || null, updatedById: a.updatedBy.id, updatedByName: a.updatedBy.name, updatedAt: a.updatedAt
      };
      const [row] = await q.insert(fuelAssignments).values({ id, ...values })
        .onConflictDoUpdate({ target: [fuelAssignments.scopeKey, fuelAssignments.externalId, fuelAssignments.fromDay], set: values })
        .returning({ id: fuelAssignments.id });
      await q.delete(fuelAssignmentAllocations).where(eq(fuelAssignmentAllocations.assignmentId, row!.id));
      if (a.allocations.length) await q.insert(fuelAssignmentAllocations).values(a.allocations.map((p, position) => ({
        assignmentId: row!.id, position, location: p.location, basisPoints: p.basisPoints })));
    },
    async addAssignmentsIfAbsent(list) {
      for (const { id, a } of list) {
        const [row] = await q.insert(fuelAssignments).values({
          id, scopeKey: a.scopeKey, externalId: a.externalId, reportedName: a.reportedName ?? null, driverKey: a.driverKey, driverName: a.driverName,
          fromDay: a.from, toDay: a.to || null, updatedById: a.updatedBy.id, updatedByName: a.updatedBy.name, updatedAt: a.updatedAt
        }).onConflictDoNothing().returning({ id: fuelAssignments.id });
        if (row && a.allocations.length) await q.insert(fuelAssignmentAllocations).values(a.allocations.map((p, position) => ({
          assignmentId: row.id, position, location: p.location, basisPoints: p.basisPoints })));
      }
    },

    async factsOfReport(reportId, locations) {
      const where = and(eq(fuelExpenses.reportId, reportId), locations ? anyOf(fuelExpenses.location, locations) : undefined);
      return (await q.select().from(fuelExpenses).where(where).orderBy(asc(fuelExpenses.sourceLine), asc(fuelExpenses.location), asc(fuelExpenses.id))).map(factOf);
    },
    async addFacts(list) {
      for (let n = 0; n < list.length; n += 1000)
        await q.insert(fuelExpenses).values(list.slice(n, n + 1000).map(({ id, fact: f }) => ({
          id, reportId: f.reportId, month: f.month, scopeKey: f.scopeKey, externalId: f.externalId, driverKey: f.driverKey, driverName: f.driverName,
          location: f.location, category: f.category, amountCents: f.amountCents, sourceLine: f.sourceLine, day: f.date || null })));
    },
    async reportsWithFacts(locations) {
      return (await q.selectDistinct({ id: fuelExpenses.reportId }).from(fuelExpenses).where(anyOf(fuelExpenses.location, locations))).map(r => r.id);
    },
    async ownShares(reportIds, locations) {
      const rows = await q.select({
        reportId: fuelExpenses.reportId, total: sql<string>`coalesce(sum(${fuelExpenses.amountCents}), 0)`,
        drivers: sql<number>`count(distinct ${fuelExpenses.driverKey})::int`, lines: sql<number>`count(distinct ${fuelExpenses.sourceLine})::int`
      }).from(fuelExpenses).where(and(anyOf(fuelExpenses.reportId, reportIds), anyOf(fuelExpenses.location, locations))).groupBy(fuelExpenses.reportId);
      return rows.map(r => ({ reportId: r.reportId, totalCents: Number(r.total), driverCount: r.drivers, lineCount: r.lines }));
    },
    async locationCents(month, reportIds, locations) {
      if (!reportIds.length) return [];
      const rows = await q.select({ location: fuelExpenses.location, cents: sql<string>`coalesce(sum(${fuelExpenses.amountCents}), 0)` }).from(fuelExpenses)
        .where(and(eq(fuelExpenses.month, month), anyOf(fuelExpenses.reportId, reportIds), locations ? anyOf(fuelExpenses.location, locations) : undefined))
        .groupBy(fuelExpenses.location);
      return rows.map(r => ({ location: r.location as string, cents: Number(r.cents) }));
    },
    async monthFacts(month, reportIds, locations) {
      if (!reportIds.length) return [];
      return (await q.select().from(fuelExpenses)
        .where(and(eq(fuelExpenses.month, month), anyOf(fuelExpenses.reportId, reportIds), locations ? anyOf(fuelExpenses.location, locations) : undefined))
        .orderBy(asc(fuelExpenses.reportId), asc(fuelExpenses.sourceLine), asc(fuelExpenses.location), asc(fuelExpenses.id))).map(factOf);
    },

    async period(id) {
      const [r] = await q.select().from(fuelPeriods).where(eq(fuelPeriods.id, id));
      return r ? periodOf(r) : null;
    },
    async ensurePeriod(id, scopeKey, month) {
      await q.insert(fuelPeriods).values({ id, scopeKey, month, closed: false }).onConflictDoNothing();
    },
    async updatePeriod(id, change) {
      const set: Partial<typeof fuelPeriods.$inferInsert> = {};
      if ('publishedReportId' in change) set.publishedReportId = change.publishedReportId ?? null;
      if ('closed' in change) set.closed = !!change.closed;
      if (change.closedBy) { set.closedById = change.closedBy.id; set.closedByName = change.closedBy.name; }
      if (change.closedAt) set.closedAt = change.closedAt;
      if (Object.keys(set).length) await q.update(fuelPeriods).set(set).where(eq(fuelPeriods.id, id));
    },
    async publishedReportIds(month) {
      return (await q.selectDistinct({ id: fuelPeriods.publishedReportId }).from(fuelPeriods)
        .where(and(eq(fuelPeriods.month, month), isNotNull(fuelPeriods.publishedReportId)))).flatMap(r => (r.id ? [r.id] : []));
    },
    async publishedAmong(reportIds) {
      return (await q.selectDistinct({ id: fuelPeriods.publishedReportId }).from(fuelPeriods).where(anyOf(fuelPeriods.publishedReportId, reportIds))).flatMap(r => (r.id ? [r.id] : []));
    },

    async addAudit({ id, reportId, scopeKey, action, at, actor, note, detail }) {
      await q.insert(fuelHistory).values({ id, reportId, scopeKey, action, at, actorId: actor.id, actorName: actor.name, note, detail });
    },
    async auditPage(reportId, page, limit) {
      const [count] = await q.select({ n: sql<number>`count(*)::int` }).from(fuelHistory).where(eq(fuelHistory.reportId, reportId));
      const rows = await q.select().from(fuelHistory).where(eq(fuelHistory.reportId, reportId)).orderBy(desc(fuelHistory.at), desc(fuelHistory.id)).limit(limit).offset((page - 1) * limit);
      return { total: count?.n ?? 0, items: rows.map(r => ({
        _id: r.id, __v: 0, reportId: r.reportId as string, scopeKey: r.scopeKey as string, action: r.action as string, at: r.at as Date,
        actor: person(r.actorId, r.actorName), note: r.note as string, detail: r.detail
      })) as unknown as AuditRecord[] };
    },
  };
}
