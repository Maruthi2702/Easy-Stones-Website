import { validateScalarRequest, scalarQuery, scalarParams } from '../server/scalarRequest.ts';
import type { Loose } from '../types/records.ts';
import type { ContainerLineLike, PaymentsLike, StoredContainerLine, StoredTransferLine, TransferLineLike } from '../types/dailyReport.ts';

/** A transfer line as the sheet sends it on a save: whatever was typed, checked below. */
type SentTransferLine = TransferLineLike & { received?: unknown; receivedAt?: string | number | Date | null; receivedBy?: unknown };
import type { Request, RequestHandler, Response, NextFunction } from 'express';
import express from 'express';
import DailyReport from '../models/DailyReport.ts';
import * as reports from '../db/dailyReports/index.ts';
import { buildDayPdf, buildMonthPdf, dayPdfFileName, monthPdfFileName } from '../utils/dailyReportPdf.ts';
import { sendEmail } from '../services/emailService.ts';
import { SENDER_NAME } from '../utils/emailSender.ts';
import { findDeliveries } from '../db/deliveries/index.ts';
import { BRANCH_NAMES, branchCode, isBranch, branchDayWindow } from '../config/branches.ts';
import { countCheckIns } from '../db/checkins/index.ts';
import Location from '../models/Location.ts';
import { notifyDailyReportSubmission } from '../utils/dailyReportSubmissionEmail.ts';
import { logEntry, reportLog, entriesFromFields } from '../utils/dailyReportLog.ts';
import type { LogEntry } from '../utils/dailyReportLog.ts';
import { groupContainers, groupSlabs } from '../utils/dailyReportContainers.ts';
import { PAYMENT_METHODS, paymentAmount, paymentsSaid, paymentsFromPage } from '../utils/dailyReportPayments.ts';
import { paymentFigures } from '../db/payments/index.ts';
import { reportGridFrom } from '../utils/paymentsReceived.ts';
import { ticketSlabs, arrivalsShippedEarlier } from '../utils/dailyReportTransfers.ts';
import { manualTransferDirection, transferCountOf, transferLineKey, mergeTypedTransferSlabs, upgradeHandSetKeys, cleanTransferNumber } from '../utils/transferDirection.ts';

/**
 * Daily Work Report API.
 *
 * Kept out of server.ts deliberately — this is a self-contained feature and
 * server.ts is already six thousand lines. The middleware it needs (auth,
 * permission checks, the activity logger) lives there, so it is handed in
 * rather than imported, which also keeps this module testable on its own.
 *
 *   import createDailyReportsRouter from './src/routes/dailyReports.ts';
 *   app.use('/api/daily-reports', createDailyReportsRouter({ authenticate, requirePermission }));
 */

// The branches and their clocks live in one place — the auto-submit job needs
// the same list, and two copies of it would eventually disagree.

const isValidDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const isValidMonth = (value: unknown) => /^\d{4}-\d{2}$/.test(String(value || ''));

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * A figure nobody has entered stays null rather than becoming 0 — "no payments
 * recorded" and "no money taken" are different statements and the report keeps
 * them apart. Only an empty string, null or undefined means unsaid; a typed 0
 * is a real answer.
 */
const numOrNull = (value: unknown) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const moneyOrNull = (value: unknown) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};



/** The branches this user may see. '*' means every branch. */
const allowedLocations = (req: Request) => {
  const assigned = req.user?.assignedLocations || [];
  return assigned.includes('*') ? '*' : assigned;
};

const canSeeLocation = (req: Request, location: string) => {
  // '*' means every branch we have — not every string. Without this an
  // administrator asking for "Nowhere" got a 200 and an empty sheet.
  if (!isBranch(location)) return false;
  const allowed = allowedLocations(req);
  return allowed === '*' || allowed.includes(location);
};

/**
 * The half of the report the system already knows.
 *
 * Visitors come from the check-in log, which records an instant — so the day is
 * bounded in the branch's own clock on that date (branchDayWindow), never the
 * server's or the viewer's.
 *
 * Exported for src/jobs/autoSubmitDailyReports.ts, which has to run this same
 * derive with nobody's browser open to trigger it from a page load — see the
 * comment on applyDerived below for why the two are always called as a pair
 * before a day is ever locked in.
 */
/**
 * Transfers counted as incoming on `location`'s report for `date`. Inbound
 * transfers key off a different date (when they're due here, not when they
 * left origin) and the opposite location field — a ticket some other branch
 * owns, addressed to this one.
 *
 * Only once the sending branch has put it on a truck: a transfer with no
 * driver is still sitting in that branch's Pending Deliveries, and its own
 * report doesn't count it as shipped (the outbound query's truckId check), so
 * counting it here had the receiving branch expecting material nobody had
 * sent yet.
 */
export const incomingTransferQuery = (date: string, location: string) => ({
  deliveryType: 'transfer',
  expectedArrivalDate: date,
  transferDestination: location,
  status: { $ne: 'cancelled' },
  truckId: { $nin: ['', null] }
} as const);

/**
 * The day's tickets across every branch — one query, shared when a caller
 * derives several branches at once (the All-locations overview used to run
 * this identical query once per branch).
 *
 * A delivery's date is a plain calendar string, so this needs no timezone
 * maths — it is already the branch's day.
 *
 * A will call never carries a truckId — the customer collects it, so it rides
 * on no truck — which is why the board's own week query carves out the same
 * exception. Without it every pick-up ticket fails the truckId check and the
 * report's Pick-ups count and slabs sit at 0 regardless of how many pickups
 * actually happened that day.
 *
 * A customer drop-off (a return with no driver) needs the same carve-out, for
 * exactly the same reason. A return a driver goes out for already passes the
 * truckId check.
 *
 * A cancelled ticket keeps its truckId as a record of what to restore it to
 * (see isCancelledDelivery), so the truckId check alone lets it through and
 * the day counts material that never moved. The board draws no card for one,
 * and neither does this report.
 */
export const deliveriesOnDate = (date: string) => findDeliveries({
  filter: {
    date,
    status: { $ne: 'cancelled' },
    $or: [
      { truckId: { $nin: ['', null] } },
      { deliveryType: 'will_call' },
      { deliveryType: 'return' }
    ]
  },
  projection: { id: 1, deliveryType: 1, transferDestination: 1, location: 1, numberOfSlabs: 1, soNumber: 1, invoiceNumber: 1 }
});

/**
 * Stored reports as they should be read for display or export. A draft is
 * stored with its untouched figures blank (buildDraftPayload) and Homeowners
 * and the Counts as of its last save, so reading it as stored under-reported:
 * a draft PDF or email, the month view and the CSV showed no auto slabs or
 * transfers and the morning's check-ins. Drafts are re-derived the same way
 * GET /:date does for the sheet; submitted days are left exactly as signed
 * off. One delivery query per date, shared across that date's branches.
 * Works on lean (plain) documents.
 */
