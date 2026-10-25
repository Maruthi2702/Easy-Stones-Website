// How the side panels word a carrier's terms and a moment in time.
import { PAYMENT_TERMS } from '../../../accounting/freightRules';
import type { Carrier } from '../types';

/** "paid per invoice" / "paid per delivery". */
export const termsText = (carrier: Carrier | null | undefined) => (carrier?.paymentTerms === PAYMENT_TERMS.PER_INVOICE ? 'paid per invoice' : 'paid per delivery');
/** "Oct 9, 2026, 2:05 PM", or '' when there's no time. */
export const dateTime = (at: string | number | Date | null | undefined) => (at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
