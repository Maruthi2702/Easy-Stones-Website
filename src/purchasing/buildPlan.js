import { SLAB_STATUS_BUCKET } from '../utils/inventoryStatus.js';
import { project, inclusiveDays, todayPacific, variantKey } from './planning.ts';
import { digest } from './data.js';
export const stockId = (rows) =>
  digest(rows.map((s) => [String(s._id), s.importedAt, s.availableSlabs, s.availableQuantity, s.slabStatus]));
const unit = (s) =>
  String(s || '')
    .trim()
    .toUpperCase();
const key = (product, uom) => `${variantKey(product)}::${unit(uom)}`;
const remnant = (value) =>
  !!String(value || '').trim() && !['NO', 'N', 'FALSE', '0'].includes(String(value).trim().toUpperCase());
const ageHours = (at, now) => (at ? (now.getTime() - new Date(at).getTime()) / 3600000 : Infinity);
export function buildPlan(inputs, now = new Date()) {
  const { scope, cohort, inbound, reservations, locks } = inputs,
    today = todayPacific(now);
  const stock = inputs.stock.filter((s) => scope.branches.includes(s.location));
  const snapshot = stockId(stock),
    imported =
      stock
        .map((s) => s.importedAt?.toISOString?.() || s.importedAt)
        .filter(Boolean)
        .sort()[0] || null;
  const blockers = [];
  if (!cohort)
    blockers.push('Select a current sales cohort; its imported records changed or are unavailable');
  const days = cohort ? inclusiveDays(cohort.start, scope.observedThrough) : 0;
  if (!days || scope.observedThrough > today || (cohort && scope.observedThrough > cohort.end))
    blockers.push('Confirm an observed sales cutoff inside the report range and no later than today');
  if (cohort && scope.observedThrough > todayPacific(new Date(cohort.importedAt)))
    blockers.push('Observed sales cutoff cannot be after the report import date');
  if (cohort && cohort.records.some((r) => r.importedAt?.toISOString() !== cohort.importedAt))
    blockers.push('Sales cohort contains mixed imports; re-import the complete report');
  if (scope.observedThrough && inclusiveDays(scope.observedThrough, today) > scope.salesMaxDays + 1)
    blockers.push('Sales coverage is stale; import an updated report');
  if (!scope.fullSalesCoverage)
    blockers.push('Confirm the report branch scope and full product coverage, including zero sellers');
  if (!scope.stockCoverageConfirmed || scope.stockSnapshotId !== snapshot)
    blockers.push('Confirm complete warehouse coverage for this exact stock snapshot');
  if (ageHours(imported, now) > scope.stockMaxHours || ageHours(imported, now) < 0)
    blockers.push('Warehouse stock is stale or future-dated; refresh the stock snapshot');
  if (new Set(stock.map((s) => String(s.importedAt))).size > 1)
    blockers.push('Stock contains mixed import snapshots; wait for a complete import');
  if (!scope.freeStockValidated)
    blockers.push(
      'Confirm SPS availability excludes existing obligations and app reservations are reconciled',
    );
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
  const stocks = new Map(),
    sales = new Map();
  const reserved = new Set(
    reservations.filter((r) => scope.branches.includes(r.branch)).map((r) => variantKey(r.slabKey)),
  );
  const aliasName = (name) => aliases.get(variantKey(name)) || name;
  for (const s of stock) {
    const product = aliasName(s.product),
      k = key(product, s.units),
      a = stocks.get(k) || {
        product,
        uom: unit(s.units),
        readySlabs: 0,
        readyQuantity: 0,
        excludedSlabs: 0,
        problems: [],
      };
    if (SLAB_STATUS_BUCKET(s.slabStatus) === 'other')
      a.problems.push('Unknown SPS slab status: reconcile it before purchasing');
    const usable =
      SLAB_STATUS_BUCKET(s.slabStatus) === 'available' &&
      !remnant(s.remnant) &&
      !reserved.has(variantKey(s.serialNumber));
    if (
      !Number.isFinite(s.availableSlabs) ||
      !Number.isFinite(s.availableQuantity) ||
      s.availableSlabs < 0 ||
      s.availableQuantity < 0
    )
      a.problems.push('Negative source availability must be reconciled');
    if (usable) {
      a.readySlabs += s.availableSlabs || 0;
      a.readyQuantity += s.availableQuantity || 0;
    } else a.excludedSlabs += s.availableSlabs || 0;
    stocks.set(k, a);
  }
  for (const sale of cohort?.records || []) {
    const k = key(sale.product, sale.uom);
    if (sales.has(k)) blockers.push('Duplicate product/unit rows in the selected cohort require correction');
    sales.set(k, sale);
  }
  const keys = [...new Set([...stocks.keys(), ...sales.keys()])];
  const rows = keys.map((k) => {
    const s = stocks.get(k),
      sale = sales.get(k),
      product = sale?.product || s.product,
      uom = unit(sale?.uom || s.uom),
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
    const receipts = (inbound?.receipts || []).filter(
      (r) => scope.branches.includes(r.branch) && variantKey(aliasName(r.product)) === variantKey(product),
    );
    if (receipts.some((r) => !r.confirmed || !r.eta || r.eta < today))
      rowBlockers.push('Incoming supply has an unconfirmed, missing or overdue usable-receipt ETA');
    if (
      s &&
      ((s.readySlabs > 0 && s.readyQuantity <= 0) ||
        (s.readySlabs === 0 && s.readyQuantity > 0) ||
        !Number.isSafeInteger(s.readySlabs))
    )
      rowBlockers.push('Ready slab and SF availability disagree');
    const lockName =
      scope.aliases.find((a) => variantKey(a.salesProduct) === variantKey(product))?.stockProduct || product;
    const draft = locks.find((l) =>
      scope.branches.some((branch) => l._id === JSON.stringify([branch, variantKey(lockName)])),
    );
    if (draft) rowBlockers.push('This variant is already reserved by an active purchasing draft');
    const calc = (leadDays) =>
      project({
        daily: Math.max(0, sold || 0) / Math.max(1, days) / policy.sfPerSlab,
        ready: Math.max(0, s?.readyQuantity || 0) / policy.sfPerSlab,
        receipts,
        policy,
        today,
        leadDays,
        reviewDays: scope.reviewDays,
        bufferDays: scope.bufferDays,
      });
    const baseline = rowBlockers.length ? null : calc(60),
      protective = rowBlockers.length ? null : calc(90);
    return {
      key: k,
      product,
      uom,
      sold,
      soldSlabs: sale?.slabsSold ?? null,
      readySlabs: s?.readySlabs ?? (policy && scope.stockCoverageConfirmed ? 0 : null),
      readyQuantity: s?.readyQuantity ?? null,
      excludedSlabs: s?.excludedSlabs || 0,
      hasStock: !!s,
      blockers: [...new Set(rowBlockers)],
      policy,
      baseline,
      protective,
      draftId: draft ? String(draft.draftId) : undefined,
      action: rowBlockers.length
        ? 'Resolve inputs'
        : !policy.active
          ? 'Discontinued / manual review'
          : protective.stockoutOn && protective.stockoutOn <= protective.regularArrival
            ? protective.proposedSlabs
              ? 'Transfer / expedite review'
              : 'Expedite existing supply'
            : protective.proposedSlabs === 0
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
    cohort?.id,
    snapshot,
    inbound ? String(inbound._id) : null,
    reservations.filter((r) => scope.branches.includes(r.branch)).map((r) => [r.slabKey, String(r.holdId)]),
    stock.map((s) => [s.serialNumber, s.remnant]),
  ]);
  return {
    scope,
    cohort: cohort ? (({ records, ...rest }) => rest)(cohort) : null,
    fingerprint,
    today,
    generatedAt: now.toISOString(),
    stockSnapshotId: snapshot,
    stockImportedAt: imported,
    inboundImportedAt: inbound?.createdAt || null,
    blockers: [...new Set(blockers)],
    rows,
    draftIds: [...new Set(rows.map((r) => r.draftId).filter(Boolean))],
  };
}