export async function withDraftsDerived<T extends Loose>(docs: T[] = []): Promise<T[]> {
  const byDate = new Map();
  return Promise.all(docs.map(async (doc) => {
    if (doc.status !== 'draft') return doc;
    if (!byDate.has(doc.date)) byDate.set(doc.date, deliveriesOnDate(doc.date));
    const report = {
      ...doc,
      visitors: { ...(doc.visitors || {}) },
      deliveries: { assigned: 0, capacity: null, ...(doc.deliveries || {}) },
      pickups: { assigned: 0, capacity: null, ...(doc.pickups || {}) },
      transfers: [...(doc.transfers || [])]
    };
    return applyDerived(report, await deriveFromSystem(doc.date, doc.location, { deliveryRows: byDate.get(doc.date) }));
  }));
}

/**
 * `deliveryRows`: deliveriesOnDate(date) already fetched (or in flight) by a
 * caller deriving several branches for the same date.
 */
/** A ticket's transfer number, as the board shows it ('Transfer# 18936'). */
const ticketTransferNumber = (ticket: { soNumber?: string; invoiceNumber?: string }) => String(ticket.soNumber || ticket.invoiceNumber || '').trim();

/** Lines in a steady order: by route, then transfer number. */
const byRouteThenNumber = (a: { fromTo: string; transferNumber: string }, b: { fromTo: string; transferNumber: string }) =>
  a.fromTo.localeCompare(b.fromTo) || a.transferNumber.localeCompare(b.transferNumber, 'en', { numeric: true });

type TransferTicketRow = {
  id?: string; location?: string | null; transferDestination?: string | null; numberOfSlabs?: number | null;
  soNumber?: string; invoiceNumber?: string; receivedAt?: Date | string | null; receivedBy?: string | null;
};

/**
 * A transfer ticket's line on `location`'s report: outgoing on the sender's
 * ship day, incoming on the receiver's arrival day. One line per ticket.
 */
export function transferLineFor(d: TransferTicketRow, location: string, direction: 'out' | 'in') {
  if (direction === 'out') {
    return {
      fromTo: `${branchCode(location)} — ${branchCode(d.transferDestination || 'Unspecified')}`,
      transferNumber: ticketTransferNumber(d),
      count: 1,
      slabs: ticketSlabs(d),
      auto: true,
      direction: 'out' as const,
      ticketIds: [d.id].filter(Boolean) as string[]
    };
  }
  return {
    fromTo: `${branchCode(d.location || 'Unspecified')} — ${branchCode(location)}`,
    transferNumber: ticketTransferNumber(d),
    count: 1,
    slabs: ticketSlabs(d),
    auto: true,
    direction: 'in' as const,
    received: Boolean(d.receivedAt),
    receivedAt: d.receivedAt || null,
    receivedBy: d.receivedBy || '',
    // Which ticket this line is, so "mark received" on the report has
    // something to PATCH, and so its typed slabs stay its own without a
    // transfer number (transferLineKey).
    ticketIds: [d.id].filter(Boolean) as string[]
  };
}

/**
 * A transfer logged on arrival (POST /api/deliveries/arrivals) belongs on
 * the sender's report for its ship day and the receiver's for its arrival
 * day even when those are already submitted (owner's call, 2026-11-03).
 * A submitted report is otherwise never re-derived, so its line is added
 * here, once: a report that already has a line for this ticket is left
 * alone. Drafts need nothing — they derive the ticket on their next load.
 * Returns the submitted reports it changed.
 */
export async function addTransferToSubmittedReports(ticket: TransferTicketRow & { date?: string; expectedArrivalDate?: string }, at = new Date(), by = '') {
  if (!ticket.id) return [];
  const sides = [
    { location: ticket.location, date: ticket.date, direction: 'out' as const },
    { location: ticket.transferDestination, date: ticket.expectedArrivalDate, direction: 'in' as const }
  ].filter((s): s is { location: string; date: string; direction: 'out' | 'in' } => Boolean(s.location && s.date));
  const changed: { location: string; date: string }[] = [];
  for (const side of sides) {
    const line = { ...transferLineFor(ticket, side.location, side.direction), addedAfterSubmitAt: at };
    const what = `${side.direction === 'in' ? 'Incoming' : 'Outgoing'} transfer${line.transferNumber ? ` #${line.transferNumber}` : ''} ${line.fromTo}`.replace(/\s+/g, ' ').trim();
    const added = await reports.addTransferIfSubmitted(side.date, side.location, ticket.id, line,
      logEntry('transfer_added', by, `${what}, logged on arrival`, at));
    if (added) changed.push({ location: side.location, date: side.date });
  }
  return changed;
}

type DeliveryRows = Awaited<ReturnType<typeof deliveriesOnDate>>;
/** What the schedule and check-ins add up to for one branch and day (deriveFromSystem). */
export type DerivedFigures = Awaited<ReturnType<typeof deriveFromSystem>>;

export async function deriveFromSystem(date: string, location: string, { deliveryRows }: { deliveryRows?: DeliveryRows | Promise<DeliveryRows> } = {}) {
  // Check-ins are counted in the branch's own calendar day — its midnight to
  // midnight on that date's offset — wherever the person looking is and
  // whenever it's worked out. It used to be the viewer's browser offset on a
  // page load and the branch's *current* offset at Submit, so Homeowners on
  // screen and as signed off could differ (a Seattle manager opening Dallas;
  // a summer day submitted after the clocks changed).
  const { start: dayStart, end: dayEnd } = branchDayWindow(location, date);

  const [checkIns, allDeliveryRows, incomingRows, paymentRows] = await Promise.all([
    countCheckIns({
      location,
      createdAt: { $gte: dayStart, $lt: dayEnd }
    }),
    deliveryRows || deliveriesOnDate(date),
    findDeliveries({
      filter: incomingTransferQuery(date, location),
      projection: { id: 1, location: 1, numberOfSlabs: 1, receivedAt: 1, receivedBy: 1, soNumber: 1, invoiceNumber: 1 }
    }),
    // From PAYMENTS_FROM_PAGE_SINCE the day's payments are the Payments
    // page's entries (voided ones never count); before it, what was typed.
    paymentsFromPage(date) ? paymentFigures(location, date, true) : null
  ]);

  // Only tickets filed under this branch. A ticket with no branch (or '*')
  // used to count on *every* branch's report — a leftover from when most
  // records had none — so one such ticket appeared on all 13 sheets and the
  // All-locations total counted it 13 times (the #18299 transfer did exactly
  // that). Now it counts nowhere and is reported as noBranchTickets, so the
  // sheet can say so and someone can set its branch on the board.
  const mine = allDeliveryRows.filter((d) => d.location === location);
  const noBranchTickets = allDeliveryRows.filter((d) => !d.location || d.location === '*').length;
  // A ticket nobody has counted yet contributes nothing rather than blocking
  // the rest of the day's total.
  const slabsOf = (d: { numberOfSlabs?: number | null }) => (Number.isFinite(d.numberOfSlabs) ? d.numberOfSlabs as number : 0);

  const jobsiteRows = mine.filter((d) => !d.deliveryType || d.deliveryType === 'jobsite');
  const willCallRows = mine.filter((d) => d.deliveryType === 'will_call');
  // Returns are material coming back in, so they are deliberately not folded
  // into the Deliveries or Pick-ups totals — those two are what went out, and
  // a day that shipped nothing but took four slabs back should not read as a
  // day that shipped four. Both kinds count here: whether a driver collected
  // it or the customer walked it in, the same material arrived.
  const returnRows = mine.filter((d) => d.deliveryType === 'return');

  // One line per transfer (2026-10-15), each with its own transfer number, so
  // the same transfer added again by hand stands out. It used to be one line
  // per counterpart branch with a count; the count is now the number of lines.
  const outbound = mine.filter((d) => d.deliveryType === 'transfer')
    .map((d) => transferLineFor(d, location, 'out')).sort(byRouteThenNumber);
  const inbound = incomingRows.map((d) => transferLineFor(d, location, 'in')).sort(byRouteThenNumber);

  return {
    visitorCheckIns: checkIns,
    deliveriesAssigned: jobsiteRows.length,
    pickupsAssigned: willCallRows.length,
    deliveriesSlabs: jobsiteRows.reduce((sum, d) => sum + slabsOf(d), 0),
    pickupsSlabs: willCallRows.reduce((sum, d) => sum + slabsOf(d), 0),
    returnsCount: returnRows.length,
    returnsSlabs: returnRows.reduce((sum, d) => sum + slabsOf(d), 0),
    transfers: [...outbound, ...inbound],
    payments: paymentRows
      ? { fromPage: true as const, count: paymentRows.length, grid: reportGridFrom(paymentRows.map(p => ({ method: p.method, cents: p.cents }))) }
      : { fromPage: false as const, count: 0, grid: null },
    // The day's tickets (every branch) with no branch set — counted on no
    // report until someone sets one.
    noBranchTickets
  };
}

