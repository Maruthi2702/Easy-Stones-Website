import type { Loose } from '../../types/records.ts';

export interface CustomerPageQuery {
  page: number;
  limit: number;
  search: string;
}

export interface CustomerPage {
  customers: Loose[];
  total: number;
}

/** Filters already permission-checked by the list route; pagination/export semantics stay unchanged. */
export interface CustomerListQuery extends CustomerPageQuery {
  mayProfile: boolean;
  userId?: string;
  today: string;
  sortBy: string;
  sortOrder: 1 | -1;
  level?: string;
  type?: string;
  typeExclude?: string;
  city?: string;
  status?: string;
  salesRep?: string;
  location?: string;
  view?: string;
  letter?: string;
  moda?: string;
}

export interface CustomerList {
  partners: Loose[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

/** Saved-view badges depend only on the tab, signed-in owner and Pacific day. */
export interface CustomerViewCountsQuery {
  tab?: string;
  userId?: string;
  today: string;
}

export type CustomerViewCounts = Record<string, number>;
