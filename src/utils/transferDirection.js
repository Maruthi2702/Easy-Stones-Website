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
 * The transfer numbers written on a line ('18936', or '18936, 18940' for a
 * ticket line that rolls up more than one), as a list. Anything between
 * numbers — commas, spaces, slashes — separates them.
 */
export function transferNumbersOf(line) {
  return String(line?.transferNumber || '')
    .split(/[\s,;/]+/)
    .map(s => s.replace(/^#/, '').trim())
    .filter(Boolean);
}

/**
 * How many transfers a line stands for. The daily report no longer asks for
 * a count (2026-10-15): a ticket line keeps its tickets' count, and a line
 * added by hand counts the transfer numbers typed on it — or one, if it has a
 * route or slabs but no number yet. The month view, its PDF and the CSV total
 * these.
 */
export function transferCountOf(line) {
  if (!line) return 0;
  if (line.auto) return Number(line.count) || 0;
  const numbers = transferNumbersOf(line).length;
  if (numbers) return numbers;
  return (String(line.fromTo || '').replace(/—/g, '').trim() || Number(line.slabs) > 0) ? 1 : 0;
}

/**
 * Why a hand-added line needs a second look, or null. Returns { code, numbers }:
 *  - 'number-on-report': a transfer number typed here is already on another
 *    line of this report (a ticket line or another typed one) — the same
 *    transfer added twice. `numbers` lists which.
 *  - 'not-this-branch': both ends are picked and neither is this branch (it
 *    still counts as Outgoing, as every line not ending here does)
 *  - 'same-branch':     From and To are the same branch
 *  - 'duplicate':       no transfer number yet, and a line from the tickets
 *    already covers this route and direction, so it may be counted twice
 * Never blocks a save; the report asks, as it does for an odd slab count.
 */
export function manualTransferWarning(line, branch, lines = []) {
  if (!line || line.auto) return null;
  const mine = transferNumbersOf(line);
  if (mine.length) {
    const elsewhere = new Set(lines.filter(t => t !== line).flatMap(transferNumbersOf));
    const repeated = mine.filter(n => elsewhere.has(n));
    const typedTwice = mine.filter((n, i) => mine.indexOf(n) !== i);
    const numbers = [...new Set([...repeated, ...typedTwice])];
    if (numbers.length) return { code: 'number-on-report', numbers };
  }
  const [from, to] = splitRoute(line.fromTo);
  if (!from || !to) return null;
  if (from === to) return { code: 'same-branch' };
  if (branch && from !== branch && to !== branch) return { code: 'not-this-branch' };
  if (mine.length) return null;
  const direction = manualTransferDirection(line.fromTo, branch);
  const covered = lines.some(t => t !== line && t.auto
    && (t.direction || 'out') === direction
    && String(t.fromTo || '').trim() === String(line.fromTo || '').trim());
  return covered ? { code: 'duplicate' } : null;
}

/** The sentence shown under a line for each warning. */
export function transferWarningText(warning, branchName = 'this branch') {
  switch (warning?.code) {
    case 'number-on-report': {
      const list = warning.numbers.map(n => `#${n}`).join(', ');
      return `Transfer ${list} ${warning.numbers.length === 1 ? 'is' : 'are'} already on this report — the same transfer may be added twice.`;
    }
    case 'not-this-branch': return `This route doesn't include ${branchName}. It's counted as outgoing until From or To is ${branchName}.`;
    case 'same-branch': return 'From and To are the same branch.';
    case 'duplicate': return 'A line from the transfer tickets already covers this route — add its transfer number, or it may be counted twice.';
    default: return '';
  }
}
