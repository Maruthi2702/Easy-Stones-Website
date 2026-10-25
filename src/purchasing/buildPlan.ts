import type { PlanInputs, PlanningStock, PlanningStockGroup, PlanningSale } from './planInputs.ts';
import type { Receipt } from './types.ts';
import { reportSalesPeriod } from './salesPeriod.ts';
import { stockBreakdown, stockCoverage } from './stockOverview.ts';
import { project, inclusiveDays, todayPacific, variantKey } from './planning.ts';
import { digest } from './data.ts';
import { transitSupply, parentSupplyKey } from './transitSupply.ts';
export const stockId = (rows: PlanningStock[]) =>
  digest(rows.map((s) => [String(s._id), s.importedAt, s.availableSlabs, s.availableQuantity, s.slabStatus]));
const unit = (s: unknown) =>
  String(s || '')
    .trim()
    .toUpperCase();
const key = (product: string, uom: string) => `${variantKey(product)}::${unit(uom)}`;
const ageHours = (at: Date | string | null | undefined, now: Date) => (at ? (now.getTime() - new Date(at!).getTime()) / 3600000 : Infinity);
export function buildPlan(inputs: PlanInputs, now = new Date()) {
  const { scope: storedScope, cohort, inbound, reservations, locks } = inputs,
    today = todayPacific(now);
  const period = reportSalesPeriod(cohort, today, storedScope.observedThrough);
  const scope = { ...storedScope, observedThrough: period.through };
  const stock = inputs.stock.filter((s) => scope.branches.includes(s.location));
  const snapshot = stockId(stock),
    imported =
      stock
        .map((s) => s.importedAt instanceof Date ? s.importedAt.toISOString() : s.importedAt)
        .filter(Boolean)
        .sort()[0] || null;
  const blockers: string[] = [], coverageBlockers: string[] = [], coverageWarnings: string[] = [];
  // Keep purchase approval strict. Descriptive stock cover can still be shown
  // as an estimate when its numeric inputs and branch identity are usable.
  const coverageIssue = (message: string, advisory = false) => {
    blockers.push(message);
    (advisory ? coverageWarnings : coverageBlockers).push(message);
  };
  if (!cohort)
    coverageIssue('Select a current sales cohort; its imported records changed or are unavailable');
  const days = period.days;
  if (cohort) period.errors.forEach(message => coverageIssue(message));
  if (cohort && cohort.records.some((r) => r.importedAt?.toISOString() !== cohort.importedAt))
    coverageIssue('Sales cohort contains mixed imports; re-import the complete report');
  if (scope.observedThrough && inclusiveDays(scope.observedThrough, today) > scope.salesMaxDays + 1)
    coverageIssue('Sales coverage is stale; import an updated report', true);
  if (!scope.fullSalesCoverage) {
    const sameBranch = cohort && scope.branches.length === 1 && variantKey(cohort.location || '') === variantKey(scope.branches[0]);
    coverageIssue('Confirm the report branch scope and full product coverage, including zero sellers', !!sameBranch);
  }
  if (!scope.stockCoverageConfirmed || scope.stockSnapshotId !== snapshot)
    coverageIssue('Confirm complete warehouse coverage for this exact stock snapshot', true);
  if (ageHours(imported, now) > scope.stockMaxHours)
    coverageIssue('Warehouse stock is stale; refresh the stock snapshot', true);
  if (ageHours(imported, now) < 0)
    coverageIssue('Warehouse stock is future-dated; refresh the stock snapshot');
  if (new Set(stock.map((s) => String(s.importedAt))).size > 1)
    coverageIssue('Stock contains mixed import snapshots; wait for a complete import');
  if (!scope.freeStockValidated)
    coverageIssue('Confirm SPS availability excludes existing obligations and app reservations are reconciled', true);
  if (!scope.policyConfirmed) blockers.push('Confirm receiving lead-time, review and buffer policies');
  if (!inbound?.complete)
    blockers.push('Import complete SPS PO/transit supply or explicitly confirm no incoming supply');
  if (
    inbound &&
    (ageHours(inbound.createdAt, now) > scope.stockMaxHours || ageHours(inbound.createdAt, now) < 0)
  )
    blockers.push('SPS PO/transit snapshot is stale');
  const aliases = new Map(scope.aliases.map((a) => [variantKey(a.stockProduct), a.salesProduct]));
  const policies = new Map(scope.policies.map((p) => [variantKey(p.product), p]));
  const stocks = new Map<string, PlanningStockGroup>(),
    sales = new Map<string, PlanningSale>();
  const reserved = new Set(
    reservations.filter((r) => scope.branches.includes(r.branch)).map((r) => variantKey(r.slabKey)),
  );
  const aliasName = (name: string) => aliases.get(variantKey(name)) || name;
  const transit = transitSupply(inputs.transitShipments || [], scope.branches);
  const transitImportedAt = transit.map(line => line.importedAt).filter(Boolean).sort().at(-1) || null;
  const coveredParentTotals = new Map<string, number>();
  const parentLines = new Set();
  for (const row of inbound?.rows || []) {
    const lineKey = JSON.stringify([row.po, row.line]);
    if (parentLines.has(lineKey)) continue;
    parentLines.add(lineKey);
    const parentKey = parentSupplyKey(row.po, aliasName(row.product), row.branch);
    coveredParentTotals.set(parentKey, (coveredParentTotals.get(parentKey) || 0) + row.ordered - row.received - row.cancelled);
  }
  const coveredParents = new Set(coveredParentTotals.keys());

  const physicalRows = new Map<string, PlanningStock[]>();
  for (const item of stock) {
    const product = aliasName(item.product), k = key(product, item.units);
    const group = physicalRows.get(k) || [];
    group.push(item);
    physicalRows.set(k, group);
  }
  for (const [k, items] of physicalRows) {
    const summary = stockBreakdown(items, reserved);
    stocks.set(k, { product: aliasName(items[0].product), uom: unit(items[0].units),
      readySlabs: summary.available, readyQuantity: summary.availableQuantity,
      excludedSlabs: summary.total === null || summary.available === null ? null : summary.total - summary.available,
      problems: summary.problems, summary });
  }
  const duplicateSales = new Set();
  for (const sale of cohort?.records || []) {
    const k = key(sale.product, sale.uom);
    if (sales.has(k)) { duplicateSales.add(k); blockers.push('Duplicate product/unit rows in the selected cohort require correction'); }
    sales.set(k, sale);
  }
  const transitProducts = new Map(transit.map(line => [key(aliasName(line.product), line.units), line]));
  const keys = [...new Set([...stocks.keys(), ...sales.keys(), ...transitProducts.keys()])];
  const rows = keys.map((k) => {
    const s = stocks.get(k),
      sale = sales.get(k),
      product = sale?.product || s?.product || aliasName(transitProducts.get(k)!.product),
      uom = unit(sale?.uom || s?.uom || transitProducts.get(k)!.units),
      policy = policies.get(variantKey(product)) || null;
    const rowBlockers = [...blockers, ...(s?.problems || [])];
    if (uom !== 'SF')
      rowBlockers.push('This planner supports full-slab SF variants; keep EA/other units separate');
    if (!policy) rowBlockers.push('Set a supplier, canonical variant, bundle, SF/slab and weight policy');
    if (!s && !policy) rowBlockers.push('No matching stock variant: verify mapping before inferring zero');
    const sold = sale?.quantitySold ?? (scope.fullSalesCoverage ? 0 : null);
    if (sold === null || !Number.isFinite(sold) || sold < 0)
      rowBlockers.push('Sales are missing or negative; verify returns and report coverage');
    if (!s && stock.some((r) => variantKey(aliasName(r.product)) === variantKey(product)))
      rowBlockers.push('Stock and sales UOM do not match for this variant');
    const variantTransit = transit.filter(line =>
      variantKey(aliasName(line.product)) === variantKey(product) && line.units === uom);
    const reportedParentTotals = new Map<string, number>();
    for (const line of variantTransit) {
      const parentKey = parentSupplyKey(line.poNumber, product, line.branch);
      if (line.slabs !== null) reportedParentTotals.set(parentKey, (reportedParentTotals.get(parentKey) || 0) + line.slabs);
    }
    if ([...reportedParentTotals].some(([parentKey, slabs]) => coveredParentTotals.has(parentKey) && slabs > coveredParentTotals.get(parentKey)!))
      rowBlockers.push('Imported containers exceed the remaining quantity in the PO snapshot; reconcile incoming supply');
    const additionalTransit = variantTransit.filter(line => !line.poNumber ||
      !coveredParents.has(parentSupplyKey(line.poNumber, aliasName(line.product), line.branch)));
    const transitReceipts: Receipt[] = additionalTransit.filter(line => Number.isSafeInteger(line.slabs) && line.slabs! >= 0)
      .map(line => ({ key: `sps-transit:${line.key}`, product, branch: line.branch, supplier: line.supplier,
        slabs: line.slabs!, eta: line.usableReceiptDate || line.eta || '', confirmed: line.receiptConfirmed === true }));
    if (additionalTransit.some(line => !Number.isSafeInteger(line.slabs) || line.slabs! < 0))
      rowBlockers.push('Imported in-transit supply has an unknown slab count; reconcile it before buying');
    if (variantTransit.some(line => ageHours(line.importedAt, now) > scope.stockMaxHours || ageHours(line.importedAt, now) < 0))
      rowBlockers.push('Imported in-transit report is stale or future-dated; refresh the container report');
    const receipts = [...(inbound?.receipts || []).filter(
      (r) => scope.branches.includes(r.branch) && variantKey(aliasName(r.product)) === variantKey(product),
    ), ...transitReceipts];
    if (receipts.some((r) => !r.confirmed || !r.eta || r.eta < today))
      rowBlockers.push('Incoming supply has an unconfirmed, missing or overdue usable-receipt ETA');
    if (
      s &&
      ((s.readySlabs !== null && s.readySlabs > 0 && (s.readyQuantity ?? 0) <= 0) ||
        (s.readySlabs === 0 && (s.readyQuantity ?? 0) > 0) ||
        !Number.isSafeInteger(s.readySlabs))
    )
      rowBlockers.push('Ready slab and SF availability disagree');
    const lockName =
      scope.aliases.find((a) => variantKey(a.salesProduct) === variantKey(product))?.stockProduct || product;
    const draft = locks.find((l) =>
      scope.branches.some((branch) => l._id === JSON.stringify([branch, variantKey(lockName)])),
    );
    if (draft) rowBlockers.push('This variant is already reserved by an active purchasing draft');
    const calc = (leadDays: number) =>
      project({
        daily: Math.max(0, sold || 0) / Math.max(1, days) / policy!.sfPerSlab,
        ready: Math.max(0, s?.readyQuantity || 0) / policy!.sfPerSlab,
        receipts,
        policy: policy!,
        today,
        leadDays,
        reviewDays: scope.reviewDays,
        bufferDays: scope.bufferDays,
      });
    const breakdown = s ? s.summary :
      (policy && scope.stockCoverageConfirmed && scope.stockSnapshotId === snapshot
        ? stockBreakdown([], reserved) : null);
    const coverage = stockCoverage({ stock: breakdown, sold, days, today, uom, warnings: coverageWarnings,
      salesPeriod: cohort ? { start: cohort.start, through: scope.observedThrough } : undefined,
      blockers: [...coverageBlockers, ...(duplicateSales.has(k) ? ['Duplicate sales rows require correction'] : [])] });
    const baseline = rowBlockers.length ? null : calc(60),
      protective = rowBlockers.length ? null : calc(90);
    return {
      key: k,
      product,
      uom,
      sold,
      soldSlabs: sale?.slabsSold ?? null,
      stockBreakdown: breakdown,
      coverage,
      readySlabs: s ? s.readySlabs : (policy && scope.stockCoverageConfirmed && scope.stockSnapshotId === snapshot ? 0 : null),
      readyQuantity: s?.readyQuantity ?? null,
      excludedSlabs: s?.excludedSlabs || 0,
      hasStock: !!s,
      transit: variantTransit,
      receipts,
      blockers: [...new Set(rowBlockers)],
      policy,
      baseline,
      protective,
      draftId: draft ? String(draft.draftId) : undefined,
      action: rowBlockers.length
        ? 'Resolve inputs'
        : !policy!.active
          ? 'Discontinued / manual review'
          : protective!.stockoutOn && protective!.stockoutOn <= protective!.regularArrival
            ? protective!.proposedSlabs
              ? 'Transfer / expedite review'
              : 'Expedite existing supply'
            : protective!.proposedSlabs === 0
              ? 'Monitor / no buy'
              : 'Draft container buy',
    };
  });
  rows.sort(
    (a, b) =>
      (a.protective?.stockoutOn || '9999').localeCompare(b.protective?.stockoutOn || '9999') ||
      (b.sold || 0) - (a.sold || 0) ||
      a.key.localeCompare(b.key),
  );
  const fingerprint = digest([
    today,
    scope,
    cohort?.id, cohort?.revision || cohort?.id,
    snapshot,
    inbound ? String(inbound._id) : null,
    transit,
    reservations.filter((r) => scope.branches.includes(r.branch)).map((r) => [r.slabKey, String(r.holdId)]),
    stock.map((s) => [s.serialNumber, s.remnant, s.type, s.instockQty]),
  ]);
  return {
    scope,
    cohort: cohort ? (({ records, ...rest }) => rest)(cohort) : null,
    fingerprint,
    today,
    generatedAt: now.toISOString(),
    validUntil: new Date(Math.min(now.getTime() + 30 * 60 * 1000,
      ...[imported, inbound?.createdAt, ...transit.map(t => t.importedAt)]
        .filter(Boolean).map(at => new Date(at!).getTime() + scope.stockMaxHours * 3600000)
        .filter(at => at > now.getTime()))).toISOString(),
    stockSnapshotId: snapshot,
    stockImportedAt: imported,
    inboundImportedAt: inbound?.createdAt || transitImportedAt || null,
    transitImportedAt,
    transitLineCount: transit.length,
    blockers: [...new Set(blockers)],
    rows,
    draftIds: [...new Set(rows.map((r) => r.draftId).filter(Boolean))],
  };
}
