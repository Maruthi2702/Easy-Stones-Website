/** A payment as /api/payments-received sends it (src/routes/paymentsReceived.ts's `view`). */
export type Payment = {
  id: string;
  location: string;
  date: string;
  customerId: string;
  customerName: string;
  method: string;
  cents: number;
  invoice: string;
  reference: string;
  note: string;
  enteredBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  voided: { at: string; by: string; reason: string } | null;
  history: { at: string; by: string; action: 'added' | 'edited' | 'voided'; changes: string }[];
};

/** The day's Daily Report status: a submitted day is locked here. */
export type PaymentDay = { submitted: boolean; submittedBy: string; submittedAt: string | null; autoSubmitted: boolean };

/** The day's totals as the Daily Report grid holds them. */
export type PaymentSummary = {
  count: number; net: number; taken: number; returned: number;
  grid: Record<string, { count: number; amount: number }>;
};

/** The signed-in staff member, as much as this page reads. */
export type PaymentsUser = {
  permissions?: string[];
  location?: string;
  assignedLocations?: string[];
  [key: string]: unknown;
};
