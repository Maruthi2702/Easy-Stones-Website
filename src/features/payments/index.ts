// Operations → Payments (src/features/payments/). The Sales shell lazy-loads
// PaymentsPage.tsx itself — `import('../payments/PaymentsPage')` in
// SalesTabViews — so the page keeps its own chunk; anything else outside this
// folder imports from here.
export type { PaymentsPageProps } from './PaymentsPage';
export { usePaymentsSummary } from './usePaymentsSummary';
export type { Payment, PaymentSummary } from './types';
