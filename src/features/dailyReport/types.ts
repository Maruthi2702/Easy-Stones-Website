/**
 * The Daily Work Report as the screen holds it (see src/models/DailyReport.ts
 * and GET /api/daily-reports/:date in src/routes/dailyReports.ts).
 */

/**
 * One figure on the sheet: a number as the server sends it, the raw string
 * while someone is typing it, null when nobody has said it ("unsaid", never 0).
 */
export type Figure = number | string | null;

export type TransferLine = {
  fromTo: string;
  transferNumber?: string;
  slabs: Figure;
  count?: Figure;
  /** From the transfer tickets (deriveFromSystem), not typed. */
  auto?: boolean;
  direction?: string;
  ticketIds?: string[];
  [key: string]: unknown;
};

export type ContainerLine = {
  poNumber: string;
  material: string;
  slabs: Figure;
  [key: string]: unknown;
};

export type PaymentFigures = { count: Figure; amount: Figure };

export type Report = {
  date: string;
  location: string;
  status: string;
  visitors: { homeowners: Figure; fabricators: Figure; designers: Figure };
  deliveries: { assigned: Figure; capacity: Figure };
  pickups: { assigned: Figure; capacity: Figure };
  returns: Figure;
  returnsSlabs: Figure;
  sinks: Figure;
  transfers: TransferLine[];
  containers: ContainerLine[];
  payments: Record<string, PaymentFigures>;
  notes: string;
  autoSubmitted?: boolean;
  submittedBy?: string;
  [key: string]: unknown;
};

/** What a slab count usually looks like for the branch (slabExpectation). */
export type SlabRange = { low: number; high: number; fromHistory?: boolean };

/** Transfers drawn on this day that shipped in an earlier week (transfersShippedEarlier). */
export type ShippedEarlierGroup = { shipDate: string; count: number; slabs: number; reportStatus?: string };

/** The day sheet's computed totals (reportTotals). */
export type DayTotals = {
  visitors: number;
  assigned: number;
  capacity: number;
  transferCount: number;
  transferSlabs: number;
  transferCountIn: number;
  transferSlabsIn: number;
  containerSlabs: number;
  payCount: number;
  payAmount: number;
};

/** One row of the month view or the all-locations day (`summarise` on the server). */
export type SummaryRow = {
  date: string;
  location: string;
  status: string;
  visitors?: number;
  deliveries?: number;
  pickups?: number;
  transferCount?: number;
  transferSlabs?: number;
  transferCountIn?: number;
  transferSlabsIn?: number;
  containerCount?: number;
  containerSlabs?: number;
  payments?: number;
  submittedBy?: string;
  autoSubmitted?: boolean;
};

/** A summary table's foot row (sumRows). */
export type SummaryTotals = {
  visitors: number;
  deliveries: number;
  pickups: number;
  transferCount: number;
  transferSlabs: number;
  transferCountIn: number;
  transferSlabsIn: number;
  containerCount: number;
  containerSlabs: number;
  payments: number;
};

/** The parts of authFetch the month and all-locations views take as a prop. */
export type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
