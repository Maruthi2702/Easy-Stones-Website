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

/** Chosen by the route's existing Full profile and Visits permission rules. */
export interface CustomerHistoryScope {
  mayProfile: boolean;
  people: '*' | ReadonlySet<string>;
}

export type CustomerHistoryKind = 'visits' | 'resources';

/** Calendar visibility is resolved by the route (including team and People filters). */
export interface CalendarReadQuery {
  people: '*' | ReadonlySet<string>;
  start?: string;
  end?: string;
  /** Private ICS feed: omit cancelled entries and use the original lean response shape. */
  feed?: boolean;
}

/** Dashboard permission and People/location decisions stay in the route. Dates are inclusive calendar days. */
export interface DashboardReadQuery {
  people: CustomerHistoryScope['people'];
  startDate: Date | null;
  endDate: Date | null;
  filterType?: string;
}
export interface DashboardRollupQuery extends DashboardReadQuery {
  today: string;
  userId?: string;
}
export interface DashboardRollups {
  visits: number;
  keyVisits: number;
  bids: number;
  resources: number;
  leads: number;
  todayScheduleCount: number;
}
