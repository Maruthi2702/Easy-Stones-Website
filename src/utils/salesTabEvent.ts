/**
 * Asks the Sales page, already open, to show a page (a tapped push's `?tab=` when the app was in use): the URL
 * alone is only read when the page first loads. Does nothing if Sales isn't mounted (then its own load reads the URL).
 */
export const OPEN_SALES_TAB_EVENT = 'es:open-sales-tab';

export const requestSalesTab = (tab: string) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_SALES_TAB_EVENT, { detail: { tab } }));
};

/** The `tab` of an in-app path like '/sales?tab=card_receipts', or ''. */
export const salesTabOf = (path: string) => {
  try {
    const u = new URL(path, 'https://app.local');
    return u.pathname === '/sales' ? u.searchParams.get('tab') || '' : '';
  } catch {
    return '';
  }
};
