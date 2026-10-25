export type InventoryImportKind = 'stock' | 'sales' | 'transit';
export type WorkbookParseKind = 'inventory-stock' | 'inventory-sales' | 'inventory-transit' | 'customer';

/** Dates stay Date objects while parsing and become ISO strings in API JSON. */
export interface TransitLine<DateValue = Date> {
  product: string;
  sku: string;
  poNumber: string;
  poDate: DateValue | null;
  poEtaDate: DateValue | null;
  supplierSoNumber: string;
  siplNumber: string;
  slabs: number;
  quantity: number;
  units: string;
  location: string;
  supplier: string;
  freightForwarder: string;
  shipDate: DateValue | null;
  portEtaDate: DateValue | null;
  etaDate: DateValue | null;
  containerNumber: string;
  vessel: string;
  customerReference: string;
  supplierPurchaseNote: string;
  status: string;
}

export interface TransitShipment<DateValue = Date> {
  poNumber: string;
  containerNumber: string;
  location: string;
  lines: TransitLine<DateValue>[];
}

export interface TransitShipmentResponse extends TransitShipment<string> {
  _id: string;
  importedAt: string;
  importedByName: string;
}

export interface TransitParseResult {
  headers: string[];
  mapping: Record<string, string | null>;
  missingRequired: string[];
  rows: TransitLine[];
  errors: string[];
}

export interface InventoryImportResult {
  success: boolean;
  count: number;
  shipmentCount?: number;
  importedAt: string;
}
