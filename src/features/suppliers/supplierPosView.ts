import { PO_STAGES, BLOCK_STAGES, BUNDLE_LABELS, type PoStage, type BlockStage, type BundleStatus } from '../../utils/supplierBlocks';
import type { Block, Po, SupplierLoginInfo } from './types';

/**
 * Supplier POs' list rules (the page, tiles and queues). Pure, so they're
 * tested beside it (supplierPosView.test.ts).
 */

export type PoFilters = { search: string; shipTo: string; supplierId: string; stage: string };
export const NO_FILTERS: PoFilters = { search: '', shipTo: '', supplierId: '', stage: 'open' };

const STAGE_ORDER: PoStage[] = ['review', 'final', 'supplier', 'covered', 'closed', 'cancelled'];
const norm = (s: unknown) => String(s ?? '').toLowerCase();

/** Does a PO match the typed search (PO #, supplier, material, ship to, buyer)? */
export function poMatches(po: Po, search: string) {
  const q = norm(search).trim();
  if (!q) return true;
  const hay = [po.poNumber, po.supplierName, po.shipTo, po.buyerName, ...po.lines.map((l) => `${l.material} ${l.thickness} ${l.finish}`)].map(norm).join(' ');
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/**
 * The POs to list: `stage` 'open' is everything still open, 'all' everything
 * loaded, else one stage. What waits on us first, then the newest activity.
 */
export function visiblePos(pos: Po[], f: PoFilters) {
  const base = pos.filter((p) => (!f.shipTo || p.shipTo === f.shipTo) && (!f.supplierId || p.supplierId === f.supplierId));
  const staged = base.filter((p) => (f.stage === 'all' ? true : f.stage === 'open' ? p.status === 'open' : p.stage === f.stage));
  const rows = staged.filter((p) => poMatches(p, f.search)).sort((a, b) =>
    STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || '')));
  return { base: staged, rows };
}

/** The page's tiles, over the open POs that pass the ship-to / supplier filters. */
export function poTiles(pos: Po[], f: Pick<PoFilters, 'shipTo' | 'supplierId'>) {
  const open = pos.filter((p) => p.status === 'open' && (!f.shipTo || p.shipTo === f.shipTo) && (!f.supplierId || p.supplierId === f.supplierId));
  const sum = (pick: (p: Po) => number) => open.reduce((s, p) => s + pick(p), 0);
  return {
    open: open.length,
    review: sum((p) => p.blockStages.review),
    final: sum((p) => p.blockStages.final),
    supplier: open.filter((p) => p.stage === 'supplier').length,
    approvedSlabs: sum((p) => p.coverage.reduce((s, c) => s + c.approved, 0)),
    orderedSlabs: sum((p) => p.coverage.reduce((s, c) => s + c.ordered, 0))
  };
}

/** A PO's slabs over all its lines: ordered, approved, waiting on us. */
export function poTotals(po: Pick<Po, 'coverage'>) {
  return po.coverage.reduce((t, c) => ({
    ordered: t.ordered + c.ordered, approved: t.approved + c.approved, waiting: t.waiting + c.review + c.final, rejected: t.rejected + c.rejected
  }), { ordered: 0, approved: 0, waiting: 0, rejected: 0 });
}

/** Blocks in a queue that pass the filters and search; the longest waiting first. */
export function visibleBlocks(blocks: Block[], f: PoFilters) {
  const q = norm(f.search).trim();
  return blocks
    .filter((b) => (!f.shipTo || b.shipTo === f.shipTo) && (!f.supplierId || b.supplierId === f.supplierId))
    .filter((b) => !q || q.split(/\s+/).every((w) => [b.poNumber, b.blockNumber, b.supplierName, b.material, b.shipTo].map(norm).join(' ').includes(w)))
    .sort((a, b) => String(a.sentAt || '').localeCompare(String(b.sentAt || '')));
}

export const poStageOf = (key: string) => PO_STAGES.find((s) => s.key === key) || PO_STAGES[2]!;
export const blockStageOf = (key: BlockStage | string) => BLOCK_STAGES.find((s) => s.key === key) || BLOCK_STAGES[3]!;
export const bundleLabelOf = (status: BundleStatus) => BUNDLE_LABELS[status] || BUNDLE_LABELS.draft;

/** "just now", "12 min ago", "3 h ago", "2 days ago", "Oct 4". */
export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "10:14 AM their time" — the supplier's clock, when their time zone is known. */
export function theirTime(timeZone: string, now = new Date()) {
  if (!timeZone) return '';
  try {
    return `${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })} their time`;
  } catch {
    return '';
  }
}

export const dayText = (day: string) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
export const whenText = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/** Who offers what at each step, for the step strip. */
export function stepStrip(block: Block) {
  const step1 = block.bundles.map((b) => b.step1).filter(Boolean);
  const step2 = block.bundles.map((b) => b.step2).filter(Boolean);
  const names = (list: typeof step1) => [...new Set(list.map((s) => s!.byName))].join(', ');
  return {
    offered: block.firstSentAt,
    step1: { done: block.counts.review === 0 && step1.length > 0, by: names(step1) },
    step2: { done: block.counts.final === 0 && block.counts.review === 0 && step2.length > 0, by: names(step2) },
    approved: block.counts.approved > 0 && block.counts.review === 0 && block.counts.final === 0
  };
}

/** "Signed in 2 h ago", "Invite sent Nov 6", "Off", "Locked", "No login". */
export function loginState(l: SupplierLoginInfo | undefined) {
  if (!l) return { label: 'No login', colour: 'draft' };
  if (!l.active) return { label: 'Turned off', colour: 'miss' };
  if (l.locked) return { label: 'Locked (wrong password)', colour: 'back' };
  if (!l.hasPassword) return { label: `Invite sent ${timeAgo(l.invitedAt)}`, colour: 'wait' };
  return { label: l.lastSeenAt ? `Seen ${timeAgo(l.lastSeenAt)}` : 'Set up', colour: 'ok' };
}

