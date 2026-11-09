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
