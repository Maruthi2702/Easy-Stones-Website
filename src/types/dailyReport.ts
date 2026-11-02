import type { Document, Model } from 'mongoose';
import type DailyReport from '../models/DailyReport.ts';

/**
 * The Daily Work Report's records (src/models/DailyReport.ts). `Stored…` is a
 * line as the server keeps it; `…Like` is what a rule reads off a line that
 * may be half-typed (the sheet holds figures as the raw string while someone
 * types, and a new line has only what's filled in).
 *
 * `DailyReportFieldsMatchModel` fails the typecheck when a stored line names
 * a field the model doesn't have, or the model gains one a line doesn't list —
 * the schema silently drops what it doesn't declare (see ticketIds in the
 * model), so a field missing here is a field lost on save.
 */

export type TransferDirection = 'out' | 'in';

export type StoredTransferLine = {
  fromTo: string;
  transferNumber: string;
  count: number;
  slabs: number;
  auto: boolean;
  direction: TransferDirection;
  received: boolean;
  receivedAt: string | Date | null;
  receivedBy: string;
  ticketIds: string[];
};

export type StoredContainerLine = { poNumber: string; material: string; slabs: number };

/** What the transfer rules read: any line, stored or being typed. */
export type TransferLineLike = {
  fromTo?: string;
  transferNumber?: string;
  count?: unknown;
  slabs?: unknown;
  auto?: boolean;
  direction?: string;
  received?: boolean;
  ticketIds?: string[];
};

/** What the container rules read: any line, stored or being typed. */
export type ContainerLineLike = { poNumber?: string; material?: string; slabs?: unknown };

export type PaymentKey = 'ach' | 'cash' | 'card' | 'check';
/** What the payment rules read: any method may be missing (older reports have no `ach`). */
export type PaymentsLike = Partial<Record<PaymentKey, { count?: number | string | null; amount?: number | string | null } | null>>;

type ReportOf = typeof DailyReport extends Model<infer T> ? T : never;
type SubdocumentMembers = '$isSingleNested' | 'ownerDocument' | 'parent';
// A subdocument also carries Mongoose's own members (save, $set…); only the schema's fields count.
type StoredLineFields = Exclude<keyof ReportOf['transfers'][number], keyof Document | SubdocumentMembers>;
type StoredContainerFields = Exclude<keyof ReportOf['containers'][number], keyof Document | SubdocumentMembers>;

type Drift<Mine, Theirs> =
  [Exclude<Mine, Theirs>] extends [never]
    ? [Exclude<Theirs, Mine>] extends [never] ? true : { missingHere: Exclude<Theirs, Mine> }
    : { notInModel: Exclude<Mine, Theirs> };

/** Resolves to `true` only while the stored lines and the model's agree. */
export type DailyReportFieldsMatchModel = [
  Drift<keyof StoredTransferLine, StoredLineFields>,
  Drift<keyof StoredContainerLine, StoredContainerFields>,
  Drift<PaymentKey, keyof NonNullable<ReportOf['payments']>>
];
export const dailyReportFieldsMatchModel: DailyReportFieldsMatchModel = [true, true, true];