/**
 * This branch's transfers the delivery board shows on `date` although they
 * shipped in an earlier week, with whether each ship day's own report — the
 * one that counts them — has been filed. Only the single-day view asks for
 * this, so the month export and auto-submit don't pay for the extra queries.
 */
async function transfersShippedEarlier(date: string, location: string) {
  const rows = await findDeliveries({
    filter: {
      deliveryType: 'transfer',
      expectedArrivalDate: date,
      date: { $lt: date },
      status: { $ne: 'cancelled' },
      truckId: { $nin: ['', null] }
    },
    projection: { date: 1, expectedArrivalDate: 1, location: 1, numberOfSlabs: 1 }
  });
  // Filed under this branch only — same rule as deriveFromSystem.
  const mine = rows.filter(d => d.location === location);
  const groups = arrivalsShippedEarlier(mine, date);
  if (!groups.length) return [];

  const filed = await reports.reportStatuses(location, groups.map(g => g.shipDate));
  const statusOf = new Map(filed.map(r => [r.date, r.status]));
  return groups.map(g => ({ ...g, reportStatus: statusOf.get(g.shipDate) || 'missing' }));
}

/**
 * Merge the derived figures into a stored report.
 *
 * A submitted report is never re-derived: its numbers are the record of what
 * was true when it was signed off, and a delivery edited next week must not
 * rewrite last Tuesday.
 *
 * Exported for dailyReports.test.js — this is the contract a save payload
 * must respect (null-only fill, existing transfer lines keep their stored
 * slabs). The 2026-08-28 incident happened one layer up, in how the frontend
 * built what it sent here, but this function is what that payload has to be
 * correct against, so it gets the same regression coverage.
 */
/**
 * Sign a day off: write the derived report as submitted, but only if it is
 * still a draft at the moment of the write. Shared by POST /:date/submit and
 * the 11:59 auto-submit so the two can't both lock the same day — before,
 * manual submit checked for 'draft' and saved later, so a submit landing in
 * the same moment as the job (or a second click, or a second tab) signed the
 * day off twice and sent the Seattle email twice.
 *
 * `report` is the loaded document, already re-derived and with the submit
 * fields set; `log` is what the submit adds to the report's log — its own
 * line, after any older submit / reopen the fields held (submitLogFor, read
 * before those fields were overwritten). Pushed, never set, so it can't drop
 * a line another write added meanwhile. Resolves the stored document if this
 * call won, or null if the day had already been submitted by someone else —
 * only a winner should send the email.
 */
export async function claimSubmission(report: Loose, log: LogEntry[]) {
  return reports.claimSubmission(report, log);
}

/**
 * The log lines a submit adds: the older submit / reopen the report's fields
 * still hold and the log doesn't (a day from before the log), then its own.
 * Call before setting the submit fields, which overwrite the older ones.
 */
export const submitLogFor = (report: Loose, entry: LogEntry): LogEntry[] => [...entriesFromFields(report), entry];

/**
 * A draft save: write the day only if it isn't submitted. PUT /:date checks
 * the status first, but a submit (manual or the 11:59 job) can land between
 * that check and this write — which used to $set status 'draft'
 * unconditionally and quietly un-submit a signed-off day. With the status in
 * the filter, a day submitted in between doesn't match; the upsert then tries
 * to insert a second report for the same date and branch, which the unique
 * { date, location } index refuses (E11000). Resolves the saved document, or
 * null when the day was submitted.
 */
export async function writeDraft(date: string, location: string, update: Loose) {
  return reports.writeDraft(date, location, update);
}

/**
 * Which slab figures on a stored report a person set, as opposed to ones the
 * schedule fills in on every load. Read before applyDerived, while the record
 * is still as saved: a draft save blanks an untouched Deliveries / Pick-ups
 * slab figure and drops an untouched auto transfer line (buildDraftPayload),
 * so anything still there was typed (or signed off).
 *
 * The sheet seeds its "touched" sets from this on every load. Without it a
 * correction typed earlier looked untouched after a reload, so the next save —
 * including the one before Submit — blanked it and /submit locked the
 * schedule's figure instead.
 */
export function handSetFigures(report: { deliveries?: { capacity?: unknown } | null; pickups?: { capacity?: unknown } | null; transfers?: TransferLineLike[] | null } | null | undefined) {
  const set = (v: unknown) => v !== null && v !== undefined;
  return {
    capacity: (['deliveries', 'pickups'] as const).filter((k) => set(report?.[k]?.capacity)),
    transferSlabs: (report?.transfers || [])
      .filter((t) => t.auto && set(t.slabs))
      .map(transferLineKey)
  };
}

