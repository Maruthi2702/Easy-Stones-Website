/**
 * What each Accounting request may contain (zod). The server parses every
 * body and query with these and rejects anything else with a readable
 * message; the screens use the same rules for their forms.
 */
import { z } from 'zod';
import { toCents } from './money.js';
import { PAYMENT_TERMS, PAYMENT_METHODS } from './freightRules.js';

const text = (max = 200) => z.string().trim().max(max, `Keep it under ${max} characters.`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-09.');
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Not a valid id.');
const version = z.number().int().min(0);

/** An amount typed as "$1,234.50" or 1234.5 → whole cents. Required and above $0. */
const amount = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const c = toCents(v);
  if (c === undefined) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter the amount like 1250.00.' }); return z.NEVER; }
  if (c === null || c <= 0) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The amount has to be more than $0.' }); return z.NEVER; }
  return c;
});
/** Same, but blank clears it (a draft can be saved without a price yet). */
const optionalAmount = z.union([z.string(), z.number(), z.null()]).transform((v, ctx) => {
  const c = toCents(v);
  if (c === undefined) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter the amount like 1250.00.' }); return z.NEVER; }
  if (c !== null && c <= 0) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The amount has to be more than $0.' }); return z.NEVER; }
  return c;
});

export const listQuery = z.object({
  // The screen's tabs: to_approve (waiting for approval, plus anything flagged
  // for review — one inbox, owner 2026-10-09), approved, paid, all. The rest
  // are for the tiles and links.
  status: z.enum(['to_approve', 'draft', 'approved', 'paid', 'void', 'all', 'flagged', 'missing_price']).default('to_approve'),
  location: text(80).optional().default(''),
  carrierId: objectId.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: text(80).optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n), 'Rows per page is 25, 50 or 100.').default(50)
});

export const manualCharge = z.object({
  location: text(80).min(1, 'Pick the branch.'),
  deliveryDate: isoDate,
  carrierId: objectId,
  amount,
  description: text(300).min(1, 'Say what the charge is for.'),
  soNumber: text(40).optional().default(''),
  customerName: text(120).optional().default(''),
  bolNumber: text(60).optional().default(''),
  notes: text(1000).optional().default('')
}).strict();

export const chargeEdit = z.object({
  version,
  amount: optionalAmount.optional(),
  carrierId: objectId.nullable().optional(),
  bolNumber: text(60).optional(),
  soNumber: text(40).optional(),
  customerName: text(120).optional(),
  deliveryDate: isoDate.optional(),
  description: text(300).optional(),
  notes: text(1000).optional()
}).strict();

const items = z.array(z.object({ id: objectId, version })).min(1, 'Pick at least one charge.').max(500);

export const bulkItems = z.object({ items }).strict();

const paymentFields = {
  paidOn: isoDate,
  method: z.enum(PAYMENT_METHODS),
  reference: text(80).optional().default(''),
  // The screen's own ID for this one Mark paid (a fresh one each time the
  // dialog opens): a repeat of the same request returns the first payment
  // instead of paying twice. Optional, so a client that doesn't send one
  // still works — it just doesn't get the replay.
  requestId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Not a valid request id.').optional()
};

export const bulkPay = z.object({ items, ...paymentFields }).strict();

export const voidBody = z.object({ version, reason: text(300).min(1, 'Say why it is being voided.') }).strict();
export const versionOnly = z.object({ version }).strict();

export const carrierCreate = z.object({
  name: text(120).min(1, 'Enter the carrier name.'),
  aliases: z.array(text(120).min(1)).max(20).optional().default([]),
  paymentTerms: z.enum(Object.values(PAYMENT_TERMS)).default(PAYMENT_TERMS.PER_DELIVERY),
  notes: text(1000).optional().default('')
}).strict();

export const carrierEdit = z.object({
  version,
  name: text(120).min(1, 'Enter the carrier name.').optional(),
  aliases: z.array(text(120).min(1)).max(20).optional(),
  paymentTerms: z.enum(Object.values(PAYMENT_TERMS)).optional(),
  notes: text(1000).optional()
}).strict();

export const invoiceCreate = z.object({
  carrierId: objectId,
  invoiceNumber: text(60).min(1, 'Enter the invoice number.'),
  invoiceDate: isoDate,
  total: amount,
  chargeIds: z.array(objectId).min(1, 'Pick at least one charge.').max(500),
  notes: text(1000).optional().default('')
}).strict();

export const invoiceEdit = z.object({
  version,
  invoiceNumber: text(60).min(1, 'Enter the invoice number.').optional(),
  invoiceDate: isoDate.optional(),
  total: amount.optional(),
  chargeIds: z.array(objectId).min(1, 'Pick at least one charge.').max(500).optional(),
  notes: text(1000).optional()
}).strict();

export const invoicePay = z.object({ version, ...paymentFields }).strict();

export const invoiceListQuery = z.object({
  status: z.enum(['draft', 'approved', 'paid', 'void', 'all']).default('all'),
  carrierId: objectId.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n), 'Rows per page is 25, 50 or 100.').default(50)
});

export const paymentIdParam = z.string().trim().toUpperCase().regex(/^PAY-\d{8}-[0-9A-HJKMNP-TV-Z]{8}$/, 'Not a payment id.');

/** The first problem, as one sentence for the screen. */
export const firstIssue = (error) => {
  const issue = error?.issues?.[0];
  if (!issue) return 'Check the form and try again.';
  if (issue.code === 'unrecognized_keys') return `Unexpected field: ${issue.keys.join(', ')}.`;
  return issue.message;
};
