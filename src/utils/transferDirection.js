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
 * A line is one transfer, with one transfer number ('14956', '149567'). The
 * number as written, without a leading '#', or '' when there isn't one yet.
 */
export function transferNumberOf(line) {
  return String(line?.transferNumber || '').trim().replace(/^#/, '');
}

/** What a typed Transfer # box keeps: one number, so spaces and commas are dropped. */
export const cleanTransferNumber = (value) => String(value || '').replace(/[\s,;/]+/g, '');

/**
 * How many transfers a line stands for — one, once it has anything on it.
 * The day sheet doesn't ask for a count (2026-10-15); the month view, its
 * PDF and the CSV total these.
 */
export function transferCountOf(line) {
  if (!line) return 0;
  if (line.auto) return 1;
  return (transferNumberOf(line) || String(line.fromTo || '').replace(/—/g, '').trim() || Number(line.slabs) > 0) ? 1 : 0;
}

/**
 * The one name a transfer line goes by across saves: its direction, route
 * and which transfer it is (its number, else its ticket's id). A slab figure
 * someone corrected is remembered against it (applyDerived, handSetFigures,
 * buildDraftPayload). It used to be direction and route only, which was
 * enough while a ticket line rolled up a whole route; with a line per ticket,
 * two transfers on one route would have shared a correction. A line with
 * neither number nor ticket id keeps the old 'out:SEA — SLC' form.
 */
export function transferLineKey(line) {
  const which = transferNumberOf(line) || (line?.ticketIds?.[0] ? `id:${line.ticketIds[0]}` : '');
  return `${line?.direction || 'out'}:${String(line?.fromTo || '').trim()}${which ? `#${which}` : ''}`;
}

const routeKeyOf = (line) => `${line?.direction || 'out'}:${String(line?.fromTo || '').trim()}`;

/**
 * Which slab figure each line from the tickets should carry when a stored
 * report is refreshed: the one typed against the same line if there is one,
 * else what the tickets add up to. A draft saved before lines were per ticket
 * holds one figure per route; it carries over when that route now has exactly
 * one ticket (with two or more there's no telling whose it was, so they show
 * their tickets' figures). Returns the derived lines with slabs filled in.
 */
export function mergeTypedTransferSlabs(storedLines = [], derivedLines = []) {
  const typed = new Map(storedLines.map(t => [transferLineKey(t), t.slabs]));
  const perRoute = new Map();
  for (const t of derivedLines) perRoute.set(routeKeyOf(t), (perRoute.get(routeKeyOf(t)) || 0) + 1);
  return derivedLines.map(t => {
    const key = transferLineKey(t);
    if (typed.has(key)) return { ...t, slabs: typed.get(key) };
    const legacy = routeKeyOf(t);
    if (key !== legacy && typed.has(legacy) && perRoute.get(legacy) === 1) return { ...t, slabs: typed.get(legacy) };
    return t;
  });
}

/**
 * The same carry-over for the sheet's "a person set this" list: a key in the
 * old route-only form becomes the key of the one ticket line now on that
 * route, so a correction typed before isn't treated as untouched and blanked
 * on the next save (the 2026-08-28 incident's failure). Keys already in the
 * new form, or for a route that now has several tickets, are left as they are.
 */
export function upgradeHandSetKeys(keys = [], lines = []) {
  return keys.map(key => {
    if (key.includes('#')) return key;
    const matches = lines.filter(t => t.auto && routeKeyOf(t) === key);
    return matches.length === 1 ? transferLineKey(matches[0]) : key;
  });
}

/**
 * Why a hand-added line needs a second look, or null. Returns { code, numbers }:
 *  - 'number-on-report': the transfer number typed here is already on another
 *    line of this report (a ticket's or another typed one) — the same
 *    transfer added twice. `numbers` holds it.
 *  - 'not-this-branch': both ends are picked and neither is this branch (it
 *    still counts as Outgoing, as every line not ending here does)
 *  - 'same-branch':     From and To are the same branch
 *  - 'duplicate':       no transfer number yet, and a line from the tickets
 *    already covers this route and direction, so it may be counted twice
 * Never blocks a save; the report asks, as it does for an odd slab count.
 */
export function manualTransferWarning(line, branch, lines = []) {
  if (!line || line.auto) return null;
  const number = transferNumberOf(line);
  if (number && lines.some(t => t !== line && transferNumberOf(t) === number)) {
    return { code: 'number-on-report', numbers: [number] };
  }
  const [from, to] = splitRoute(line.fromTo);
  if (!from || !to) return null;
  if (from === to) return { code: 'same-branch' };
  if (branch && from !== branch && to !== branch) return { code: 'not-this-branch' };
  if (number) return null;
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