type DerivedReport = {
  status?: string;
  visitors?: { homeowners?: number | string | null; fabricators?: number | string | null; designers?: number | string | null } | null;
  deliveries: { assigned?: number | string | null; capacity?: number | string | null };
  pickups: { assigned?: number | string | null; capacity?: number | string | null };
  returns?: number | string | null;
  returnsSlabs?: number | string | null;
  transfers: TransferLineLike[];
  payments?: PaymentsLike | null;
};
export function applyDerived<T extends DerivedReport>(report: T, derived: Omit<DerivedFigures, 'noBranchTickets' | 'payments'> & { payments?: DerivedFigures['payments'] }): T {
  if (report.status === 'submitted') return report;

  // Payments from the Payments page (from PAYMENTS_FROM_PAGE_SINCE): its
  // entries decide every method. With none, "Nothing taken today" (every
  // method 0) stands; anything else left from an earlier read goes back to
  // not recorded, so a payment voided since doesn't linger.
  if (derived.payments?.fromPage) {
    const nothingTaken = paymentsSaid(report.payments) && PAYMENT_METHODS.every(({ key }) =>
      !Number(report.payments?.[key]?.count) && !Number(report.payments?.[key]?.amount));
    report.payments = derived.payments.count > 0 && derived.payments.grid
      ? derived.payments.grid
      : nothingTaken
        ? Object.fromEntries(PAYMENT_METHODS.map(({ key }) => [key, { count: 0, amount: 0 }]))
        : Object.fromEntries(PAYMENT_METHODS.map(({ key }) => [key, { count: null, amount: null }]));
  }

  report.visitors ||= { homeowners: 0 };
  report.visitors.homeowners = derived.visitorCheckIns;
  report.deliveries.assigned = derived.deliveriesAssigned;
  report.pickups.assigned = derived.pickupsAssigned;

  // Slabs starts from what the tickets add up to and stays editable from
  // there — null still means "nobody has counted them", so that's the only
  // case this fills in. Once a figure is on the report, auto-filled or
  // hand-corrected, later loads leave it alone rather than overwriting a
  // correction the next time a ticket on the day changes.
  if (report.deliveries.capacity === null || report.deliveries.capacity === undefined) {
    report.deliveries.capacity = derived.deliveriesSlabs;
  }
  if (report.pickups.capacity === null || report.pickups.capacity === undefined) {
    report.pickups.capacity = derived.pickupsSlabs;
  }

  // Returns are filled in only when there is actually something to report.
  //
  // This is deliberately stricter than the two above, because `returns` is an
  // older hand-typed field, and on this sheet null and 0 are different facts:
  // null is "nobody has said", 0 is "somebody said none" (see the comment on
  // the schema). Filling a plain 0 in on every quiet day would answer the
  // question on the branch's behalf, turning every blank sheet into one that
  // claims no returns came back — and it would do it before anyone had looked.
  // Writing only a real, non-zero ticket count keeps the blank meaning blank
  // and still saves the typing on the days it matters.
  //
  // Unlike the capacity fields, these are not stripped back out by
  // buildDraftPayload, so once a figure lands it stops tracking later ticket
  // edits. That is the safe direction for a field people have been typing into
  // by hand for months: an auto-fill that goes stale can be corrected on the
  // sheet, whereas a strip would quietly wipe a number somebody entered.
  const fillReturn = <Value,>(value: Value, count: number) =>
    ((value === null || value === undefined) && count > 0 ? count : value);

  report.returns = fillReturn(report.returns, derived.returnsCount);
  report.returnsSlabs = fillReturn(report.returnsSlabs, derived.returnsSlabs);

  // Keep any slab counts already on a route that still exists — that covers
  // both a hand correction and a figure that was itself auto-filled earlier,
  // which is why this checks presence rather than truthiness. A route that
  // has never appeared on this report before gets the fresh ticket sum. Keyed
  // by direction as well as the route string — out and in are different lines
  // even when (hypothetically) they'd render the same "SEA — SLC" text.
  // Keyed per transfer now (transferLineKey: direction, route and transfer
  // number or ticket), so two transfers on one route keep their own figures;
  // a draft saved per route carries over where that's still one ticket.
  const manual = report.transfers.filter((t) => !t.auto);
  report.transfers = [
    ...mergeTypedTransferSlabs(report.transfers, derived.transfers),
    ...manual
  ];

  return report;
}

/**
 * What a slab count usually looks like, so a slipped finger can be questioned.
 *
 * A container is around a hundred slabs, which is the anchor when a branch has
 * no history yet. Once it has filed enough container lines, its own median
 * takes over — Spokane should not be measured against Seattle's volumes.
 *
 * The band is deliberately wide. This asks a question; it never refuses a
 * figure, so the cost of a false alarm is a glance and the cost of a miss is a
 * wrong number in a director's inbox.
 */
const TYPICAL_CONTAINER_SLABS = 100;

async function slabExpectation(locations: string[]) {
  const docs = await reports.recentContainerLines(locations, 60);

  // Grouped back into physical containers first — a container split across a
  // few colors would otherwise contribute several small per-line samples
  // instead of the one real container-sized figure, dragging the "typical"
  // size down and making every split shipment look odd going forward too.
  const seen = docs
    .flatMap(d => groupContainers(d.containers || []).map(groupSlabs))
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  // Under a handful of lines a median is noise, so hold the anchor.
  const centre = seen.length >= 6
    ? seen[Math.floor(seen.length / 2)]
    : TYPICAL_CONTAINER_SLABS;

  return {
    centre,
    low: Math.max(1, Math.round(centre / 5)),
    high: Math.round(centre * 3),
    fromHistory: seen.length >= 6,
    sampled: seen.length
  };
}

type SummarisedReport = {
  date: string; location: string; status?: string;
  visitors?: { homeowners?: number | null; fabricators?: number | null; designers?: number | null } | null;
  deliveries?: { assigned?: number | null } | null;
  pickups?: { assigned?: number | null } | null;
  transfers?: TransferLineLike[] | null;
  containers?: ContainerLineLike[] | null;
  payments?: PaymentsLike | null;
  submittedBy?: string | null;
  autoSubmitted?: boolean | null;
};

const outboundLines = (r: SummarisedReport) => (r.transfers || []).filter((t) => t.direction !== 'in');
const inboundLines = (r: SummarisedReport) => (r.transfers || []).filter((t) => t.direction === 'in');
const total = (lines: TransferLineLike[], key: 'count' | 'slabs') => lines.reduce((sum, t) => sum + (Number(t[key]) || 0), 0);

/** Everything the month view needs, without shipping whole documents. */
export const summarise = (r: SummarisedReport) => ({
  date: r.date,
  location: r.location,
  status: r.status,
  visitors: (r.visitors?.homeowners || 0) + (r.visitors?.fabricators || 0) + (r.visitors?.designers || 0),
  deliveries: r.deliveries?.assigned || 0,
  pickups: r.pickups?.assigned || 0,
  // A transfer line is a route, and its `count` is how many went down it — the
  // figure the tiles quote is the transfers, not the lines they are grouped on.
  // transferCount/transferSlabs are outbound only — "what this branch
  // shipped", as they always have been. Incoming has its own pair, named as
  // on the day sheet (DailyReportTab's totals), so the month view and the CSV
  // show both without changing what the existing figures mean.
  transferCount: total(outboundLines(r), 'count'),
  transferSlabs: total(outboundLines(r), 'slabs'),
  transferCountIn: total(inboundLines(r), 'count'),
  transferSlabsIn: total(inboundLines(r), 'slabs'),
  // A container line with a blank PO# continues the one above it (a container
  // that arrived with a couple of different colors on it), so the count is
  // the number of distinct containers, not the number of lines.
  containerCount: groupContainers(r.containers || []).length,
  containerSlabs: (r.containers || []).reduce((sum, c) => sum + (Number(c.slabs) || 0), 0),
  payments: paymentAmount(r.payments),
  submittedBy: r.submittedBy || '',
  autoSubmitted: Boolean(r.autoSubmitted)
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Recipients arrive as a comma/space separated string or an array. */
const parseRecipients = (input: unknown) => {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,;\s]+/);
  return [...new Set(list.map(x => String(x).trim().toLowerCase()).filter(x => EMAIL_RE.test(x)))];
};

