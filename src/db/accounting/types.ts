/**
 * What Accounting (3rd-party freight) asks of its database. One store per unit of work (a transaction, or none
 * for a plain read): `mongo.ts` answers with Mongoose, `postgres.ts` with SQL, both in MongoDB's record shape
 * (`_id`, `__v`, `createdBy: { id, name }`, a charge's `payment` and `flags` inside it, an invoice's `chargeIds`).
 *
 * Records are plain objects: the router changes them and hands them back to `save…`, which writes only if the
 * record is still at its `__v` (→ null if someone else saved first).
 */
import type { ClientSession } from 'mongoose';
import type { Loose } from '../../types/records.ts';

/** Which charges a list shows. `branches` is the person's own ('*' = all); `location` an optional single pick. */
export interface ChargeQuery {
  branches: string[];
  location: string;
  status: string;
  carrierId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface InvoiceQuery {
  branches: string[];
  status: string;
  carrierId?: string;
  page: number;
  limit: number;
}

export interface AccountingStore {
  /** The MongoDB session the unit of work runs in (null outside a transaction, and on Postgres). */
  session: ClientSession | null;

  // ── Carriers ──
  /** Every carrier, or just these ids; active first, then A–Z. */
  carriers(ids?: readonly unknown[] | null): Promise<Loose[]>;
  carrier(id: unknown): Promise<Loose | null>;
  /** Other carriers' names, keys and aliases (for the "already used" check). */
  carriersExcept(exceptId: unknown): Promise<Loose[]>;
  /** A name already used (nameKey unique) → error with code 11000. */
  createCarrier(doc: Loose): Promise<Loose>;
  saveCarrier(doc: Loose): Promise<Loose | null>;
  /** Draft charges waiting for a carrier that have a typed carrier name. */
  chargesWaitingForCarrier(): Promise<Loose[]>;

  // ── Charges ──
  charge(id: unknown): Promise<Loose | null>;
  chargesByIds(ids: readonly unknown[]): Promise<Loose[]>;
  chargeForDelivery(deliveryId: string): Promise<Loose | null>;
  /** Delivery ids of every charge made from a delivery that isn't void. */
  openDeliveryChargeIds(): Promise<string[]>;
  list(q: ChargeQuery, page: number, limit: number): Promise<{ total: number; items: Loose[]; summary: Record<string, { count: number; cents: number }>; flagged: number; missingPrice: number; toApprove: number }>;
  exportCharges(q: ChargeQuery, max: number): Promise<{ total: number; items: Loose[] }>;
  /** A delivery already has a charge → error with code 11000. */
  createCharge(doc: Loose): Promise<Loose>;
  saveCharge(doc: Loose): Promise<Loose | null>;

  // ── Invoices ──
  invoice(id: unknown): Promise<Loose | null>;
  listInvoices(q: InvoiceQuery): Promise<{ total: number; items: Loose[] }>;
  /** The same carrier + invoice number twice → error with code 11000. */
  createInvoice(doc: Loose): Promise<Loose>;
  saveInvoice(doc: Loose): Promise<Loose | null>;

  // ── Payments (append-only) ──
  paymentByRequestId(requestId: string): Promise<Loose | null>;
  paymentByPaymentId(paymentId: string): Promise<Loose | null>;
  createPayment(doc: Loose): Promise<Loose>;

  // ── History (append-only) ──
  addAudit(entries: Loose[]): Promise<void>;
  /** Newest first. */
  auditFor(entityType: string, entityId: string, limit: number): Promise<Loose[]>;
}
