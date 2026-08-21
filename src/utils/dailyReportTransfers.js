/**
 * Turns a flat list of transfer tickets into the lines a Daily Work Report
 * shows: one line per counterpart branch, tallying tickets that share the
 * same key (the outbound side groups by destination; the inbound side
 * groups by origin — same shape, different key, so both go through this one
 * function).
 */
export const groupTransferTickets = (tickets, keyOf) => {
  const groups = new Map();
  for (const ticket of tickets || []) {
    const key = keyOf(ticket) || 'Unspecified';
    if (!groups.has(key)) groups.set(key, { key, tickets: [] });
    groups.get(key).tickets.push(ticket);
  }
  return [...groups.values()];
};

export const ticketSlabs = (ticket) => Number(ticket.numberOfSlabs) || 0;

export const groupTicketSlabs = (group) =>
  group.tickets.reduce((s, t) => s + ticketSlabs(t), 0);

/** True only once every ticket making up the line has been confirmed received. */
export const groupReceived = (group) =>
  group.tickets.length > 0 && group.tickets.every((t) => Boolean(t.receivedAt));
