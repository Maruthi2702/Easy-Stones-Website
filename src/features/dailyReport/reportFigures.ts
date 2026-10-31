import { transferCountOf } from '../../utils/transferDirection.ts';
import { withAllPaymentMethods, paymentCount, paymentAmount } from '../../utils/dailyReportPayments';
import type { DayTotals, Figure, Report, SlabRange } from './types';

/**
 * The day sheet's small rules: how a figure, a date and a route read, the
 * blank report, and the totals — computed and never typed.
 */

/** The branch selector's every-branch option — never a real branch name. */
export const ALL = 'all';

export const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

/** null is "unsaid" — it contributes nothing to a total rather than a zero. */
export const n = (v: unknown) => {
  if (v === null || v === undefined || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const said = (...values: unknown[]) => values.some(v => v !== null && v !== undefined && v !== '');

/** A total is only a dash when nothing underneath it has been said at all. */
export const total = (value: number, ...sources: unknown[]) => (said(...sources) ? value : '—');

/**
 * A transfer's route is stored as one opaque string ('SEA — SLC') — the
 * format the server already produces for auto rows and matches lines
 * against across saves (see lineKey in dailyReports.js) — so splitting it
 * into two dropdowns is purely a frontend input concern; nothing downstream
 * (the model, the PDF/CSV export, ticket matching) needs to know it's really
 * two branch codes. A free-typed legacy value that doesn't split cleanly
 * (a stray hyphen, no separator at all) just starts both dropdowns blank
 * until re-picked, rather than guessing at what was meant.
 */
export const splitFromTo = (fromTo: string) => {
  const [from, to] = String(fromTo || '').split('—').map(s => s.trim());
  return [from || '', to || ''];
};

export const composeFromTo = (from: string, to: string) => (from || to) ? `${from} — ${to}` : '';

export const emptyReport = (date: string, location: string): Report => ({
  date,
  location,
  status: 'draft',
  visitors: { homeowners: 0, fabricators: null, designers: null },
  deliveries: { assigned: 0, capacity: null },
  pickups: { assigned: 0, capacity: null },
  returns: null,
  returnsSlabs: null,
  sinks: null,
  transfers: [],
  containers: [],
  payments: withAllPaymentMethods({}),
  notes: ''
});

export const reportTotals = (report: Report | null): DayTotals | null => {
  if (!report) return null;
  const v = report.visitors;
  return {
    visitors: n(v.homeowners) + n(v.fabricators) + n(v.designers),
    assigned: n(report.deliveries.assigned) + n(report.pickups.assigned),
    capacity: n(report.deliveries.capacity) + n(report.pickups.capacity),
    // Outbound only — matches what these figures have always meant, so the
    // day-glance tile's number doesn't quietly start including material
    // coming the other way. Incoming has its own subtotal in the section
    // below instead of being folded into this one.
    // How many transfers, for the tiles: a ticket line's tickets, a typed
    // line's transfer numbers (transferCountOf). Nobody types a count.
    transferCount: report.transfers.filter(t => t.direction !== 'in').reduce((s, t) => s + transferCountOf(t), 0),
    transferSlabs: report.transfers.filter(t => t.direction !== 'in').reduce((s, t) => s + n(t.slabs), 0),
    transferCountIn: report.transfers.filter(t => t.direction === 'in').reduce((s, t) => s + transferCountOf(t), 0),
    transferSlabsIn: report.transfers.filter(t => t.direction === 'in').reduce((s, t) => s + n(t.slabs), 0),
    containerSlabs: report.containers.reduce((s, c) => s + n(c.slabs), 0),
    payCount: paymentCount(report.payments),
    payAmount: paymentAmount(report.payments)
  };
};

/**
 * A slab count far outside what this branch usually sees. A question, never a
 * block — a genuine 520-slab container should still save.
 */
export const outOfBand = (slabRange: SlabRange | null, value: Figure | undefined) => {
  if (!slabRange || value === null || value === undefined || value === '') return false;
  const x = Number(value);
  return Number.isFinite(x) && x > 0 && (x < slabRange.low || x > slabRange.high);
};
