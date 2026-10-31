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
