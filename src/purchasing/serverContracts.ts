import type { ClientSession, Types } from 'mongoose';
import type { Request, Response, RequestHandler } from 'express';
import type { z } from 'zod';
import type { Scope, InboundRow, Receipt } from './types.ts';
import type { PlanningStock, PlanInputs } from './planInputs.ts';
import type { InventorySale } from '../models/InventorySalesRecord.ts';
import { handle as legacyHandle, parse as legacyParse } from '../server/http.js';
export interface PurchasingUser { assignedLocations?: string[]; permissions?: string[] }
export type ScopeRecord = Omit<Scope, '_id'> & { _id: Types.ObjectId };
export type StockSource = Omit<PlanningStock, 'importedAt'> & { importedAt?: Date };
export type SaleSource = InventorySale & { _id: Types.ObjectId };
export type ReservationSource = PlanInputs['reservations'][number];
export interface InboundSource { _id: Types.ObjectId; complete: boolean; branches?: string[]; createdAt: Date; rows: InboundRow[]; receipts: Receipt[] }
export interface RouterDependencies { authenticate: RequestHandler; now?: () => Date }
export type Session = ClientSession | null;
// The existing shared HTTP boundary preserves its error mapping while giving
// every purchasing handler and validated request a concrete TypeScript contract.
export const handle: (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler = legacyHandle;
export const parse: <T extends z.ZodTypeAny>(schema: T, data: unknown) => z.output<T> = legacyParse;
