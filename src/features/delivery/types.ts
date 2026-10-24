import type { DeliveryRecord, TruckColumn, Loose } from '../../types/records';

/** A ticket as the screens hold it: the typed fields, the rest read loosely. */
export type Ticket = DeliveryRecord & Loose;

/** A board column: a driver, a 3rd-party truck, or Will Call (src/utils/deliveryColumns.js). */
export type BoardColumn = TruckColumn & { isWillCall?: boolean };

/** Which screen someone gets (deliveryViewMode in src/utils/deliveryAccess.js). */
export type ScheduleRole = 'driver' | 'office' | 'sales';

/** Where a dragged ticket goes: its column's driver, its type, its day. */
export type Assignment = { truckId: string; deliveryType?: string; customerDropOff?: boolean; date: string };

/** One stop in a cell's running order, as the reorder route takes it. */
export type StopOrder = { id: string; routeNumber: number };
