/** What the Permits screen's reads ask for, the same for MongoDB and Postgres (reads.ts). */
import type { Loose } from '../../types/records.ts';

/**
 * The list's filters, already checked by the router (src/permits/router.ts `permitFilter`). `sources` is the
 * offices the source / county filters allow (an empty list matches nothing); no `from` / `to` means "has an issue date".
 */
export interface PermitSpec {
  sources?: string[];
  category?: string;
  from?: string;
  to?: string;
  city?: string;
  minValue?: number;
  /** Permit #, address, description, parcel, contact company / name / email (any case), or a contact's license (exact, upper case). */
  text?: string;
  /** A WA contractor: the permits naming this license, or a contractor printed by one of these exact business names (case aside). */
  license?: { license: string; names: string[] };
}

export const SORT_KEYS = ['issued_desc', 'issued_asc', 'value_desc', 'value_asc'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface PermitPageOptions {
  skip?: number;
  limit?: number | null;
  /** Also the number of permits the spec matches. */
  withTotal?: boolean;
  /** Also the permits per category with the spec's category filter left out (the tabs' counts). */
  withCategoryCounts?: boolean;
}
export interface PermitPage {
  items: Loose[];
  total: number;
  byCategory: { _id: string; n: number }[];
}

export interface PermitMeta {
  /** Per source id: its latest run, latest good run, and first good backfill. */
  runs: Record<string, { last: Loose | null; lastOk: Loose | null; first: Loose | null }>;
  checks: Loose[];
  /** Every city any permit has (blanks possible). */
  cities: string[];
  /** Each city with each source it appears under. */
  bySource: { city: string; source: string }[];
}

export interface ContractorPermitData {
  total: number;
  byCategory: { _id: string; n: number }[];
  recent: Loose[];
  /** The contractor's most used emails on those permits, lower case, most first (at most 5). */
  emailRows: { _id: string; n: number }[];
}
