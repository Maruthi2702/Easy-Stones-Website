import { z } from 'zod';
import { validDay, variantKey } from './planning.ts';
const text = z.string().trim().min(1).max(200);
const day = z.string().refine(validDay, 'Use a real date (YYYY-MM-DD)');
const optionalDay = z.union([day, z.literal('')]);
const nonnegative = z.number().finite().min(0).max(1e7);
const whole = nonnegative.int();
const positive = z.number().finite().positive().max(1e7);
export const scopeSchema = z
  .object({
    name: text,
    branches: z
      .array(text)
      .min(1)
      .max(20)
      .refine((list) => new Set(list).size === list.length, 'Do not repeat branches'),
    cohortId: text,
    observedThrough: day,
    salesCoverageDateConfirmed: z.boolean().optional().default(false),
    fullSalesCoverage: z.boolean(),
    stockSnapshotId: z.string(),
    stockCoverageConfirmed: z.boolean(),
    freeStockValidated: z.boolean(),
    policyConfirmed: z.boolean(),
    reviewDays: z.number().int().min(1).max(30),
    bufferDays: z.number().int().min(0).max(90),
    stockMaxHours: z.number().int().min(1).max(168),
    salesMaxDays: z.number().int().min(1).max(90),
    aliases: z.array(z.object({ salesProduct: text, stockProduct: text }).strict()).max(1000),
    policies: z
      .array(
        z
          .object({
            product: text,
            supplier: text,
            bundleSlabs: positive.int(),
            minimumSlabs: whole,
            sfPerSlab: positive,
            weightKg: positive,
            mixGroup: z.string().trim().max(200),
            active: z.boolean(),
          })
          .strict(),
      )
      .max(1000),
    container: z
      .object({
        payloadKg: nonnegative,
        tareKg: nonnegative,
        maxSlabs: whole.max(10000),
        layoutConfirmed: z.boolean(),
        mixingConfirmed: z.boolean(),
      })
      .strict(),
    version: whole.optional(),
  })
  .strict()
  .superRefine((scope, ctx) => {
    for (const field of ['policies', 'aliases']) {
      const keys = scope[field].map((row) => variantKey(row.product || row.salesProduct));
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({ code: 'custom', message: `Duplicate ${field} product` });
    }
    const aliases = scope.aliases.map((a) => variantKey(a.stockProduct));
    if (new Set(aliases).size !== aliases.length)
      ctx.addIssue({ code: 'custom', message: 'Two sales variants cannot share a stock alias' });
  });
export const inboundSchema = z
  .object({
    complete: z.literal(true),
    rows: z
      .array(
        z
          .object({
            po: text,
            line: text,
            product: text,
            branch: text,
            supplier: text,
            ordered: whole,
            received: whole,
            cancelled: whole,
            eta: optionalDay,
            confirmed: z.boolean(),
            shipment: z.string().trim().max(200),
            shipped: whole,
            shipmentReceived: whole,
            shipmentEta: optionalDay,
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();
export const draftSchema = z
  .object({
    fingerprint: text,
    lines: z
      .array(
        z
          .object({ key: z.string().min(1).max(500), branch: text, quantity: positive.int().max(100000) })
          .strict(),
      )
      .min(1)
      .max(100),
    note: z.string().trim().max(2000),
  })
  .strict();
export const actionSchema = z
  .object({
    version: whole,
    note: z.string().trim().min(1).max(2000),
    poLines: z.array(z.string().min(1).max(500)).max(1000).optional(),
  })
  .strict();
