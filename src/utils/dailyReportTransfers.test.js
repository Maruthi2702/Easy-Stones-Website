import { describe, it, expect } from 'vitest';
import { groupTransferTickets, groupTicketSlabs, groupReceived } from './dailyReportTransfers';

describe('groupTransferTickets', () => {
  it('groups tickets by the given key', () => {
    const groups = groupTransferTickets([
      { transferDestination: 'Salt Lake City', numberOfSlabs: 20 },
      { transferDestination: 'Salt Lake City', numberOfSlabs: 24 },
      { transferDestination: 'Dallas', numberOfSlabs: 10 }
    ], (t) => t.transferDestination);

    expect(groups).toHaveLength(2);
    const slc = groups.find(g => g.key === 'Salt Lake City');
    expect(slc.tickets).toHaveLength(2);
  });

  it('falls back to an "Unspecified" key when the key function returns nothing', () => {
    const groups = groupTransferTickets([{ numberOfSlabs: 5 }], (t) => t.transferDestination);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('Unspecified');
  });

  it('returns nothing for an empty or missing list', () => {
    expect(groupTransferTickets([], () => 'x')).toEqual([]);
    expect(groupTransferTickets(undefined, () => 'x')).toEqual([]);
  });
});

describe('groupTicketSlabs', () => {
  it('sums slabs across every ticket in the group', () => {
    const [group] = groupTransferTickets([
      { transferDestination: 'Dallas', numberOfSlabs: 20 },
      { transferDestination: 'Dallas', numberOfSlabs: 24 }
    ], (t) => t.transferDestination);
    expect(groupTicketSlabs(group)).toBe(44);
  });

  it('ignores non-numeric slab values', () => {
    const [group] = groupTransferTickets([
      { transferDestination: 'Dallas', numberOfSlabs: null }
    ], (t) => t.transferDestination);
    expect(groupTicketSlabs(group)).toBe(0);
  });
});

describe('groupReceived', () => {
  it('is true only when every ticket in the group has receivedAt set', () => {
    const groups = groupTransferTickets([
      { transferDestination: 'Dallas', receivedAt: new Date() },
      { transferDestination: 'Dallas', receivedAt: null }
    ], (t) => t.transferDestination);
    expect(groupReceived(groups[0])).toBe(false);
  });

  it('is true once all tickets are received', () => {
    const groups = groupTransferTickets([
      { transferDestination: 'Dallas', receivedAt: new Date() },
      { transferDestination: 'Dallas', receivedAt: new Date() }
    ], (t) => t.transferDestination);
    expect(groupReceived(groups[0])).toBe(true);
  });
});
