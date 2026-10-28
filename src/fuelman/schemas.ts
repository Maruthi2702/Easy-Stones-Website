import { z } from 'zod';
import { validDay } from './parserRows.ts';
import { CATEGORIES, REASONS } from './types.ts';
const day = z.string().refine(validDay, 'Choose a valid date');
const text = z.string().trim().min(1).max(500);
const command = { version: z.number().int().min(0), token: z.string().length(64) };
export const assignmentSchema = z.object({ ...command, externalId: text,
  driverKey: z.string().max(100).default(''), profileName: z.string().trim().max(150).default(''), profileKind: z.enum(['driver', 'shared']).default('driver'),
  from: day, allocations: z.array(z.object({ location: text, percent: z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/, 'Use a percentage with up to two decimals') }).strict()).min(1).max(20),
  note: text,
}).strict();
export const dispositionSchema = z.object({ ...command, externalId: text, reason: z.enum(REASONS), note: text,
  effectiveDate: day.optional(), replacementId: z.string().trim().max(150).optional(),
}).strict();
export const classificationSchema = z.object({ ...command, rows: z.array(z.object({ index: z.number().int().min(0), category: z.enum(CATEGORIES).exclude(['other']), note: text }).strict()).min(1).max(500) }).strict();
export const publicationSchema = z.object({ ...command, note: text, acknowledgePriorDates: z.boolean().default(false), replaceReportId: z.string().regex(/^[a-f\d]{24}$/i).optional() }).strict();
export const reverseSchema = z.object({ version: command.version, note: text }).strict();
export const closeSchema = z.object({ closed: z.boolean(), note: text }).strict();
