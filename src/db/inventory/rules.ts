/** What both databases' stock reads share: the filter the Inventory screens send, and how a location list is read. */

export interface StockFilter {
  search?: unknown;
  category?: unknown;
  location?: unknown;
  status?: unknown;
  product?: unknown;
}

/** ?location= on the inventory routes: one branch, or several comma-separated. Empty = every branch. */
export const locationList = (location: unknown): string[] =>
  String(location || '').split(',').map(s => s.trim()).filter(Boolean);

/** The aging buckets' lower bounds in days (the last one is open-ended). A received date in the future is 'unknown'. */
export const AGING_BOUNDS = [0, 30, 60, 90, 180, 365] as const;
