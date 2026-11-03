type BranchUser = { assignedLocations?: string[] } | null | undefined;
type Shipment = { location?: string; deliveryType?: string; transferDestination?: string };

/** Reading an inbound transfer does not grant control of the sender's shipment. */
export const canManageShipment = (user: BranchUser, ticket: Shipment): boolean => {
  const locations = user?.assignedLocations || [];
  return locations.includes('*') || !ticket.location || ticket.location === '*' || locations.includes(ticket.location);
};
export const isReceivingTransfer = (user: BranchUser, ticket: Shipment): boolean =>
  ticket.deliveryType === 'transfer' && Boolean(ticket.transferDestination)
  && (user?.assignedLocations || []).includes(ticket.transferDestination!) && !canManageShipment(user, ticket);

/**
 * Statuses the receiving branch may set on an incoming transfer (owner,
 * 2026-11-03): running late, back on schedule, arrived, or cancelled.
 * Pending (no driver yet) and restoring a cancelled one stay the sender's,
 * like deletion.
 */
export const RECEIVING_STATUSES = ['scheduled', 'delayed', 'completed', 'cancelled'] as const;
export type ReceivingStatus = typeof RECEIVING_STATUSES[number];
export const isReceivingStatus = (status: unknown): status is ReceivingStatus =>
  (RECEIVING_STATUSES as readonly unknown[]).includes(status);

/** Why the receiving branch can't change this transfer's status, or '' when it can. */
export const receivingStatusRefusal = (ticket: { truckId?: string | null; status?: string | null }): string => {
  if (ticket.status === 'cancelled') return 'It’s cancelled. Only the sending branch can restore it.';
  if (!ticket.truckId) return 'The sending branch hasn’t put it on a truck yet.';
  return '';
};

type ReceivedState = { receivedAt?: unknown; receivedBy?: string | null };

/**
 * Completed and received are one fact on an incoming transfer (owner,
 * 2026-11-03): the receiving branch setting Completed marks it received, and
 * moving it off Completed (Scheduled, Delayed, Cancelled) un-marks it. Returns
 * the received fields to write alongside the status, or {} for none.
 */
export function receivedFieldsForStatus(status: string, ticket: ReceivedState, { byName, at }: { byName: string; at: Date }) {
  if (status === 'completed') return ticket.receivedAt ? {} : { receivedAt: at, receivedBy: byName };
  return ticket.receivedAt ? { receivedAt: null, receivedBy: '' } : {};
}

/**
 * The other half: Mark received also makes it Completed — once the sender has
 * it on a truck, and not when it's cancelled (Mark received refuses those).
 */
export function statusForReceived(ticket: { truckId?: string | null; status?: string | null }) {
  return ticket.truckId && ticket.status !== 'completed' && ticket.status !== 'cancelled' ? { status: 'completed' as const } : {};
}
