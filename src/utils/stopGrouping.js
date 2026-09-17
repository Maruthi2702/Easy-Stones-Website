/**
 * How the dispatch board's drag-to-reorder decides what counts as "one stop".
 *
 * Two invoices for the same customer, delivered together, are one stop, and
 * staff already record that by giving both tickets the same routeNumber — 81%
 * of the stops that hold more than one ticket already do this by hand. A
 * reorder that renumbers every ticket in a cell to a unique sequential value
 * would tear those apart the moment anything else in the cell moved: four
 * invoices sharing Stop #1 would come back out as Stops #1-4.
 *
 * So reordering operates on groups (runs of tickets sharing a routeNumber, in
 * their current on-screen order), not on individual tickets. Dropping a card
 * on the upper or lower third of another one inserts it as its own new stop,
 * before or after that group; dropping it on the middle third merges it into
 * that group instead, i.e. "this is the same stop as that one." Every ticket
 * offers all three zones, so any two tickets can be merged into a shared stop,
 * and any member of an existing group can still be pulled out into one of its
 * own.
 */

/**
 * `stops`: [{ id, routeNumber }] in current on-screen order (the board already
 * sorts a cell by routeNumber then time before this ever runs).
 * Returns: [[id, id, ...], ...] — consecutive runs that share a routeNumber.
 */
export function groupStops(stops) {
  const groups = [];
  for (const s of stops) {
    const last = groups[groups.length - 1];
    if (last && last.routeNumber === s.routeNumber) {
      last.ids.push(s.id);
    } else {
      groups.push({ routeNumber: s.routeNumber, ids: [s.id] });
    }
  }
  return groups.map(g => g.ids);
}

/**
 * Applies one drop to a cell's groups and returns the new groups. Pure: takes
 * the groups as they stood before the drop and returns a new array, touching
 * nothing else.
 *
 * `mode` is 'before' | 'merge' | 'after', relative to the group that contains
 * `targetId`. `draggedId` is removed from wherever it already sits first (a
 * no-op if it isn't in these groups at all, e.g. it just arrived from another
 * column), so the same function handles an in-cell reorder and a ticket
 * landing here for the first time.
 */
export function applyStopMove(groups, draggedId, targetId, mode) {
  if (draggedId === targetId) return groups;

  // Remove the dragged id from wherever it currently sits, dropping any group
  // that becomes empty as a result.
  const without = groups
    .map(ids => ids.filter(id => id !== draggedId))
    .filter(ids => ids.length > 0);

  const targetIndex = without.findIndex(ids => ids.includes(targetId));
  if (targetIndex === -1) {
    // The target itself vanished (it was the dragged ticket's only groupmate,
    // now empty and filtered out) — land at the end rather than lose the
    // ticket. Shouldn't happen in practice since draggedId !== targetId was
    // checked above, but a defensive fallback beats a silently dropped ticket.
    return [...without, [draggedId]];
  }

  if (mode === 'merge') {
    const next = without.map(ids => ids.slice());
    next[targetIndex] = [...next[targetIndex], draggedId];
    return next;
  }

  const insertAt = mode === 'after' ? targetIndex + 1 : targetIndex;
  return [...without.slice(0, insertAt), [draggedId], ...without.slice(insertAt)];
}

/**
 * Groups, in order -> the routeNumber every ticket in them should carry.
 * Position in the array is the whole of what a routeNumber means here.
 */
export function flattenGroups(groups) {
  return groups.flatMap((ids, i) => ids.map(id => ({ id, routeNumber: i + 1 })));
}

/**
 * True when two [{id, routeNumber}] lists (in the same order) describe the
 * same arrangement — used to skip writing a round of identical stop numbers
 * back to the server when a drop didn't actually change anything.
 */
export function sameStopOrder(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.id === b[i].id && x.routeNumber === b[i].routeNumber);
}
