import { createHash } from 'node:crypto';
import { emptyAmounts } from './types.ts';
import type { Allocation, Assignment, CategoryOverride, CostFact, Disposition, LocationTotal, ParsedReport, ReportReview } from './types.ts';
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function splitCents(cents: number, allocations: Allocation[]): number[] {
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 100_000_000_00 || !allocations.length || allocations.some(a => !Number.isSafeInteger(a.basisPoints) || a.basisPoints <= 0) ||
    allocations.reduce((s, a) => s + a.basisPoints, 0) !== 10000) throw new Error('Allocation must add to exactly 100%');
  const magnitude = Math.abs(cents), sign = Math.sign(cents);
  const result = allocations.map(a => Math.floor(magnitude * a.basisPoints / 10000));
  const remaining = magnitude - result.reduce((s, n) => s + n, 0);
  const order = allocations.map((a, i) => ({ i, remainder: magnitude * a.basisPoints % 10000, name: a.location }))
    .sort((a, b) => b.remainder - a.remainder || a.name.localeCompare(b.name));
  for (let n = 0; n < remaining; n++) result[order[n]!.i]!++;
  return result.map(n => sign * n);
}
export function locationTotals(facts: CostFact[]): LocationTotal[] {
  const map = new Map<string, { total: LocationTotal; drivers: Set<string>; lines: Set<number> }>();
  for (const fact of facts) {
    const entry = map.get(fact.location) || { total: { location: fact.location, amounts: emptyAmounts(), totalCents: 0, driverCount: 0, lineCount: 0 }, drivers: new Set<string>(), lines: new Set<number>() };
    entry.total.totalCents += fact.amountCents; entry.total.amounts[fact.category] += fact.amountCents;
    entry.drivers.add(fact.driverKey); entry.lines.add(fact.sourceLine); map.set(fact.location, entry);
  }
  return [...map.values()].map(v => ({ ...v.total, driverCount: v.drivers.size, lineCount: v.lines.size })).sort((a, b) => a.location.localeCompare(b.location));
}
export function buildReview(report: ParsedReport, assignments: Assignment[], dispositions: Disposition[], overrides: CategoryOverride[], context: unknown): ReportReview {
  const facts: CostFact[] = [], issues: string[] = [], amounts = emptyAmounts(), present = new Set(report.employees.map(e => e.externalId));
  const override = new Map(overrides.map(o => [o.index, o.category]));
  const drivers = report.employees.map(employee => {
    const mappings = assignments.filter(a => a.externalId === employee.externalId), problems = new Set<string>(), locations = new Set<string>();
    const keys = new Set<string>(), names = new Set<string>(), employeeAmounts = emptyAmounts();
    for (const line of report.lines.filter(l => l.externalId === employee.externalId)) {
      const category = override.get(line.index) || line.category;
      employeeAmounts[category] += line.amountCents; amounts[category] += line.amountCents;
      if (category === 'other') problems.add('Classify unrecognized non-fuel expenses');
      const current = mappings.filter(a => a.from <= line.date && (!a.to || line.date < a.to));
      if (current.length !== 1) { problems.add(current.length ? 'Assignments overlap for this period' : 'Assign a driver and location for every transaction date'); continue; }
      const a = current[0]!; keys.add(a.driverKey); names.add(a.driverName);
      try {
        const parts = splitCents(line.amountCents, a.allocations);
        a.allocations.forEach((allocation, n) => {
          locations.add(allocation.location);
          facts.push({ externalId: line.externalId, driverKey: a.driverKey, driverName: a.driverName, location: allocation.location,
            category, amountCents: parts[n]!, sourceLine: line.index, date: line.date });
        });
      } catch { problems.add('Location allocation must add to 100%'); }
    }
    if (keys.size > 1) problems.add('One reported identity is assigned to different drivers within this report; review the identity');
    const employeeIssues = [...problems]; issues.push(...employeeIssues.map(p => `${employee.externalId}: ${p}`));
    return { ...employee, amounts: employeeAmounts, driverKey: [...keys][0] || '', driverName: [...names][0] || '', locations: [...locations], issues: employeeIssues,
      suggestedFrom: [report.start, ...report.lines.filter(l => l.externalId === employee.externalId).map(l => l.date)].sort()[0]!,
      suggestions: [...new Map(assignments.filter(a => a.externalId !== employee.externalId && a.from <= report.end && a.reportedName?.trim().toLowerCase() === employee.name.trim().toLowerCase()).map(a => [a.driverKey, { driverKey: a.driverKey, driverName: a.driverName, externalId: a.externalId }])).values()],
      newIdentity: !mappings.some(a => a.from <= report.end), assignments: mappings };
  });
  const expected = new Map<string, string>();
  assignments.filter(a => a.from <= report.end && (!a.to || a.to > report.start)).forEach(a => expected.set(a.externalId, a.driverName));
  // Resolved retirements/aliases remain visible on their review, even though
  // ending their expected interval removes them from future missing rosters.
  dispositions.forEach(d => { if (!present.has(d.externalId) && !expected.has(d.externalId)) expected.set(d.externalId, assignments.find(a => a.externalId === d.externalId)?.driverName || d.externalId); });
  const missing = [...expected].filter(([id]) => !present.has(id)).map(([externalId, driverName]) => {
    const d = dispositions.find(d => d.externalId === externalId);
    const resolved = !!d && !['incomplete', 'investigating'].includes(d.reason);
    if (!resolved) issues.push(`${externalId}: explain the missing driver${d ? ` (${d.reason})` : ''}`);
    return { externalId, driverName, reason: d?.reason || '' as const, note: d?.note || '', resolved };
  });
  const locations = locationTotals(facts), allocatedCents = facts.reduce((s, f) => s + f.amountCents, 0);
  if (allocatedCents !== report.totalCents && !issues.length) issues.push('Allocated expenses do not reconcile to the source total');
  return { token: digest([context, assignments, dispositions, overrides]), ready: !issues.length, issues, drivers, missing, locations, facts,
    totalCents: report.totalCents, amounts, unresolvedCount: drivers.filter(d => d.issues.length).length + missing.filter(m => !m.resolved).length,
    allocatedCents, unallocatedCents: report.totalCents - allocatedCents };
}
