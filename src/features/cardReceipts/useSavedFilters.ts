import { useEffect, useState } from 'react';
import { NO_FILTERS, type ReceiptFilters, type WaitFilter } from './cardReceiptsView';
import { parseSavedFilters, savedFiltersKey, savedOf } from './savedFilters';

const read = (key: string) => {
  if (!key) return parseSavedFilters(null);
  try { return parseSavedFilters(localStorage.getItem(key)); } catch { return parseSavedFilters(null); }
};
const fromSaved = (key: string) => {
  const s = read(key);
  return { filters: { ...NO_FILTERS, status: s.status, category: s.category, bank: s.bank, statement: s.statement } as ReceiptFilters, wait: s.wait };
};

/** The Expenses / Waiting for me filters, kept on this device per person until changed (savedFilters.ts). */
export function useSavedFilters(viewerId: string) {
  const key = savedFiltersKey(viewerId);
  const [filters, setFilters] = useState<ReceiptFilters>(() => fromSaved(key).filters);
  const [waitFilter, setWaitFilter] = useState<WaitFilter>(() => fromSaved(key).wait);
  // The viewer is known after the first load (or a different person signs in): read theirs, keeping what's typed in search.
  const [keyFor, setKeyFor] = useState(key);
  if (keyFor !== key) {
    const s = fromSaved(key);
    setKeyFor(key);
    setFilters((f) => ({ ...s.filters, search: f.search }));
    setWaitFilter(s.wait);
  }
  const { status, category, bank, statement } = filters;
  useEffect(() => {
    if (!key || keyFor !== key) return;
    try { localStorage.setItem(key, JSON.stringify(savedOf({ ...NO_FILTERS, status, category, bank, statement }, waitFilter))); } catch { /* private mode: not kept */ }
  }, [key, keyFor, status, category, bank, statement, waitFilter]);
  return { filters, setFilters, waitFilter, setWaitFilter };
}