const escapeHtml = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default function createDailyReportsRouter({ authenticate, requirePermission, logActivity }: { authenticate: RequestHandler; requirePermission: (permission: string) => RequestHandler; logActivity?: (req: Request, action: string, details: string) => Promise<unknown> }) {
  const router = express.Router();

  const canView = [authenticate, requirePermission('view_daily_report')];
  const canEdit = [authenticate, requirePermission('edit_daily_report')];
  const canSubmit = [authenticate, requirePermission('submit_daily_report')];
  const canReopen = [authenticate, requirePermission('reopen_daily_report')];

  /** The branches this user may pick between — drives the location selector. */
  router.get('/locations', canView, async (req: Request, res: Response) => {
    try {
      const allowed = allowedLocations(req);
      // Every branch the company has — not scoped to assignedLocations, and
      // deliberately so. A transfer's From/To picker is answering "where is
      // this going", not "whose report may I open"; a Seattle-only rep still
      // needs to pick Atlanta as a destination even though Atlanta's own
      // report is none of their business. This is names only, the same list
      // the delivery board already hands to every logged-in user for the
      // same reason (see GET /api/admin/locations in server.ts) — no figures
      // or report data from those branches comes with it.
      const allLocationDocs = await Location.find().sort({ name: 1 }).lean();
      res.json({
        locations: allowed === '*' ? BRANCH_NAMES : allowed,
        allLocations: allLocationDocs.map(l => l.name),
        canExportAll: allowed === '*'
      });
    } catch (error) {
      console.error('[daily-reports] locations failed:', error);
      res.status(500).json({ message: 'Could not load branches.' });
    }
  });

  /** GET /api/daily-reports?month=YYYY-MM&location=Seattle — the month view. */
  router.get('/', canView, validateScalarRequest, async (req: Request, res: Response) => {
  const requestQuery = scalarQuery(req);
    try {
      const { month, location } = requestQuery;
      if (!isValidMonth(month)) {
        return res.status(400).json({ message: 'Provide a month as YYYY-MM.' });
      }

      const allowed = allowedLocations(req);
      let locations!: readonly string[];
      if (location && location !== 'all') {
        if (!canSeeLocation(req, location)) {
          return res.status(403).json({ message: 'That branch is not assigned to you.' });
        }
        locations = [location];
      } else {
        locations = allowed === '*' ? BRANCH_NAMES : allowed;
      }

      const rows = await reports.reportsInMonth(locations, String(month), 'newest');

      res.json({ month, locations, reports: (await withDraftsDerived(rows)).map(summarise) });
    } catch (error) {
      console.error('[daily-reports] month view failed:', error);
      res.status(500).json({ message: 'Could not load the month.' });
    }
  });

  /**
   * GET /api/daily-reports/overview/:date — one day across every branch this
   * user may see. What the selector's "All locations" reads.
   *
   * Branches with nothing saved are included rather than omitted: a day missing
   * from the list looks like a branch that took no visitors, and the difference
   * between "nobody came in" and "nobody filled it in" is the reason to open
   * this view at all. Those rows still carry the system's own figures, so a
   * branch that hasn't started shows the deliveries it was assigned.
   */
  router.get('/overview/:date', canView, validateScalarRequest, async (req: Request, res: Response) => {
  const requestParams = scalarParams(req);
    try {
      const { date } = requestParams;
      if (!isValidDate(date)) return res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' });

      const allowed = allowedLocations(req);
      // Filtered to branches we have, so a stale name on a user's record can't
      // put a branch in the list that doesn't exist.
      const locations = (allowed === '*' ? BRANCH_NAMES : allowed).filter(isBranch);

      const saved = await reports.reportsOnDay(date, locations);
      const byLocation = new Map(saved.map(r => [r.location, r]));
      // Every branch's tickets for the day in one query, shared below — it
      // used to run once per branch, the same all-branch query 13 times.
      const deliveryRows = deliveriesOnDate(date);

      let noBranchTickets = 0;
      const rows = await Promise.all(locations.map(async (location: string) => {
        const stored = byLocation.get(location);
        const report = stored || new DailyReport({ date, location });
        const derived = await deriveFromSystem(date, location, { deliveryRows });
        noBranchTickets = derived.noBranchTickets;
        applyDerived(report, derived);
        return { ...summarise(report), status: stored ? report.status : 'none' };
      }));

      res.json({ date, rows, noBranchTickets });
    } catch (error) {
      console.error('[daily-reports] overview failed:', error);
      res.status(500).json({ message: 'Could not load that day.' });
    }
  });

  /** GET /api/daily-reports/:date?location=Seattle — one day, ready to edit. */
  /**
   * GET /api/daily-reports/submitted-days?days=Seattle|2026-10-02,Spokane|2026-10-03
   * Which of these branch days already have a submitted report — the delivery
   * form warns that changing a ticket on one won't change that report. Open to
   * anyone who can see the board (not only Daily Report users): it says no
   * more than "submitted, by whom, when". Declared before /:date so that route
   * doesn't take "submitted-days" for a date.
   */
  const canSeeDayStatus = [authenticate, (req: Request, res: Response, next: NextFunction) => {
    const perms = req.user?.permissions || [];
    if (perms.includes('view_daily_report') || perms.includes('view_delivery_schedule')) return next();
    return res.status(403).json({ message: 'Not allowed.' });
  }];
  router.get('/submitted-days', canSeeDayStatus, validateScalarRequest, async (req: Request, res: Response) => {
  const requestQuery = scalarQuery(req);
    try {
      const pairs = String(requestQuery.days || '').split(',').slice(0, 10)
        .map((p) => { const [location, date] = p.split('|'); return { location, date }; })
        .filter((p) => isBranch(p.location) && isValidDate(p.date));
      if (!pairs.length) return res.json({ days: [] });
      const found = await reports.submittedReportsOn(pairs);
      res.json({
        days: found.map((r) => ({
          location: r.location, date: r.date, submittedAt: r.submittedAt,
          submittedBy: r.submittedBy || '', autoSubmitted: Boolean(r.autoSubmitted)
        }))
      });
    } catch (error) {
      console.error('[daily-reports] submitted-days failed:', error);
      res.status(500).json({ message: 'Could not check those days.' });
    }
  });

  router.get('/:date', canView, validateScalarRequest, async (req: Request, res: Response) => {
  const requestParams = scalarParams(req);
  const requestQuery = scalarQuery(req);
    try {
      const { date } = requestParams;
      const location = requestQuery.location;

      if (!isValidDate(date)) return res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' });
      if (!location) return res.status(400).json({ message: 'Provide a branch.' });
      if (!canSeeLocation(req, location)) {
        return res.status(403).json({ message: 'That branch is not assigned to you.' });
      }

      let report = await reports.findReport(date, location);
      if (!report) {
        // Not saved yet — build the day in memory so it opens pre-filled without
        // writing a row for a day nobody ends up reporting on.
        report = new DailyReport({ date, location });
      }

      const [derived, shippedEarlier] = await Promise.all([
        deriveFromSystem(date, location),
        transfersShippedEarlier(date, location)
      ]);
      // Before applyDerived fills the blanks — see handSetFigures.
      const handSet = handSetFigures(report);
      applyDerived(report, derived);
      // A correction saved against a whole route (before lines were per
      // transfer) has to keep counting as typed once it lands on that route's
      // one ticket line, or the next save would blank it.
      handSet.transferSlabs = upgradeHandSetKeys(handSet.transferSlabs, report.transfers);

      res.json({
        transfersShippedEarlier: shippedEarlier,
        handSet,
        report: report.toObject({ depopulate: true }),
        derived: {
          visitorCheckIns: derived.visitorCheckIns,
          deliveriesAssigned: derived.deliveriesAssigned,
          pickupsAssigned: derived.pickupsAssigned,
          deliveriesSlabs: derived.deliveriesSlabs,
          pickupsSlabs: derived.pickupsSlabs,
          returnsCount: derived.returnsCount,
          returnsSlabs: derived.returnsSlabs,
          noBranchTickets: derived.noBranchTickets,
          // From the Payments page (PAYMENTS_FROM_PAGE_SINCE): the report's
          // Payments are read-only and this many live entries made them.
          paymentsFromPage: derived.payments.fromPage,
          paymentEntries: derived.payments.count
        },
        // The band a slab count is sane within, so the rule lives on the server
        // rather than being reinvented in the form.
        slabRange: await slabExpectation([location]),
        isNew: report.isNew
      });
    } catch (error) {
      console.error('[daily-reports] load failed:', error);
      res.status(500).json({ message: 'Could not load that day.' });
    }
  });

  /** PUT /api/daily-reports/:date — save the draft. */
  router.put('/:date', canEdit, validateScalarRequest, async (req: Request, res: Response) => {
  const requestParams = scalarParams(req);
    try {
      const { date } = requestParams;
      const { location } = req.body;

      if (!isValidDate(date)) return res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' });
      if (!location) return res.status(400).json({ message: 'Provide a branch.' });
      if (!canSeeLocation(req, location)) {
        return res.status(403).json({ message: 'That branch is not assigned to you.' });
      }

      const existing = await reports.findReport(date, location);
      if (existing && existing.status === 'submitted') {
        return res.status(409).json({ message: 'This day has been submitted. Reopen it to make changes.' });
      }

      const body = req.body;
      const update = {
        date,
        location,
        status: body.status === 'closed' ? 'closed' : 'draft',
        visitors: {
          homeowners: num(body.visitors?.homeowners),
          fabricators: numOrNull(body.visitors?.fabricators),
          designers: numOrNull(body.visitors?.designers)
        },
        deliveries: { assigned: num(body.deliveries?.assigned), capacity: numOrNull(body.deliveries?.capacity) },
        pickups: { assigned: num(body.pickups?.assigned), capacity: numOrNull(body.pickups?.capacity) },
        returns: numOrNull(body.returns),
        returnsSlabs: numOrNull(body.returnsSlabs),
        sinks: numOrNull(body.sinks),
        transfers: (body.transfers || []).map((t: SentTransferLine): StoredTransferLine => ({
          fromTo: String(t.fromTo || '').trim(),
          // One transfer, one number: spaces and commas are dropped.
          transferNumber: cleanTransferNumber(t.transferNumber).slice(0, 40),
          // Nobody types a count any more: a ticket line keeps its tickets'
          // count, a line added by hand counts its transfer numbers (or one).
          // The month view, its PDF and the CSV total these.
          count: transferCountOf(t),
          slabs: num(t.slabs),
          auto: Boolean(t.auto),
          // A hand-added line's direction is its route's (the same rule the
          // sheet applies), so an older app that only ever sent 'out' still
          // files "SPO — SEA" on Seattle's report as incoming.
          direction: t.auto
            ? (t.direction === 'in' ? 'in' : 'out')
            : manualTransferDirection(String(t.fromTo || '').trim(), branchCode(location)),
          // Mirrored back from what the last load derived — this endpoint
          // never sets receipt itself, that's PATCH /api/deliveries/:id/receive.
          received: Boolean(t.received),
          receivedAt: t.receivedAt ? new Date(t.receivedAt) : null,
          receivedBy: String(t.receivedBy || '').trim(),
          // Kept on a ticket line so its typed slabs stay matched to it when
          // the ticket has no transfer number (transferLineKey).
          ticketIds: t.auto && Array.isArray(t.ticketIds) ? t.ticketIds.map(String).slice(0, 5) : []
        })).filter((t: StoredTransferLine) => t.fromTo || t.transferNumber || t.slabs),
        containers: (body.containers || []).map((c: ContainerLineLike): StoredContainerLine => ({
          poNumber: String(c.poNumber || '').trim(),
          material: String(c.material || '').trim(),
          slabs: num(c.slabs)
        })).filter((c: StoredContainerLine) => c.poNumber || c.material || c.slabs),
        payments: Object.fromEntries(PAYMENT_METHODS.map(({ key }) => [key, {
          count: numOrNull(body.payments?.[key]?.count),
          amount: moneyOrNull(body.payments?.[key]?.amount)
        }])),
        notes: String(body.notes || '').trim(),
        updatedBy: req.user?.displayName || req.user?.username || ''
      };

      // Only ever writes a day that isn't submitted — see writeDraft.
      const saved = await writeDraft(date, location, update);
      if (!saved) {
        return res.status(409).json({ message: 'This day has been submitted. Reopen it to make changes.' });
      }

      res.json({ report: saved.toObject() });
    } catch (error) {
      console.error('[daily-reports] save failed:', error);
      res.status(500).json({ message: 'Could not save this day.' });
    }
  });

  /**
   * GET /api/daily-reports/:date/log?location= — every submit, reopen, email
   * and line added after submit, oldest first (More → View Log).
   */
  router.get('/:date/log', canView, validateScalarRequest, async (req: Request, res: Response) => {
    const requestParams = scalarParams(req);
    const requestQuery = scalarQuery(req);
    try {
      const { date } = requestParams;
      const location = requestQuery.location;
      if (!isValidDate(date)) return res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' });
      if (!location) return res.status(400).json({ message: 'Provide a branch.' });
      if (!canSeeLocation(req, location)) {
        return res.status(403).json({ message: 'That branch is not assigned to you.' });
      }
      const report = await reports.findReportLean(date, location,
        'status log submittedBy submittedAt autoSubmitted reopenedBy reopenedAt reopenReason');
      res.json({ status: report?.status || 'none', ...reportLog(report as Parameters<typeof reportLog>[0]) });
    } catch (error) {
      console.error('[daily-reports] log failed:', error);
      res.status(500).json({ message: 'Could not load the log.' });
    }
  });

  /** POST /api/daily-reports/:date/submit — lock the day. */
  router.post('/:date/submit', canSubmit, validateScalarRequest, async (req: Request, res: Response) => {
  const requestParams = scalarParams(req);
    try {
      const { date } = requestParams;
      const { location } = req.body;
      if (!isValidDate(date) || !location) {
        return res.status(400).json({ message: 'Provide a date and a branch.' });
      }
      if (!canSeeLocation(req, location)) {
        return res.status(403).json({ message: 'That branch is not assigned to you.' });
      }

      const report = await reports.findReport(date, location);
      if (!report) return res.status(404).json({ message: 'Save the day before submitting it.' });
      if (report.status === 'submitted') {
        return res.status(409).json({ message: 'This day was already submitted.' });
      }

      // Sign off what the system shows now, not what the page showed when it
      // was opened. Homeowners, the Count figures and auto transfer lines are
      // read-only on the sheet, and the draft save just before this one leaves
      // untouched slab figures blank (buildDraftPayload) — so a report opened
      // in the morning and submitted at night would otherwise lock in the
      // morning's check-ins. Same derive/apply the 11:59 auto-submit runs, on
      // the branch's own clock like it, so the two can't disagree. Anything a
      // person typed is kept (applyDerived only fills blanks). If the derive
      // throws, the catch below answers 500 and nothing is locked.
      applyDerived(report, await deriveFromSystem(date, location));

      const by = req.user?.displayName || req.user?.username || '';
      const now = new Date();
      const log = submitLogFor(report, logEntry('submitted', by, '', now));
      report.status = 'submitted';
      report.submittedBy = by;
      report.submittedAt = now;
      report.autoSubmitted = false;
      // Atomic, like the 11:59 job: only one of a racing submit, a second
      // click or the job can flip the day, and only that one sends the email.
      const claimed = await claimSubmission(report, log);
      if (!claimed) {
        return res.status(409).json({ message: 'This day was already submitted.' });
      }

      if (logActivity) {
        logActivity(req, 'daily_report_submitted', `${location} · ${date}`);
      }

      // Not awaited — the person submitting shouldn't wait on an email round
      // trip, and a failed send shouldn't turn a successful submit into an
      // error. notifyDailyReportSubmission no-ops for a branch with no list.
      notifyDailyReportSubmission(claimed.toObject());

      res.json({ report: claimed.toObject() });
    } catch (error) {
      console.error('[daily-reports] submit failed:', error);
      res.status(500).json({ message: 'Could not submit this day.' });
    }
  });

  /** POST /api/daily-reports/:date/reopen — unlock, with a reason on the record. */
  router.post('/:date/reopen', canReopen, validateScalarRequest, async (req: Request, res: Response) => {
  const requestParams = scalarParams(req);
    try {
      const { date } = requestParams;
      const { location, reason } = req.body;
      if (!isValidDate(date) || !location) {
        return res.status(400).json({ message: 'Provide a date and a branch.' });
      }
      if (!canSeeLocation(req, location)) {
        return res.status(403).json({ message: 'That branch is not assigned to you.' });
      }
      if (String(reason || '').trim().length < 4) {
        return res.status(400).json({ message: 'Give a reason for reopening this day.' });
      }

      const report = await reports.findReport(date, location);
      if (!report) return res.status(404).json({ message: 'No report for that day.' });

      // Into the log first: the older submit / reopen these fields held
      // (a day from before the log), then this reopen with its reason.
      const by = req.user?.displayName || req.user?.username || '';
      const now = new Date();
      report.log.push(...submitLogFor(report, logEntry('reopened', by, String(reason).trim(), now)));
      report.status = 'draft';
      report.autoSubmitted = false;
      report.reopenedBy = by;
      report.reopenedAt = now;
      report.reopenReason = String(reason).trim();
      await reports.saveReport(report);

      if (logActivity) {
        logActivity(req, 'daily_report_reopened', `${location} · ${date} — ${report.reopenReason}`);
      }

      res.json({ report: report.toObject() });
    } catch (error) {
      console.error('[daily-reports] reopen failed:', error);
      res.status(500).json({ message: 'Could not reopen this day.' });
    }
  });

  /**
   * GET /api/daily-reports/export/:month?location=Seattle|all
   * CSV, because it opens in the spreadsheet everyone already has. Managers get
   * their own branches; anyone assigned to all four can take the company sheet.
   */
  router.get('/export/:month', canView, validateScalarRequest, async (req: Request, res: Response) => {
  const requestParams = scalarParams(req);
  const requestQuery = scalarQuery(req);
    try {
      const { month } = requestParams;
      const { location } = requestQuery;
      if (!isValidMonth(month)) return res.status(400).json({ message: 'Provide a month as YYYY-MM.' });

      const allowed = allowedLocations(req);
      let locations!: readonly string[];
      if (location && location !== 'all') {
        if (!canSeeLocation(req, location)) {
          return res.status(403).json({ message: 'That branch is not assigned to you.' });
        }
        locations = [location];
      } else {
        locations = allowed === '*' ? BRANCH_NAMES : allowed;
      }

      const rows = await withDraftsDerived(await reports.reportsInMonth(locations, String(month), 'branch'));

      const head = [
        'Date', 'Branch', 'Status',
        'Homeowners', 'Fabricators', 'Designers', 'Visitors total',
        'Deliveries count', 'Deliveries slabs',
        'Pick-ups count', 'Pick-ups slabs',
        'Returns', 'Sinks',
        // Outgoing (what this branch shipped), then incoming (what arrived from
        // another branch) — the incoming three were missing until 2026-10-05.
        'Transfer routes out', 'Transfer count out', 'Transfer slabs out',
        'Transfer routes in', 'Transfer count in', 'Transfer slabs in',
        'Container lines', 'Container slabs',
        // ACH added 2026-10-15, first like on the sheet.
        'ACH count', 'ACH amount',
        'Cash count', 'Cash amount', 'Card count', 'Card amount',
        'Check count', 'Check amount',
        // Return added 2026-11-02 (negative amounts); the total is the net.
        'Return count', 'Return amount', 'Payments total',
        'Submitted by'
      ];

      const esc = (v: unknown) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const lines = rows.map(r => {
        const s = summarise(r);
        return [
          r.date, r.location, r.status,
          r.visitors?.homeowners || 0, r.visitors?.fabricators || 0, r.visitors?.designers || 0, s.visitors,
          r.deliveries?.assigned || 0, r.deliveries?.capacity || 0,
          r.pickups?.assigned || 0, r.pickups?.capacity || 0,
          r.returns || 0, r.sinks || 0,
          outboundLines(r).map((t) => t.fromTo).join(' / '), s.transferCount, s.transferSlabs,
          inboundLines(r).map((t) => t.fromTo).join(' / '), s.transferCountIn, s.transferSlabsIn,
          (r.containers || []).length, s.containerSlabs,
          r.payments?.ach?.count || 0, (r.payments?.ach?.amount || 0).toFixed(2),
          r.payments?.cash?.count || 0, (r.payments?.cash?.amount || 0).toFixed(2),
          r.payments?.card?.count || 0, (r.payments?.card?.amount || 0).toFixed(2),
          r.payments?.check?.count || 0, (r.payments?.check?.amount || 0).toFixed(2),
          r.payments?.return?.count || 0, (r.payments?.return?.amount || 0).toFixed(2),
          s.payments.toFixed(2),
          r.submittedBy || ''
        ].map(esc).join(',');
      });

      const scope = locations.length === 1 ? locations[0].replace(/\s+/g, '_') : 'all_branches';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="daily_report_${month}_${scope}.csv"`);
      res.send([head.join(','), ...lines].join('\n'));
    } catch (error) {
      console.error('[daily-reports] export failed:', error);
      res.status(500).json({ message: 'Could not build the export.' });
    }
  });

  // ── PDF ────────────────────────────────────────────────────────────────────
  // Download and email share one resolver each, so the file a manager opens and
  // the file that lands in an inbox can never be built from different rules.

  const resolveDay = async (req: Request, res: Response) => {
  const requestParams = scalarParams(req);
  const requestQuery = scalarQuery(req);
    const { date } = requestParams;
    const location = requestQuery.location || req.body?.location;
    if (!isValidDate(date)) { res.status(400).json({ message: 'Provide a date as YYYY-MM-DD.' }); return null; }
    if (!location) { res.status(400).json({ message: 'Provide a branch.' }); return null; }
    if (!canSeeLocation(req, location)) { res.status(403).json({ message: 'That branch is not assigned to you.' }); return null; }

    let report = await reports.findReportLean(date, location);
    // A saved draft prints with the system's figures as of now, like the sheet.
    if (report) [report] = await withDraftsDerived([report]);
    if (!report) {
      // A day nobody has saved still prints — as an empty sheet marked draft,
      // which is more useful than an error when someone asks for yesterday.
      const blank = new DailyReport({ date, location });
      const derived = await deriveFromSystem(date, location);
      applyDerived(blank, derived);
      report = blank.toObject();
    }
    return report;
  };

  const resolveMonth = async (req: Request, res: Response) => {
  const requestParams = scalarParams(req);
  const requestQuery = scalarQuery(req);
    const { month } = requestParams;
    const location = requestQuery.location || req.body?.location;
    if (!isValidMonth(month)) { res.status(400).json({ message: 'Provide a month as YYYY-MM.' }); return null; }

    const allowed = allowedLocations(req);
    let locations!: readonly string[];
    let scopeLabel!: string;
    if (location && location !== 'all') {
      if (!canSeeLocation(req, location)) { res.status(403).json({ message: 'That branch is not assigned to you.' }); return null; }
      locations = [location];
      scopeLabel = location;
    } else {
      locations = allowed === '*' ? BRANCH_NAMES : allowed;
      scopeLabel = locations.length === 1 ? locations[0] : 'All branches';
    }

    const docs = await reports.reportsInMonth(locations, String(month), 'branch');

    return { month, rows: (await withDraftsDerived(docs)).map(summarise), scopeLabel };
  };

  /** GET /api/daily-reports/:date/pdf?location=Seattle */
  router.get('/:date/pdf', canView, validateScalarRequest, async (req: Request, res: Response) => {
  const requestQuery = scalarQuery(req);
    try {
      const report = await resolveDay(req, res);
      if (!report) return;
      const bytes = await buildDayPdf(report);
      const disposition = requestQuery.disposition === 'inline' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${dayPdfFileName(report)}"`);
      res.send(Buffer.from(bytes));
    } catch (error) {
      console.error('[daily-reports] day pdf failed:', error);
      res.status(500).json({ message: 'Could not build the PDF.' });
    }
  });

  /** GET /api/daily-reports/export/:month/pdf?location=Seattle|all */
  router.get('/export/:month/pdf', canView, validateScalarRequest, async (req: Request, res: Response) => {
  const requestQuery = scalarQuery(req);
    try {
      const data = await resolveMonth(req, res);
      if (!data) return;
      const bytes = await buildMonthPdf(data);
      const disposition = requestQuery.disposition === 'inline' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${monthPdfFileName(data.month, data.scopeLabel)}"`);
      res.send(Buffer.from(bytes));
    } catch (error) {
      console.error('[daily-reports] month pdf failed:', error);
      res.status(500).json({ message: 'Could not build the PDF.' });
    }
  });

  const mailReport = async (req: Request, res: Response, { subject, heading, lines, filename, bytes, onSent }: { subject: string; heading: string; lines: string[]; filename: string; bytes: Uint8Array; onSent?: (to: string[], sender: string) => Promise<unknown> }) => {
    const to = parseRecipients(req.body?.to);
    if (!to.length) return res.status(400).json({ message: 'Add at least one valid email address.' });
    if (to.length > 20) return res.status(400).json({ message: 'That is more recipients than this is meant for — 20 at most.' });

    const sender = req.user?.displayName || req.user?.username || 'Easy Stones';
    const note = String(req.body?.message || '').trim();

    const html = `
      <div style="font-family:Helvetica,Arial,sans-serif;color:#1b1a17;line-height:1.55">
        <h2 style="margin:0 0 4px;font-size:17px">${escapeHtml(heading)}</h2>
        <p style="margin:0 0 14px;color:#6b6b6b;font-size:13px">${lines.map(escapeHtml).join(' &middot; ')}</p>
        ${note ? `<p style="margin:0 0 14px;font-size:14px;white-space:pre-wrap">${escapeHtml(note)}</p>` : ''}
        <p style="margin:0 0 6px;font-size:13px">The report is attached as a PDF.</p>
        <p style="margin:18px 0 0;font-size:12px;color:#8a857a">Sent by ${escapeHtml(sender)} from the Easy Stones portal.</p>
      </div>`;

    const result = await sendEmail({
      to,
      subject,
      html,
      replyTo: req.user?.email || undefined,
      defaultSenderName: SENDER_NAME,
      attachments: [{ filename, content: Buffer.from(bytes) }]
    });

    if (!result.success) {
      return res.status(502).json({ message: `Could not send the email. ${result.error || ''}`.trim() });
    }

    if (logActivity) logActivity(req, 'daily_report_emailed', `${filename} → ${to.join(', ')}`);
    if (onSent) await onSent(to, sender).catch((error) => console.error('[daily-reports] email log failed:', error));
    res.json({ sent: to });
  };

  /** POST /api/daily-reports/:date/email  { location, to, message } */
  router.post('/:date/email', canView, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const report = await resolveDay(req, res);
      if (!report) return;
      const bytes = await buildDayPdf(report);
      await mailReport(req, res, {
        subject: `Daily Work Report — ${report.location}, ${report.date}${report.status === 'draft' ? ' (draft)' : ''}`,
        heading: `Daily Work Report — ${report.location}`,
        lines: [report.date, report.status === 'submitted' ? 'Submitted' : 'Draft'],
        filename: dayPdfFileName(report),
        bytes,
        // A day never saved has no record to log on; updateOne just finds nothing.
        onSent: (to, sender) => reports.pushReportLog(report.date, report.location, logEntry('emailed', sender, `To ${to.join(', ')}`))
      });
    } catch (error) {
      console.error('[daily-reports] day email failed:', error);
      res.status(500).json({ message: 'Could not send the report.' });
    }
  });

  /** POST /api/daily-reports/export/:month/email  { location, to, message } */
  router.post('/export/:month/email', canView, validateScalarRequest, async (req: Request, res: Response) => {
    try {
      const data = await resolveMonth(req, res);
      if (!data) return;
      const bytes = await buildMonthPdf(data);
      await mailReport(req, res, {
        subject: `Daily Work Report — ${data.scopeLabel}, ${data.month}`,
        heading: `Daily Work Report — month summary`,
        lines: [data.scopeLabel, data.month, `${data.rows.length} day${data.rows.length === 1 ? '' : 's'}`],
        filename: monthPdfFileName(data.month, data.scopeLabel),
        bytes
      });
    } catch (error) {
      console.error('[daily-reports] month email failed:', error);
      res.status(500).json({ message: 'Could not send the report.' });
    }
  });

  return router;
}
