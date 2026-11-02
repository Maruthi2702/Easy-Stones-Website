/** The few fields of a transfer ticket these rules read (a stored one or the one on the board). */
export type TransferTicket = {
  id?: string;
  date?: string;
  expectedArrivalDate?: string;
  numberOfSlabs?: unknown;
  receivedAt?: unknown;
};
type TicketGroup<T> = { key: string; tickets: T[] };
/**
 * Turns a flat list of transfer tickets into the lines a Daily Work Report
 * shows: one line per counterpart branch, tallying tickets that share the
 * same key (the outbound side groups by destination; the inbound side
 * groups by origin — same shape, different key, so both go through this one
 * function).
 */
export const groupTransferTickets = <T extends TransferTicket>(tickets: T[] | null | undefined, keyOf: (ticket: T) => string): TicketGroup<T>[] => {
  const groups = new Map<string, TicketGroup<T>>();
  for (const ticket of tickets || []) {
    const key = keyOf(ticket) || 'Unspecified';
    if (!groups.has(key)) groups.set(key, { key, tickets: [] });
    groups.get(key)!.tickets.push(ticket);
  }
  return [...groups.values()];
};

export const ticketSlabs = (ticket: TransferTicket) => Number(ticket.numberOfSlabs) || 0;

export const groupTicketSlabs = (group: TicketGroup<TransferTicket>) =>
  group.tickets.reduce((s, t) => s + ticketSlabs(t), 0);

/**
 * Monday of the delivery board's Mon–Sun week holding a 'YYYY-MM-DD' date
 * (Sunday closes the week before it). Mirrors getWeekMonday in
 * src/utils/deliveryWeek.js, which the server can't import, in UTC date
 * parts so the server's own timezone can't shift the answer.
 */
export const boardWeekMonday = (dateStr: string) => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay();
  t.setUTCDate(t.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return t.toISOString().slice(0, 10);
};

/**
 * Outbound transfers the sender's board draws on `date` although they shipped
 * in an earlier week — the board falls back to the arrival day once the ship
 * date is off the week on screen (GET /api/deliveries). The report counts a
 * transfer on the day it shipped, so these are exactly the cards that make the
 * board and the report look like they disagree. Grouped by ship date.
 */
export const arrivalsShippedEarlier = (tickets: TransferTicket[] | null | undefined, date: string) => {
  const monday = boardWeekMonday(date);
  const groups = new Map<string, { shipDate: string; count: number; slabs: number }>();
  for (const t of tickets || []) {
    if (t.expectedArrivalDate !== date || !t.date || t.date >= monday) continue;
    if (!groups.has(t.date)) groups.set(t.date, { shipDate: t.date, count: 0, slabs: 0 });
    const g = groups.get(t.date)!;
    g.count += 1;
    g.slabs += ticketSlabs(t);
  }
  return [...groups.values()].sort((a, b) => a.shipDate.localeCompare(b.shipDate));
};

/** True only once every ticket making up the line has been confirmed received. */
export const groupReceived = (group: TicketGroup<TransferTicket>) =>
  group.tickets.length > 0 && group.tickets.every((t) => Boolean(t.receivedAt));
