/**
 * How Supplier POs records leave the server, one shape per reader:
 *   staff     everything (src/routes/suppliers.ts)
 *   supplier  their own POs and blocks; no staff names, no history, no buyer
 *             (src/routes/supplierPortal.ts)
 *   incoming  sales' Incoming material: the approved bundles and what they
 *             are — never the supplier, the PO or a price
 * There are no prices anywhere in this module, so none can leak.
 */
import type { Loose } from '../types/records.ts';
import {
  blockCounts, blockStage, coverage, poStage, supplierGroup, decidable,
  type BlockLike, type BundleLike, type PoLine
} from '../utils/supplierBlocks.ts';

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const lineOf = (l: Loose): PoLine => ({ id: String(l._id ?? l.id), material: l.material, thickness: l.thickness || '', finish: l.finish || '', slabs: Number(l.slabs) || 0, note: l.note || '' });
export const linesOf = (po: Loose): PoLine[] => (po.lines || []).map(lineOf);

export const bundleOf = (b: Loose): BundleLike & Loose => ({
  id: String(b._id ?? b.id), n: b.n, slabs: b.slabs ?? null, photoUrl: b.photoUrl || '', status: b.status,
  round: b.round || 0, reason: b.reason || '', comment: b.comment || null, step1: b.step1 || null, step2: b.step2 || null,
  previousPhotos: (b.previousPhotos || []).map((p: Loose) => ({ url: p.url, at: iso(p.at) })), sentAt: iso(b.sentAt),
  photoAt: iso(b.photoAt), unlock: b.unlock || null
});
export const blockLike = (b: Loose): BlockLike & { lineId: string } => ({
  blockNumber: b.blockNumber || '', size: b.size || null, bundles: (b.bundles || []).map(bundleOf), sentAt: b.sentAt || null, lineId: b.lineId
});

// ── Staff ───────────────────────────────────────────────────────────────────

export function staffBlockView(b: Loose, ctx: { viewerId: string; supplier?: Loose | null; po?: Loose | null }) {
  const bundles = (b.bundles || []).map(bundleOf);
  const like = { ...blockLike(b), bundles };
  return {
    id: String(b._id), poId: b.poId, poNumber: b.poNumber, supplierId: b.supplierId,
    supplierName: ctx.supplier?.name || '', supplierCountry: ctx.supplier?.country || '', supplierTimeZone: ctx.supplier?.timeZone || '',
    shipTo: ctx.po?.shipTo || '', readyBy: ctx.po?.readyBy || '', poStatus: ctx.po?.status || 'open',
    lineId: b.lineId, material: b.material, thickness: b.thickness || '', finish: b.finish || '',
    blockNumber: b.blockNumber || '', size: b.size || null, note: b.note || null, decisionNote: b.decisionNote || null,
    bundles, stage: blockStage(like), counts: blockCounts(bundles),
    // What this viewer may decide now (the screen still checks their switches).
    decidable: { 1: decidable(bundles, 1, ctx.viewerId).map((x) => x.id), 2: decidable(bundles, 2, ctx.viewerId).map((x) => x.id) },
    firstSentAt: iso(b.firstSentAt), sentAt: iso(b.sentAt), createdAt: iso(b.createdAt), updatedAt: iso(b.updatedAt),
    enteredBy: b.enteredBy || '',
    history: b.history || []
  };
}

export function staffPoView(po: Loose, blocks: Loose[], ctx: { supplier?: Loose | null; withBlocks?: boolean; viewerId?: string }) {
  const lines = linesOf(po);
  const likes = blocks.map(blockLike);
  const cov = coverage(lines, likes);
  const stages = likes.map(blockStage);
  const last = [po.updatedAt, ...blocks.map((b) => b.updatedAt)].filter(Boolean).map((d) => new Date(d).getTime());
  return {
    id: String(po._id), poNumber: po.poNumber, supplierId: po.supplierId, supplierName: ctx.supplier?.name || po.supplierName || '',
    supplierCountry: ctx.supplier?.country || '', shipTo: po.shipTo || '', readyBy: po.readyBy || '',
    buyerId: po.buyerId || '', buyerName: po.buyerName || '', lines, note: po.note || null, source: po.source || 'typed',
    status: po.status || 'open', statusReason: po.statusReason || '', assignedAt: iso(po.assignedAt),
    coverage: cov, stage: poStage({ status: po.status || 'open', lines }, likes),
    blockStages: {
      review: stages.filter((s) => s === 'review').length, final: stages.filter((s) => s === 'final').length,
      supplier: stages.filter((s) => s === 'supplier' || s === 'draft').length, approved: stages.filter((s) => s === 'approved').length,
      sent: likes.filter((b) => b.sentAt).length
    },
    lastActivityAt: last.length ? new Date(Math.max(...last)).toISOString() : null,
    createdAt: iso(po.createdAt), updatedAt: iso(po.updatedAt), createdBy: po.createdBy || '',
    history: ctx.withBlocks ? po.history || [] : undefined,
    blocks: ctx.withBlocks ? blocks.filter((b) => b.sentAt).map((b) => staffBlockView(b, { viewerId: ctx.viewerId || '', supplier: ctx.supplier, po })) : undefined,
    draftBlocks: blocks.filter((b) => !b.sentAt).length
  };
}

