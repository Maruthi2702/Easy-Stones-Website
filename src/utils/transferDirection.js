/**
 * Which way a transfer line added by hand on the Daily Work Report goes, and
 * what about it deserves a second look (2026-10-15).
 *
 * A line from transfer tickets already knows its direction. One typed in by
 * hand used to always count as Outgoing, with no way to record material that
 * arrived. The route says which way it went: on Seattle's report,
 * "SPO — SEA" came in and "SEA — KNT" went out. So a hand-added line takes its
 * direction from its route, and nobody has to set it.
 *
 * Routes are stored as one string, 'SEA — SPO' (branch codes, an em dash with
 * a space each side), the format the server writes for ticket lines.
 */

const splitRoute = (fromTo) => {
  const [from, to] = String(fromTo || '').split('—').map(s => s.trim());
  return [from || '', to || ''];
};

/**
 * 'in' when the route ends at this branch, otherwise 'out' (it starts here,
 * or isn't finished yet — a new line counts as Outgoing until it says
 * otherwise, as before). `branch` is this report's branch code ('SEA').
 */
export function manualTransferDirection(fromTo, branch) {
  const [from, to] = splitRoute(fromTo);
  if (!branch) return 'out';
  if (to === branch && from !== branch) return 'in';
  return 'out';
}

/**
 * Why a hand-added line needs a second look, or null:
 *  - 'not-this-branch': both ends are picked and neither is this branch (it
 *    still counts as Outgoing, as every line not ending here does)
 *  - 'same-branch':     From and To are the same branch
 *  - 'duplicate':       a line from the tickets already covers this route and
 *    direction, so it may be counted twice
 * Never blocks a save; the report asks, as it does for an odd slab count.
 */
export function manualTransferWarning(line, branch, lines = []) {
  if (!line || line.auto) return null;
  const [from, to] = splitRoute(line.fromTo);
  if (!from || !to) return null;
  if (from === to) return 'same-branch';
  if (branch && from !== branch && to !== branch) return 'not-this-branch';
  const direction = manualTransferDirection(line.fromTo, branch);
  const covered = lines.some(t => t !== line && t.auto
    && (t.direction || 'out') === direction
    && String(t.fromTo || '').trim() === String(line.fromTo || '').trim());
  return covered ? 'duplicate' : null;
}

/** The sentence shown under a line for each warning. */
export function transferWarningText(warning, branchName = 'this branch') {
  switch (warning) {
    case 'not-this-branch': return `This route doesn't include ${branchName}. It's counted as outgoing until From or To is ${branchName}.`;
    case 'same-branch': return 'From and To are the same branch.';
    case 'duplicate': return 'A line from the transfer tickets already covers this route — it may be counted twice.';
    default: return '';
  }
}
