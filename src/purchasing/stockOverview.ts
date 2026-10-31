import { SLAB_STATUS_BUCKET } from '../utils/inventoryStatus.ts';
import { shiftDay, variantKey } from './planning.ts';
import type { StockBreakdown, StockCoverage } from './types.ts';

export interface OverviewStockRow {
  type?: string;
  serialNumber?: string;
  instockQty?: number;
  availableSlabs?: number;
  availableQuantity?: number;
  slabStatus?: string;
  remnant?: string;
}
const isRemnant = (value: string | undefined) => !!value?.trim() && !['NO', 'N', 'FALSE', '0'].includes(value.trim().toUpperCase());
/** Physical on-hand identities, not sums of SF or the available-only slab column. */
export function stockBreakdown(rows: OverviewStockRow[], reserved: ReadonlySet<string>): StockBreakdown {
  let total = 0, allocated = 0, otherUnavailable = 0, available = 0, availableQuantity = 0;
  const seen = new Set<string>(), problems = new Set<string>();
  for (const row of rows) {
    if (!row.type?.trim()) { problems.add('Stock rows lack a product type; re-import stock detail'); continue; }
    if (row.type.trim().toUpperCase() !== 'SLAB') continue;
    if (!Number.isFinite(row.instockQty) || row.instockQty! < 0) { problems.add('On-hand quantity is missing or invalid'); continue; }
    if (row.instockQty === 0) continue;
    const serial = variantKey(row.serialNumber || '');
    if (!serial || seen.has(serial)) { problems.add('Missing or duplicate slab serials require reconciliation'); continue; }
    seen.add(serial); total++;
    const status = SLAB_STATUS_BUCKET(row.slabStatus);
    if (reserved.has(serial) || ['hold', 'so', 'pickticket', 'packinglist'].includes(status)) {
      allocated++;
    } else if (status !== 'available' || isRemnant(row.remnant)) {
      otherUnavailable++;
      if (status === 'other') problems.add('Unknown SPS status must be reconciled');
    } else if (row.availableSlabs === 1 && Number.isFinite(row.availableQuantity) && row.availableQuantity! > 0 && row.availableQuantity! <= row.instockQty! + 0.01) {
      available++; availableQuantity += row.availableQuantity!;
    } else {
      otherUnavailable++;
      if (row.availableSlabs !== 0 || row.availableQuantity !== 0)
        problems.add('Physical slab and reported available quantity disagree');
    }
  }
  if (problems.size) return { total: null, allocated: null, otherUnavailable: null, available: null, availableQuantity: null, problems: [...problems] };
  return { total, allocated, otherUnavailable, available, availableQuantity, problems: [] };
}

export function stockCoverage({ stock, sold, days, blockers, today, uom, warnings = [], salesPeriod }: {
  stock: StockBreakdown | null; sold: number | null; days: number; blockers: string[]; today: string; uom: string;
  warnings?: string[]; salesPeriod?: { start: string; through: string };
}): StockCoverage {
  const evidence = { warnings: [...new Set(warnings)], salesPeriod };
  const reasons = [...blockers, ...(stock?.problems || [])];
  if (!stock || stock.availableQuantity === null) reasons.push('Available stock is not verified');
  if (uom !== 'SF') reasons.push('Stock coverage requires matching full-slab SF quantities');
  if (!Number.isFinite(sold) || sold === null || sold < 0 || days <= 0) reasons.push('A valid observed sales period is required');
  if (reasons.length) return { ...evidence, state: 'unknown', days: null, dailyQuantity: null, availableQuantity: stock?.availableQuantity ?? null, stockoutDate: null, reasons: [...new Set(reasons)] };
  const dailyQuantity = sold! / days;
  if (dailyQuantity === 0) return { ...evidence, state: 'no-sales', days: null, dailyQuantity: 0, availableQuantity: stock!.availableQuantity, stockoutDate: null, reasons: [] };
  const cover = stock!.availableQuantity! / dailyQuantity;
  return { ...evidence, state: warnings.length ? 'estimated' : 'known', days: cover, dailyQuantity, availableQuantity: stock!.availableQuantity,
    stockoutDate: cover <= 36500 ? shiftDay(today, Math.ceil(cover)) : null, reasons: [] };
}
