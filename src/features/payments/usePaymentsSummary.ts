import { useEffect, useState } from 'react';
import { paymentSummary } from './paymentsApi';
import type { PaymentSummary } from './types';

/**
 * A branch day's totals from the Payments page, for the Daily Report's
 * comparison line while the report still has its own typed grid. Null until
 * loaded, or when it can't be read (no access, offline) — the report then
 * shows nothing extra.
 */
export function usePaymentsSummary(location: string | null | undefined, date: string | null | undefined, refreshKey: unknown = null) {
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  useEffect(() => {
    let live = true;
    setSummary(null);
    if (!location || !date) return undefined;
    paymentSummary(location, date).then((s) => { if (live) setSummary(s); }).catch(() => {});
    return () => { live = false; };
  }, [location, date, refreshKey]);
  return summary;
}