// ── Supplier ────────────────────────────────────────────────────────────────

/** A note without who wrote it: suppliers never see staff names. */
const publicNote = (n: Loose | null | undefined) => (n?.text ? { text: n.text, lang: n.lang || 'en', translations: n.translations || null, at: iso(n.at) } : null);

const supplierBundle = (b: Loose) => {
  const x = bundleOf(b);
  const decided = x.step2 || x.step1;
  return {
    id: x.id, n: x.n, slabs: x.slabs, photoUrl: x.photoUrl, status: x.status, round: x.round,
    // Which list the reason comes from, so the portal can name it in their language.
    decision: x.status === 'rejected' ? 'reject' : x.status === 'retake' ? 'retake' : decided?.decision || '',
    reason: x.reason || '', comment: publicNote(x.comment),
    earlierPhoto: x.previousPhotos?.length ? x.previousPhotos[x.previousPhotos.length - 1]!.url : '',
    photoAt: x.photoAt || null, sentAt: x.sentAt || null
  };
};

export function supplierBlockView(b: Loose, po?: Loose | null) {
  const like = blockLike(b);
  return {
    id: String(b._id), poId: b.poId, poNumber: b.poNumber, lineId: b.lineId,
    material: b.material, thickness: b.thickness || '', finish: b.finish || '',
    blockNumber: b.blockNumber || '', size: b.size || null, note: publicNote(b.note), decisionNote: publicNote(b.decisionNote),
    bundles: (b.bundles || []).map(supplierBundle), stage: blockStage(like), counts: blockCounts(like.bundles),
    sent: Boolean(b.sentAt), sentAt: iso(b.sentAt), updatedAt: iso(b.updatedAt), poOpen: !po || po.status === 'open'
  };
}

export function supplierPoView(po: Loose, blocks: Loose[], withBlocks = false) {
  const lines = linesOf(po);
  const likes = blocks.map(blockLike);
  const cov = coverage(lines, likes);
  return {
    id: String(po._id), poNumber: po.poNumber, shipTo: po.shipTo || '', readyBy: po.readyBy || '', lines, note: publicNote(po.note),
    status: po.status || 'open', coverage: cov, group: supplierGroup({ status: po.status || 'open', lines }, likes),
    blocks: withBlocks
      ? blocks.map((b) => supplierBlockView(b, po))
      : blocks.map((b) => {
        const like = blockLike(b);
        const c = blockCounts(like.bundles);
        // Bundles waiting on the supplier: a new photo, an unlocked one, one not sent yet.
        return { id: String(b._id), lineId: b.lineId, blockNumber: b.blockNumber || '', stage: blockStage(like), needs: c.retake + c.unlocked + (like.sentAt ? c.draft : 0), draft: !like.sentAt };
      }),
    updatedAt: iso(po.updatedAt), assignedAt: iso(po.assignedAt)
  };
}

// ── Sales: Incoming material ────────────────────────────────────────────────

export function incomingView(b: Loose, po: Loose) {
  const approved = (b.bundles || []).map(bundleOf).filter((x: BundleLike) => x.status === 'approved');
  const at = approved.map((x: BundleLike) => (x.step2?.at ? new Date(x.step2.at).getTime() : 0)).filter(Boolean);
  return {
    id: String(b._id), material: b.material, thickness: b.thickness || '', finish: b.finish || '',
    blockNumber: b.blockNumber || '', size: b.size || null, shipTo: po.shipTo || '', readyBy: po.readyBy || '',
    bundles: approved.map((x: BundleLike) => ({ n: x.n, slabs: x.slabs, photoUrl: x.photoUrl })),
    slabs: approved.reduce((s: number, x: BundleLike) => s + (Number(x.slabs) || 0), 0),
    approvedAt: at.length ? new Date(Math.max(...at)).toISOString() : null
  };
}
