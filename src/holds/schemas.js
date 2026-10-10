/**
 * What each Cart & Holds request may contain (zod). Anything else is turned
 * away with one readable sentence (see src/server/http.js).
 */
import { z } from 'zod';
import { priceCentsOf, MAX_CART_SLABS, MAX_HOLD_SLABS } from './holdRules.js';

const text = (max) => z.string().trim().max(max, `Keep it under ${max} characters.`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-16.');
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Not a valid id.');
const slabKey = z.string().trim().min(1, 'Missing slab.').max(60).transform((s) => s.toUpperCase());
const version = z.number().int().min(0);

/** A typed price per SF: "$12.50", 12.5, '' / null (no price yet) → cents per SF or null. */
const price = z.union([z.string(), z.number(), z.null()]).optional().transform((v, ctx) => {
  if (v === undefined) return undefined;
  const cents = priceCentsOf(v);
  if (cents === undefined) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter the price per SF like 12.50.' }); return z.NEVER; }
  if (cents !== null && cents <= 0) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A price has to be more than $0.' }); return z.NEVER; }
  return cents;
});

// ── Cart ─────────────────────────────────────────────────────────────────
export const cartAdd = z.object({
  slabKeys: z.array(slabKey).min(1, 'Pick at least one slab.').max(MAX_CART_SLABS)
}).strict();

export const cartScan = z.object({
  code: z.string().trim().min(1, 'Scan or type a barcode or serial #.').max(60)
}).strict();

export const cartCustomer = z.object({ customerId: objectId.nullable() }).strict();

export const cartNote = z.object({ note: text(300) }).strict();

// ── Holds ────────────────────────────────────────────────────────────────
const holdLine = z.object({
  slabKey,
  price,
  note: text(300).optional().default('')
}).strict();

export const holdCreate = z.object({
  requestId: z.string().trim().min(8).max(64),
  customerId: objectId,
  branch: text(60).min(1, 'Pick the branch.'),
  expiresOn: isoDate,
  job: text(200).optional().default(''),
  notes: text(2000).optional().default(''),
  chanceToClose: z.number().int().min(0).max(100).nullable().optional().default(null),
  lines: z.array(holdLine).min(1, 'Pick at least one slab.').max(MAX_HOLD_SLABS)
}).strict();

export const holdDetails = z.object({
  version,
  customerId: objectId.optional(),
  job: text(200).optional(),
  notes: text(2000).optional(),
  commissionNotes: text(500).optional(),
  chanceToClose: z.number().int().min(0).max(100).nullable().optional(),
  lineNotes: z.array(z.object({ slabKey, note: text(300) }).strict()).max(MAX_HOLD_SLABS).optional()
}).strict();

export const holdSlabs = z.object({
  version,
  add: z.array(holdLine).max(MAX_HOLD_SLABS).optional().default([]),
  remove: z.array(slabKey).max(MAX_HOLD_SLABS).optional().default([])
}).strict().refine((b) => b.add.length || b.remove.length, 'Add or remove at least one slab.');

export const holdSwap = z.object({ version, from: slabKey, to: slabKey }).strict()
  .refine((b) => b.from !== b.to, 'Pick a different slab to swap in.');

export const holdPrices = z.object({
  version,
  lines: z.array(z.object({ slabKey, price: price.refine((p) => p !== undefined, 'Missing price.') }).strict())
    .min(1, 'Nothing to price.').max(MAX_HOLD_SLABS)
}).strict();

export const holdExtend = z.object({ version, expiresOn: isoDate }).strict();

export const holdRelease = z.object({ version, reason: text(300).min(1, 'Say why the hold is being released.') }).strict();

export const holdList = z.object({
  scope: z.enum(['mine', 'branch', 'all']).optional(),
  status: z.enum(['active', 'expiring', 'expired', 'released', 'converted', 'all']).default('active'),
  branch: text(60).optional().default(''),
  search: text(80).optional().default(''),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n), 'Rows per page is 25, 50 or 100.').default(50)
});

export const slabLookup = z.object({
  slabKeys: z.array(slabKey).min(1).max(500)
}).strict();
