import { normalizeVisitDate } from './visitDates.ts';
import { cleanTransferNumber } from './transferDirection.ts';

/**
 * Log arrival: a transfer the sending branch never put on the schedule,
 * recorded by the branch it arrived at (owner's calls, 2026-11-03). Shared by
 * POST /api/deliveries/arrivals and the board's Log arrival form.
 *
 * The ticket is the sending branch's transfer like any other (`location` is
 * the sender), so the sender keeps its driver, ship date, status and
 * deletion. Until the sender changes it, the ship date is the arrival day.
 * It is saved received, and its Daily Report line is added on both sides,
 * even to a report already submitted.
 */

export type ArrivalValues = {
  from: string;
  to: string;
  arrivedOn: string;
  transferNumber: string;
  numberOfSlabs: string;
  truckId: string;
  notes: string;
};
export type ArrivalField = keyof ArrivalValues;
export type ArrivalErrors = Partial<Record<ArrivalField, string>>;

export const ARRIVAL_FIELD_LABELS: Record<ArrivalField, string> = {
  from: 'From',
  to: 'Arrived at',
  arrivedOn: 'Arrived on',
  transferNumber: 'Transfer #',
  numberOfSlabs: 'Slabs received',
  truckId: 'Driver',
  notes: 'Notes'
};

export const MAX_ARRIVAL_NOTES = 1000;


/**
 * The branches a person can log an arrival at: their assigned locations,
 * or every branch for an all-locations login.
 */
export function arrivalBranchesFor(assignedLocations: string[] | null | undefined, branches: string[]): string[] {
  const mine = assignedLocations || [];
  if (mine.includes('*')) return [...branches];
  return branches.filter((b) => mine.includes(b));
}

/** Starting values: arrived today at the person's only branch, if they have one. */
export function emptyArrival({ today, receivingBranches, truckId = '' }: { today: string; receivingBranches: string[]; truckId?: string }): ArrivalValues {
  return {
    from: '',
    to: receivingBranches.length === 1 ? receivingBranches[0] : '',
    arrivedOn: today,
    transferNumber: '',
    numberOfSlabs: '',
    truckId,
    notes: ''
  };
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * What's wrong, per field. `today` is the receiving branch's own day: a
 * truck can't have arrived tomorrow. `branches` is every branch a transfer can
 * come from.
 */
export function arrivalErrors(
  v: Partial<Record<ArrivalField, unknown>>,
  { receivingBranches, branches, today }: { receivingBranches: string[]; branches: string[]; today: string }
): ArrivalErrors {
  const e: ArrivalErrors = {};
  const from = text(v.from), to = text(v.to);
  if (!from) e.from = 'Pick the branch it came from';
  else if (!branches.includes(from)) e.from = 'Pick a branch from the list';
  if (!to) e.to = 'Pick the branch it arrived at';
  else if (!receivingBranches.includes(to)) e.to = 'You can only log arrivals at your own branches';
  else if (from && from === to) e.from = 'Can’t be the branch it arrived at';

  const day = normalizeVisitDate(v.arrivedOn);
  if (!day) e.arrivedOn = 'Pick the day it arrived';
  else if (today && day > today) e.arrivedOn = 'Can’t be after today';

  const slabs = typeof v.numberOfSlabs === 'number' ? String(v.numberOfSlabs) : text(v.numberOfSlabs);
  if (!/^\d+$/.test(slabs) || !Number.isSafeInteger(Number(slabs))) e.numberOfSlabs = 'Enter a whole number of zero or more';

  if (!text(v.truckId)) e.truckId = 'Pick who brought it';
  if (cleanTransferNumber(v.transferNumber).length > 40) e.transferNumber = 'Use 40 characters or fewer';
  if (text(v.notes).length > MAX_ARRIVAL_NOTES) e.notes = `Use ${MAX_ARRIVAL_NOTES} characters or fewer`;
  return e;
}

/** How many fields differ from the starting values (the unsaved-changes check). */
export const countArrivalChanges = (v: ArrivalValues, start: ArrivalValues) =>
  (Object.keys(start) as ArrivalField[]).filter((k) => String(v[k] ?? '').trim() !== String(start[k] ?? '').trim()).length;

/** What the form sends. `id` is made once per form, so a retried save can't log it twice. */
export function arrivalPayload(v: ArrivalValues, id: string) {
  return {
    id,
    from: v.from,
    to: v.to,
    arrivedOn: v.arrivedOn,
    transferNumber: cleanTransferNumber(v.transferNumber),
    numberOfSlabs: Number(v.numberOfSlabs),
    truckId: v.truckId,
    notes: v.notes.trim()
  };
}
export type ArrivalPayload = ReturnType<typeof arrivalPayload>;

/**
 * The Delivery record the server saves for a checked payload: the sender's
 * transfer, shipped and arrived on the arrival day, completed and received.
 */
export function arrivalTicket(p: ArrivalPayload, { byName, at }: { byName: string; at: Date }) {
  return {
    id: p.id,
    deliveryType: 'transfer' as const,
    location: p.from,
    transferDestination: p.to,
    customerName: `Transfer: ${p.from} → ${p.to}`,
    customerId: null,
    address: '',
    date: p.arrivedOn,
    expectedArrivalDate: p.arrivedOn,
    truckId: p.truckId,
    routeNumber: 1,
    soNumber: p.transferNumber,
    invoiceNumber: p.transferNumber,
    numberOfSlabs: p.numberOfSlabs,
    notes: p.notes,
    status: 'completed' as const,
    receivedAt: at,
    receivedBy: byName,
    arrivalLogged: { byName, byLocation: p.to, at }
  };
}

/** The card's line: "Logged by Seattle on arrival", or '' for an ordinary transfer. */
export function arrivalFlagText(ticket: { arrivalLogged?: { byLocation?: string } | null } | null | undefined) {
  const where = ticket?.arrivalLogged?.byLocation;
  return where ? `Logged by ${where} on arrival` : '';
}

/** What the sending branch's email says happened, line by line. */
export function arrivalEmailLines(
  ticket: { location?: string; transferDestination?: string; date?: string; soNumber?: string; numberOfSlabs?: number; notes?: string },
  { byName, driverName = '', reportsChanged }: { byName: string; driverName?: string; reportsChanged: { location: string; date: string }[] }
) {
  const lines = [
    `${ticket.transferDestination} logged a transfer from ${ticket.location} that wasn’t on the Delivery Schedule.`,
    `Arrived ${ticket.date}${ticket.soNumber ? ` · Transfer # ${ticket.soNumber}` : ' · no transfer # given'} · ${ticket.numberOfSlabs ?? 0} slab${ticket.numberOfSlabs === 1 ? '' : 's'}${driverName ? ` · brought by ${driverName}` : ''}`,
    `Logged by ${byName || 'someone'} at ${ticket.transferDestination}.`
  ];
  if (ticket.notes) lines.push(`Their note: ${ticket.notes}`);
  lines.push(`Its ship date is set to the arrival day. If it left ${ticket.location} earlier, open it on the Delivery Schedule and change the ship date, driver or transfer #.`);
  for (const r of reportsChanged) {
    lines.push(`It was added to ${r.location}’s Daily Work Report for ${r.date}, which had already been submitted.`);
  }
  return lines;
}
