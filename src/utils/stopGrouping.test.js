import { describe, it, expect } from 'vitest';
import { groupStops, applyStopMove, flattenGroups, sameStopOrder } from './stopGrouping.js';

const stops = (...pairs) => pairs.map(([id, routeNumber]) => ({ id, routeNumber }));

describe('groupStops', () => {
  it('keeps every ticket its own group when none share a stop', () => {
    expect(groupStops(stops(['a', 1], ['b', 2], ['c', 3]))).toEqual([['a'], ['b'], ['c']]);
  });

  it('groups consecutive tickets that share a routeNumber — the real STONE PROS case', () => {
    expect(groupStops(stops(['a', 1], ['b', 2], ['c', 2], ['d', 2], ['e', 2])))
      .toEqual([['a'], ['b', 'c', 'd', 'e']]);
  });

  it('does not merge two separated runs of the same routeNumber', () => {
    // Same number reused later in the list is a different occasion, not the
    // same stop — grouping is positional, not a bare tally by number.
    expect(groupStops(stops(['a', 1], ['b', 2], ['c', 1])))
      .toEqual([['a'], ['b'], ['c']]);
  });

  it('handles an empty cell', () => {
    expect(groupStops([])).toEqual([]);
  });
});

describe('applyStopMove', () => {
  const groups = [['a'], ['b', 'c'], ['d']];

  it('is a no-op dropping a ticket on itself', () => {
    expect(applyStopMove(groups, 'b', 'b', 'merge')).toBe(groups);
  });

  it('merges the dragged ticket into the target\'s group without disturbing others', () => {
    expect(applyStopMove(groups, 'd', 'a', 'merge')).toEqual([['a', 'd'], ['b', 'c']]);
  });

  it('inserts as a new stop before the target group', () => {
    expect(applyStopMove(groups, 'd', 'b', 'before')).toEqual([['a'], ['d'], ['b', 'c']]);
  });

  it('inserts as a new stop after the target group', () => {
    expect(applyStopMove(groups, 'a', 'b', 'after')).toEqual([['b', 'c'], ['a'], ['d']]);
  });

  it('pulling one member out of a shared stop leaves the rest of that stop together', () => {
    // The exact case the feature exists for: detach one invoice from a
    // multi-invoice stop without scattering the other invoices.
    expect(applyStopMove(groups, 'c', 'd', 'after')).toEqual([['a'], ['b'], ['d'], ['c']]);
  });

  it('merging two lone tickets creates a new shared stop', () => {
    expect(applyStopMove(groups, 'a', 'd', 'merge')).toEqual([['b', 'c'], ['d', 'a']]);
  });

  it('a ticket arriving from another column merges straight into an existing stop', () => {
    // Not present in `groups` yet — the removal step is a no-op, same function
    // handles both a reorder and a first arrival.
    expect(applyStopMove(groups, 'new', 'b', 'merge')).toEqual([['a'], ['b', 'c', 'new'], ['d']]);
  });

  it('a ticket arriving from another column can also land as its own new stop', () => {
    expect(applyStopMove(groups, 'new', 'a', 'before')).toEqual([['new'], ['a'], ['b', 'c'], ['d']]);
  });

  it('dropping a member at the edge of its own groupmate splits the shared stop in two', () => {
    // 'before'/'after' on a ticket that is already in the same group as the
    // dragged one is how a dispatcher intentionally detaches an invoice from a
    // shared stop, rather than a no-op — 'merge' is the only mode that leaves
    // a same-group drop unchanged.
    expect(applyStopMove([['a', 'b']], 'a', 'b', 'before')).toEqual([['a'], ['b']]);
  });

  it('dropping a member back onto its own group via merge changes nothing', () => {
    expect(applyStopMove([['a', 'b']], 'a', 'b', 'merge')).toEqual([['b', 'a']]);
  });
});

describe('flattenGroups', () => {
  it('assigns routeNumber purely by position', () => {
    expect(flattenGroups([['a'], ['b', 'c'], ['d']])).toEqual([
      { id: 'a', routeNumber: 1 },
      { id: 'b', routeNumber: 2 },
      { id: 'c', routeNumber: 2 },
      { id: 'd', routeNumber: 3 }
    ]);
  });

  it('handles no groups', () => {
    expect(flattenGroups([])).toEqual([]);
  });
});

describe('sameStopOrder', () => {
  it('is true for identical arrangements', () => {
    expect(sameStopOrder(stops(['a', 1], ['b', 2]), stops(['a', 1], ['b', 2]))).toBe(true);
  });

  it('is false when a routeNumber differs', () => {
    expect(sameStopOrder(stops(['a', 1], ['b', 2]), stops(['a', 1], ['b', 3]))).toBe(false);
  });

  it('is false when the id order differs even with the same numbers', () => {
    expect(sameStopOrder(stops(['a', 1], ['b', 2]), stops(['b', 1], ['a', 2]))).toBe(false);
  });

  it('is false when lengths differ', () => {
    expect(sameStopOrder(stops(['a', 1]), stops(['a', 1], ['b', 2]))).toBe(false);
  });
});

describe('a full round-trip matches how staff already use shared stops', () => {
  it('four STONE PROS invoices stay one stop after an unrelated card is dropped into the same cell', () => {
    // Reproduces the real shape from the live board: four tickets already
    // sharing routeNumber 2, plus one ticket at 1.
    const before = stops(['x', 1], ['a', 2], ['b', 2], ['c', 2], ['d', 2]);
    const groups = groupStops(before);
    expect(groups).toEqual([['x'], ['a', 'b', 'c', 'd']]);

    // A new ticket dropped after the STONE PROS stop (not merged into it).
    const next = applyStopMove(groups, 'new', 'd', 'after');
    const after = flattenGroups(next);

    expect(after).toEqual([
      { id: 'x', routeNumber: 1 },
      { id: 'a', routeNumber: 2 },
      { id: 'b', routeNumber: 2 },
      { id: 'c', routeNumber: 2 },
      { id: 'd', routeNumber: 2 },
      { id: 'new', routeNumber: 3 }
    ]);
  });
});
