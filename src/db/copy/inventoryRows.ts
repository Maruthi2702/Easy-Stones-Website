/**
 * MongoDB → Postgres rows for Inventory (src/db/schema/inventory.ts).
 * StoneProfits' labels (location, status…) are copied as text, untouched.
 */
import type { Loose } from '../../types/records.ts';
import type {
  inventoryItems, inventorySalesRecords, inventoryTransitShipments, inventoryTransitLines, inventoryTransitReports,
  inventoryTransitEvents, inventoryRevision, inventoryStockImports, inventoryStockBackups, inventoryStockState
} from '../schema/inventory.ts';
import { stamp } from './referenceRows.ts';
import { plainJson, snapshotJson } from './linkedRows.ts';
import { idOf, idTime, textOf, rowConverter, intOf, pickOf, decimalOf, stringsOf, boolOf, type CopyProblem } from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface InventorySource {
  inventoryItems: Loose[];
  inventorySalesRecords: Loose[];
  inventoryTransitShipments: Loose[];
  inventoryTransitReports: Loose[];
  inventoryTransitEvents: Loose[];
  inventoryRevision: Loose[];
  inventoryStockImports: Loose[];
  inventoryStockBackups: Loose[];
  inventoryStockState: Loose[];
}

export interface InventoryRows {
  inventoryItems: Row<typeof inventoryItems>[];
  inventorySalesRecords: Row<typeof inventorySalesRecords>[];
  inventoryTransitShipments: Row<typeof inventoryTransitShipments>[];
  inventoryTransitLines: Row<typeof inventoryTransitLines>[];
  inventoryTransitReports: Row<typeof inventoryTransitReports>[];
  inventoryTransitEvents: Row<typeof inventoryTransitEvents>[];
  inventoryRevision: Row<typeof inventoryRevision>[];
  inventoryStockImports: Row<typeof inventoryStockImports>[];
  inventoryStockBackups: Row<typeof inventoryStockBackups>[];
  inventoryStockState: Row<typeof inventoryStockState>[];
}

/** Optional text (Mongoose fields with no default): missing stays null. */
const optText = (v: unknown): string | null => v == null ? null : String(v);
const optBool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
const stringId = (v: unknown): string | null => typeof v === 'string' && v ? v : null;

