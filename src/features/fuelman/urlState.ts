import { useCallback, useEffect, useRef, useState } from 'react';
// Fuel Man keeps where you are in the address (fm_report, fm_view, fm_tab) so
// refresh, Back and a shared link land on the same screen. Other pages' params
// (tab=fuel_man…) are left alone.
export type MainView = 'reports' | 'totals';
export const REVIEW_TABS = ['drivers', 'missing', 'allocations', 'lines', 'history'] as const;
export type ReviewTab = typeof REVIEW_TABS[number];
export interface FuelLocation { report: string; view: MainView; tab: ReviewTab; unknownOnly: boolean }
const KEYS = ['fm_report', 'fm_view', 'fm_tab', 'fm_unknown'];
export function readFuelLocation(search: string): FuelLocation {
  const p = new URLSearchParams(search), tab = p.get('fm_tab');
  const report = /^[a-f\d]{24}$/i.test(p.get('fm_report') || '') ? p.get('fm_report')! : '';
  return { report, view: p.get('fm_view') === 'totals' ? 'totals' : 'reports',
    tab: REVIEW_TABS.includes(tab as ReviewTab) ? tab as ReviewTab : 'drivers', unknownOnly: p.get('fm_unknown') === '1' };
}
export function withFuelLocation(href: string, next: FuelLocation): string {
  const url = new URL(href);
  KEYS.forEach(k => url.searchParams.delete(k));
  if (next.report) url.searchParams.set('fm_report', next.report);
  if (next.view === 'totals') url.searchParams.set('fm_view', 'totals');
  if (next.report && next.tab !== 'drivers') url.searchParams.set('fm_tab', next.tab);
  if (next.report && next.tab === 'lines' && next.unknownOnly) url.searchParams.set('fm_unknown', '1');
  return url.pathname + url.search + url.hash;
}
export function useFuelLocation() {
  const [where, setWhere] = useState(() => readFuelLocation(window.location.search));
  const current = useRef(where);
  useEffect(() => {
    const sync = () => { current.current = readFuelLocation(window.location.search); setWhere(current.current); };
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      // Leaving the page (another side-nav page) must not carry our params along.
      const cleaned = withFuelLocation(window.location.href, { report: '', view: 'reports', tab: 'drivers', unknownOnly: false });
      window.history.replaceState(window.history.state, '', cleaned);
    };
  }, []);
  // A new screen (opening a report, switching view) is a history entry so Back
  // returns to the list; moving between tabs of one report only replaces it.
  const go = useCallback((patch: Partial<FuelLocation>, push = true) => {
    const next = { ...current.current, ...patch };
    if (patch.tab && patch.unknownOnly === undefined) next.unknownOnly = false;
    const href = withFuelLocation(window.location.href, next);
    if (push) window.history.pushState(window.history.state, '', href); else window.history.replaceState(window.history.state, '', href);
    current.current = next; setWhere(next);
  }, []);
  return { ...where, go };
}