export function inventoryRows(src: InventorySource, problems: CopyProblem[]): InventoryRows {
  const rows: InventoryRows = {
    inventoryItems: [], inventorySalesRecords: [], inventoryTransitShipments: [], inventoryTransitLines: [],
    inventoryTransitReports: [], inventoryTransitEvents: [], inventoryRevision: [], inventoryStockImports: [],
    inventoryStockBackups: [], inventoryStockState: []
  };
  const num = (v: unknown) => decimalOf(v) ?? '0';

  for (const d of src.inventoryItems) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'inventory_items', id);
    rows.inventoryItems.push({
      id, product: textOf(d.product), sku: textOf(d.sku), genericSku: textOf(d.genericSku), type: textOf(d.type),
      category: textOf(d.category), subCategory: textOf(d.subCategory), group: textOf(d.group), kind: textOf(d.kind),
      serialNumber: textOf(d.serialNumber), barcodeId: textOf(d.barcodeId), bundle: textOf(d.bundle),
      slabNumber: textOf(d.slabNumber), block: textOf(d.block), idFour: textOf(d.idFour), idFive: textOf(d.idFive),
      suppBarcodeId: textOf(d.suppBarcodeId), bin: textOf(d.bin), dimensions: textOf(d.dimensions),
      instockQty: num(d.instockQty), availableSlabs: num(d.availableSlabs), availableQuantity: num(d.availableQuantity),
      units: textOf(d.units), supplier: textOf(d.supplier), unitFobCost: num(d.unitFobCost),
      unitLandedCost: num(d.unitLandedCost), purchaseCost: num(d.purchaseCost), assetValue: num(d.assetValue),
      location: textOf(d.location), slabStatus: textOf(d.slabStatus), notes: textOf(d.notes), remnant: textOf(d.remnant),
      receivedDate: c.moment('received_date', d.receivedDate),
      importedAt: c.moment('imported_at', d.importedAt) ?? idTime(d._id),
      importedByName: textOf(d.importedByName), importedById: stringId(d.importedById),
      ...stamp(c, d)
    });
  }

  for (const d of src.inventorySalesRecords) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'inventory_sales_records', id);
    const periodStart = c.moment('period_start', d.periodStart), periodEnd = c.moment('period_end', d.periodEnd);
    if (!periodStart || !periodEnd) { c.problem('period', 'no period', 'skipped'); continue; }
    rows.inventorySalesRecords.push({
      id, product: textOf(d.product), sku: textOf(d.sku), type: textOf(d.type), category: textOf(d.category),
      subCategory: textOf(d.subCategory), group: textOf(d.group), origin: textOf(d.origin),
      slabsSold: num(d.slabsSold), quantitySold: num(d.quantitySold), uom: textOf(d.uom), saleValue: num(d.saleValue),
      cost: num(d.cost), avgSellingPrice: num(d.avgSellingPrice), avgCost: num(d.avgCost), margin: num(d.margin),
      marginPercent: num(d.marginPercent), location: textOf(d.location), periodStart, periodEnd,
      importedAt: c.moment('imported_at', d.importedAt) ?? idTime(d._id), importedByName: textOf(d.importedByName),
      importedById: stringId(d.importedById), ...stamp(c, d)
    });
  }

  for (const d of src.inventoryTransitShipments) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'inventory_transit_shipments', id);
    rows.inventoryTransitShipments.push({
      id, poNumber: textOf(d.poNumber), containerNumber: textOf(d.containerNumber), location: textOf(d.location),
      active: boolOf(d.active, true), reportId: optText(d.reportId), sourceSignature: optText(d.sourceSignature),
      confirmedSignature: optText(d.confirmedSignature), usableReceiptDate: c.moment('usable_receipt_date', d.usableReceiptDate),
      receiptConfirmedAt: c.moment('receipt_confirmed_at', d.receiptConfirmedAt), receiptConfirmedBy: optText(d.receiptConfirmedBy),
      inactiveAt: c.moment('inactive_at', d.inactiveAt), inactiveReason: optText(d.inactiveReason),
      importedAt: c.moment('imported_at', d.importedAt), importedByName: optText(d.importedByName),
      ...stamp(c, d)
    });
    (Array.isArray(d.lines) ? d.lines : []).forEach((l: Loose, position: number) => {
      rows.inventoryTransitLines.push({
        shipmentId: id, position, product: optText(l.product), sku: optText(l.sku), poNumber: optText(l.poNumber),
        containerNumber: optText(l.containerNumber), location: optText(l.location),
        poDate: c.moment('lines.po_date', l.poDate), poEtaDate: c.moment('lines.po_eta_date', l.poEtaDate),
        supplierSoNumber: optText(l.supplierSoNumber), siplNumber: optText(l.siplNumber),
        slabs: decimalOf(l.slabs), quantity: decimalOf(l.quantity), units: optText(l.units), supplier: optText(l.supplier),
        freightForwarder: optText(l.freightForwarder), shipDate: c.moment('lines.ship_date', l.shipDate),
        portEtaDate: c.moment('lines.port_eta_date', l.portEtaDate), etaDate: c.moment('lines.eta_date', l.etaDate),
        vessel: optText(l.vessel), customerReference: optText(l.customerReference),
        supplierPurchaseNote: optText(l.supplierPurchaseNote), status: optText(l.status)
      });
    });
  }

  for (const d of src.inventoryTransitReports) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'inventory_transit_reports', d._id);
    rows.inventoryTransitReports.push({
      id: d._id, branches: stringsOf(d.branches), complete: optBool(d.complete), sourceFilename: optText(d.sourceFilename),
      sourceHash: optText(d.sourceHash), importedAt: c.moment('imported_at', d.importedAt), importedByName: optText(d.importedByName),
      lineCount: intOf(c, 'line_count', d.lineCount), shipmentCount: intOf(c, 'shipment_count', d.shipmentCount),
      withdrawnCount: intOf(c, 'withdrawn_count', d.withdrawnCount)
    });
  }

  for (const d of src.inventoryTransitEvents) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'inventory_transit_events', id);
    const at = c.moment('at', d.at);
    const action = pickOf(c, 'action', d.action, ['reported', 'not-reported', 'receipt-confirmed'] as const, null);
    if (!at || !action) { c.problem('id', 'no time or action', 'skipped'); continue; }
    rows.inventoryTransitEvents.push({
      id, shipmentId: textOf(idOf(d.shipmentId) ?? d.shipmentId), reportId: optText(d.reportId), at, actor: optText(d.actor),
      action, snapshot: d.snapshot == null ? null : plainJson(d.snapshot)
    });
  }

  for (const d of src.inventoryRevision) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'inventory_revision', d._id);
    rows.inventoryRevision.push({ id: d._id, revision: intOf(c, 'revision', d.revision) ?? 0 });
  }

  for (const d of src.inventoryStockImports) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'inventory_stock_imports', d._id);
    const importedAt = c.moment('imported_at', d.importedAt), backupExpiresAt = c.moment('backup_expires_at', d.backupExpiresAt);
    if (!importedAt || !backupExpiresAt) { c.problem('id', 'no import or expiry time', 'skipped'); continue; }
    rows.inventoryStockImports.push({
      id: d._id, version: intOf(c, 'version', d.version) ?? 0, sourceFilename: textOf(d.sourceFilename),
      sourceHash: textOf(d.sourceHash), count: intOf(c, 'count', d.count) ?? 0,
      previousCount: intOf(c, 'previous_count', d.previousCount) ?? 0, backupChunks: intOf(c, 'backup_chunks', d.backupChunks) ?? 0,
      importedAt, importedById: stringId(d.importedById), importedByName: textOf(d.importedByName), backupExpiresAt
    });
  }

  for (const d of src.inventoryStockBackups) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'inventory_stock_backups', d._id);
    const expiresAt = c.moment('expires_at', d.expiresAt);
    if (!expiresAt) { c.problem('expires_at', 'no expiry', 'skipped'); continue; }
    // Kept in MongoDB extended JSON: a restore puts back exactly the items that were there.
    rows.inventoryStockBackups.push({
      id: d._id, importId: textOf(d.importId), chunk: intOf(c, 'chunk', d.chunk) ?? 0,
      items: snapshotJson(Array.isArray(d.items) ? d.items : []), expiresAt
    });
  }

  for (const d of src.inventoryStockState) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'inventory_stock_state', d._id);
    rows.inventoryStockState.push({ id: d._id, version: intOf(c, 'version', d.version) ?? 0, importId: optText(d.importId) });
  }

  return rows;
}
