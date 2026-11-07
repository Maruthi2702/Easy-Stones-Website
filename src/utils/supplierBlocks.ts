/**
 * Supplier POs (Purchasing, 2026-11-07): the rules for POs, the blocks a
 * supplier offers against them and the bundles in each block. Shared by the
 * server (src/routes/suppliers.ts, src/routes/supplierPortal.ts) and the
 * screens (src/features/suppliers/, src/features/supplierPortal/). Design:
 * the claude.ai artifact **Supplier Portal Design**
 * (https://claude.ai/artifact/KbEE97GomxC1ANhshGNwoU).
 *
 * The owner's model (2026-11-06):
 *   PO → material lines → a **block** (a lot of 50–89 slabs) → 7–8
 *   **bundles**, **one photo per bundle**.
 *   - Purchasing types the PO or fills it from the SPS import; one PO # is
 *     one PO, never two.
 *   - The supplier offers a block: its number, size and a photo + slab count
 *     per bundle. Each photo uploads the moment it's taken.
 *   - Two steps, each bundle by bundle or the whole block at once:
 *     1) Approve (managers with purchasing access, directors, admins)
 *     2) Final approval (purchasing team, directors, admins).
 *     Either step may reject a bundle (a reason from the list) or ask for a
 *     new photo. Only after step 2 may the supplier load it.
 *   - Approved bundles are **locked**. To change one the supplier asks; a
 *     manager unlocks it with a reason and the changed bundle goes through
 *     both steps again.
 *   - The supplier sees material and quantities only: there are no prices
 *     anywhere in this module.
 */
import { SAME_PERSON_BOTH_STEPS, SUPPLIER_POS } from './supplierAccess.ts';

// ── Small helpers ───────────────────────────────────────────────────────────

const clip = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const clipText = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
export const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const isEmail = (value: unknown) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const wholeNumber = (v: unknown) => {
  const text = String(v ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
};

// ── Notes, in two languages ─────────────────────────────────────────────────

/**
 * A free-text note one side wrote for the other: as typed, the language it was
 * typed in, and machine translations by language code (src/services/translate.ts
 * fills them when a key is set). Neither side ever loses the original.
 */
export type Note = { text: string; lang: string; translations?: Record<string, string> | null; by?: string; at?: string | Date };

/** What a reader in `lang` sees: the translation when there is one, else the original. */
export function noteFor(note: Note | null | undefined, lang: string) {
  if (!note?.text) return null;
  const same = (note.lang || 'en') === lang;
  const translated = same ? '' : note.translations?.[lang] || '';
  return { text: translated || note.text, original: note.text, fromLang: note.lang || 'en', translated: Boolean(translated), foreign: !same };
}

// ── Reasons ─────────────────────────────────────────────────────────────────

/**
 * Why a bundle is rejected, or why a new photo is asked for. The keys are
 * stored; each language's words are in src/utils/supplierI18n.ts, so the
 * supplier reads the reason in theirs without a translation service.
 * "other" needs a comment.
 */
export const REJECT_REASONS = Object.freeze(['cracks', 'color', 'veins', 'size', 'thickness', 'finish', 'chips', 'stains', 'other'] as const);
export const RETAKE_REASONS = Object.freeze(['dark', 'blurry', 'wet', 'whole', 'closer', 'other'] as const);
export type RejectReason = typeof REJECT_REASONS[number];
export type RetakeReason = typeof RETAKE_REASONS[number];

// ── Bundles ─────────────────────────────────────────────────────────────────

/**
 *   draft     the supplier is still adding it (never sent)
 *   review    waiting for step 1
 *   final     passed step 1, waiting for step 2
 *   approved  passed step 2: locked, the supplier may load it
 *   rejected  rejected at either step, with a reason — it stays rejected
 *   retake    a new photo was asked for at either step
 *   unlocked  was approved; a manager unlocked it so the supplier can change it
 */
export const BUNDLE_STATUSES = Object.freeze(['draft', 'review', 'final', 'approved', 'rejected', 'retake', 'unlocked'] as const);
export type BundleStatus = typeof BUNDLE_STATUSES[number];
/** What the supplier may change (photo, slab count) and send. */
export const SUPPLIER_EDITABLE: readonly BundleStatus[] = ['draft', 'retake', 'unlocked'];
export const supplierMayEdit = (b: { status?: unknown }) => (SUPPLIER_EDITABLE as readonly string[]).includes(String(b.status));

export type Decision = 'approve' | 'reject' | 'retake';
export type Step = 1 | 2;
export type StepRecord = { decision: Decision; by: string; byName: string; at: string | Date; reason?: string };
export type BundleLike = {
  id: string;
  n: number;
  slabs: number | null;
  photoUrl: string;
  status: BundleStatus;
  round?: number;
  reason?: string;
  comment?: Note | null;
  step1?: StepRecord | null;
  step2?: StepRecord | null;
  /** Earlier photos of this bundle, newest last (a retake or an unlock keeps them). */
  previousPhotos?: { url: string; at?: string | Date }[];
  /** When the current photo was taken (uploaded). */
  photoAt?: string | Date | null;
  /** When it was last sent for review. */
  sentAt?: string | Date | null;
};

export const MIN_SLABS = 1;
export const MAX_SLABS = 40;
export const MAX_BUNDLES = 20;
/** A new block starts with this many bundles (owner: "most probably 7–8"). */
export const STARTING_BUNDLES = 7;

export function slabsProblem(v: unknown): string {
  const n = typeof v === 'number' ? v : wholeNumber(v);
  if (v === null || v === undefined || v === '') return 'slabs';
  return Number.isInteger(n) && n >= MIN_SLABS && n <= MAX_SLABS ? '' : 'slabs';
}

export const stepOfStatus = (status: string): Step | null => (status === 'review' ? 1 : status === 'final' ? 2 : null);

// ── Block size ──────────────────────────────────────────────────────────────

export type BlockSize = { length: number; height: number; unit: 'in' | 'cm' };
const SIZE_LIMITS = { in: [10, 220], cm: [25, 560] } as const;
const CM_PER_IN = 2.54;

/** "124 × 76", "124x76", "315 x 193" in the unit picked → a size, or null. */
export function parseSize(length: unknown, height: unknown, unit: unknown): BlockSize | null {
  const u = unit === 'cm' ? 'cm' : 'in';
  const num = (v: unknown) => {
    const t = String(v ?? '').trim().replace(',', '.');
    return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : Number.NaN;
  };
  const l = num(length);
  const h = num(height);
  const [lo, hi] = SIZE_LIMITS[u];
  if (!(l >= lo && l <= hi && h >= lo && h <= hi)) return null;
  return { length: l, height: h, unit: u };
}
const round1 = (n: number) => Math.round(n * 10) / 10;
export const inchesOf = (s: BlockSize) => (s.unit === 'in' ? { length: s.length, height: s.height } : { length: round1(s.length / CM_PER_IN), height: round1(s.height / CM_PER_IN) });
export const cmOf = (s: BlockSize) => (s.unit === 'cm' ? { length: s.length, height: s.height } : { length: Math.round(s.length * CM_PER_IN), height: Math.round(s.height * CM_PER_IN) });
/** "124 × 76 in · 315 × 193 cm" — both, the one typed first. */
export function sizeText(s: BlockSize | null | undefined): string {
  if (!s) return '';
  const i = inchesOf(s);
  const c = cmOf(s);
  const inch = `${i.length} × ${i.height} in`;
  const cm = `${c.length} × ${c.height} cm`;
  return s.unit === 'cm' ? `${cm} · ${inch}` : `${inch} · ${cm}`;
}

// ── Blocks: what the supplier sends ─────────────────────────────────────────

export type BlockLike = {
  blockNumber: string;
  size: BlockSize | null;
  bundles: BundleLike[];
  sentAt?: string | Date | null;
};

export const cleanBlockNumber = (v: unknown) => clip(v, 30);

/**
 * Why a block can't be sent yet, as keys the portal shows in the supplier's
 * language: `block` for the block's own fields, `bundles` by bundle id
 * (photo, slabs). Every bundle the supplier may still change must be complete
 * — a draft bundle with no photo has to be photographed or removed.
 */
export function sendProblems(block: BlockLike) {
  const problems: { block: Record<string, string>; bundles: Record<string, string[]> } = { block: {}, bundles: {} };
  if (!cleanBlockNumber(block.blockNumber)) problems.block.blockNumber = 'blockNumber';
  if (!block.size) problems.block.size = 'size';
  const editable = block.bundles.filter(supplierMayEdit);
  if (!editable.length) problems.block.bundles = 'nothingToSend';
  for (const b of editable) {
    const list: string[] = [];
    if (!b.photoUrl) list.push('photo');
    if (slabsProblem(b.slabs)) list.push('slabs');
    // A retake needs a new photo — one taken after the bundle was last sent.
    if (b.status === 'retake' && b.photoUrl && !(b.photoAt && b.sentAt && new Date(b.photoAt).getTime() > new Date(b.sentAt).getTime())) list.push('newPhoto');
    if (list.length) problems.bundles[b.id] = list;
  }
  const ok = !Object.keys(problems.block).length && !Object.keys(problems.bundles).length;
  return { ok, problems, toSend: editable.map((b) => b.id) };
}

/** The bundles after Send: every editable one goes to step 1, with both steps cleared. */
export function applySend<B extends BundleLike>(bundles: B[], at: Date): B[] {
  return bundles.map((b) => (supplierMayEdit(b)
    ? { ...b, status: 'review' as const, round: (b.round || 0) + 1, step1: null, step2: null, reason: '', comment: null, sentAt: at }
    : b));
}

/** A photo taken for a bundle: the one it replaces is kept (newest last). */
export function withNewPhoto<B extends BundleLike>(b: B, url: string, at: Date): B {
  const keep = b.photoUrl && b.status !== 'draft' ? [...(b.previousPhotos || []), { url: b.photoUrl, at }] : (b.previousPhotos || []);
  return { ...b, photoUrl: url, previousPhotos: keep.slice(-10) };
}

// ── Purchasing enters a block for its supplier (2026-11-07) ─────────────────

/** A photo purchasing uploaded (POST /api/suppliers/block-photos): our own Cloudinary, nothing else. */
export const isStoredPhotoUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 500 && /^https:\/\/res\.cloudinary\.com\/[^\s"'<>]+$/.test(v);

export type EntryBundle = { id: string; slabs?: unknown; photoUrl?: unknown };
const isBundleId = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const slabsOf = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Purchasing entering what a supplier emailed or sent on WhatsApp: the
 * block's bundles after the entry, ready for sendProblems / applySend. The
 * same bundles the supplier could change are open to purchasing (a draft, a
 * new photo asked, an unlocked one): each takes the slabs and photo given — a
 * different photo keeps the one it replaces. A new id is a new bundle,
 * numbered after the last; a draft never sent that's left out is removed.
 * A bundle that's with Easy Stones (in review, approved, rejected) stays as
 * it is: changing one is a problem.
 */
export function applyEntry(bundles: BundleLike[], entry: EntryBundle[], at: Date): { bundles: BundleLike[]; problem: string | null } {
  const ids = entry.map((e) => String(e?.id || ''));
  if (new Set(ids).size !== ids.length) return { bundles, problem: 'A bundle is listed twice. Reload and try again.' };
  const photo = (e: EntryBundle) => (e.photoUrl ? String(e.photoUrl) : '');
  const out: BundleLike[] = [];
  for (const b of bundles) {
    const e = entry.find((x) => x.id === b.id);
    if (!supplierMayEdit(b)) {
      if (e && ((photo(e) && photo(e) !== b.photoUrl) || (e.slabs !== undefined && slabsOf(e.slabs) !== b.slabs))) {
        return { bundles, problem: `Bundle ${b.n} is with Easy Stones now, so it can’t be changed. Reload to see where it is.` };
      }
      out.push(b);
      continue;
    }
    if (!e) {
      if (b.status !== 'draft' || b.round) out.push(b);
      continue;
    }
    let next: BundleLike = { ...b, slabs: e.slabs === undefined ? b.slabs : slabsOf(e.slabs) };
    if (photo(e) && photo(e) !== b.photoUrl) {
      if (!isStoredPhotoUrl(photo(e))) return { bundles, problem: `Bundle ${b.n}’s photo didn’t upload. Add it again.` };
      next = { ...withNewPhoto(next, photo(e), at), photoAt: at };
    }
    out.push(next);
  }
  let n = Math.max(0, ...bundles.map((b) => b.n));
  for (const e of entry) {
    if (bundles.some((b) => b.id === e.id)) continue;
    if (!isBundleId(e.id)) return { bundles, problem: 'Reload the page and try again.' };
    n += 1;
    if (photo(e) && !isStoredPhotoUrl(photo(e))) return { bundles, problem: `Bundle ${n}’s photo didn’t upload. Add it again.` };
    out.push({ id: e.id, n, slabs: slabsOf(e.slabs), photoUrl: photo(e), photoAt: photo(e) ? at : null, status: 'draft', round: 0, previousPhotos: [] });
  }
  if (out.length > MAX_BUNDLES) return { bundles, problem: `A block has up to ${MAX_BUNDLES} bundles.` };
  return { bundles: out, problem: null };
}

/** sendProblems' keys in purchasing's words (the portal says them in the supplier's). */
export const ENTRY_PROBLEM_TEXT: Record<string, string> = {
  blockNumber: 'Enter the block #.',
  size: 'Enter the block’s size.',
  nothingToSend: 'Nothing on this block waits for the supplier.',
  photo: 'Add its photo.',
  slabs: `How many slabs (${MIN_SLABS}–${MAX_SLABS})?`,
  newPhoto: 'Add the new photo the supplier sent.'
};

// ── Decisions ───────────────────────────────────────────────────────────────

export type DecisionInput = { bundleId: string; decision: Decision; reason?: string; comment?: string };
export type Actor = { id: string; name: string };

/**
 * Why a set of decisions can't be saved (null when it can). Each must name a
 * bundle waiting for that step; reject and retake need a reason from their
 * list and "other" a comment; in step 2 nobody finalises a bundle they
 * approved in step 1.
 */
export function decisionProblem(step: Step, bundles: BundleLike[], decisions: DecisionInput[], actor: Actor, sameAllowed = SAME_PERSON_BOTH_STEPS): string | null {
  if (!decisions.length) return 'Decide at least one bundle.';
  const waitingFor = step === 1 ? 'review' : 'final';
  const seen = new Set<string>();
  for (const d of decisions) {
    const b = bundles.find((x) => x.id === d.bundleId);
    if (!b) return 'A bundle in these decisions isn’t on this block.';
    if (seen.has(d.bundleId)) return `Bundle ${b.n} is decided twice.`;
    seen.add(d.bundleId);
    if (b.status !== waitingFor) return `Bundle ${b.n} isn’t waiting for ${step === 1 ? 'review' : 'final approval'} any more. Reload to see where it is.`;
    if (!['approve', 'reject', 'retake'].includes(d.decision)) return `Choose Approve, Reject or New photo for bundle ${b.n}.`;
    if (d.decision !== 'approve') {
      const list: readonly string[] = d.decision === 'reject' ? REJECT_REASONS : RETAKE_REASONS;
      if (!d.reason || !list.includes(d.reason)) return `Choose why for bundle ${b.n}.`;
      if (d.reason === 'other' && !clipText(d.comment, 500)) return `Say what’s wrong with bundle ${b.n}.`;
    }
    if (step === 2 && !sameAllowed && b.step1?.by && b.step1.by === actor.id) {
      return `You approved bundle ${b.n} in step 1, so someone else gives its final approval.`;
    }
  }
  return null;
}

/** One bundle after a decision. `comment` is the note to the supplier, already shaped. */
export function applyDecision<B extends BundleLike>(b: B, step: Step, d: DecisionInput, actor: Actor, at: Date, comment: Note | null): B {
  const record: StepRecord = { decision: d.decision, by: actor.id, byName: actor.name, at, ...(d.reason ? { reason: d.reason } : {}) };
  const next = d.decision === 'approve' ? (step === 1 ? 'final' : 'approved') : d.decision === 'reject' ? 'rejected' : 'retake';
  return {
    ...b,
    status: next,
    ...(step === 1 ? { step1: record } : { step2: record }),
    reason: d.decision === 'approve' ? '' : d.reason || '',
    comment: d.decision === 'approve' ? null : comment
  };
}

/** May this person decide bundles at this step at all (their switches)? */
export const stepPermissionFor = (step: Step) => (step === 1 ? SUPPLIER_POS.REVIEW : SUPPLIER_POS.FINAL);

/** Which of these bundles this person may decide now (the same-person rule). */
export function decidable(bundles: BundleLike[], step: Step, actorId: string, sameAllowed = SAME_PERSON_BOTH_STEPS) {
  const waitingFor = step === 1 ? 'review' : 'final';
  return bundles.filter((b) => b.status === waitingFor && (step === 1 || sameAllowed || b.step1?.by !== actorId));
}

export function unlockProblem(bundles: BundleLike[], ids: string[], reason: string): string | null {
  if (!ids.length) return 'Choose a bundle to unlock.';
  if (!clipText(reason, 300)) return 'Say why it’s being unlocked.';
  for (const id of ids) {
    const b = bundles.find((x) => x.id === id);
    if (!b) return 'A bundle to unlock isn’t on this block.';
    if (b.status !== 'approved') return `Bundle ${b.n} isn’t approved, so there’s nothing to unlock.`;
  }
  return null;
}

// ── Where a block stands ────────────────────────────────────────────────────

export type BlockCounts = Record<BundleStatus, number> & { slabs: Record<BundleStatus, number>; total: number };

export function blockCounts(bundles: BundleLike[]): BlockCounts {
  const zero = () => Object.fromEntries(BUNDLE_STATUSES.map((s) => [s, 0])) as Record<BundleStatus, number>;
  const counts = { ...zero(), slabs: zero(), total: bundles.length } as BlockCounts;
  for (const b of bundles) {
    counts[b.status] += 1;
    counts.slabs[b.status] += Number(b.slabs) || 0;
  }
  return counts;
}

/**
 *   draft     never sent (the supplier's own; staff don't list it)
 *   review    something waits for step 1
 *   final     something waits for step 2 (and nothing for step 1)
 *   supplier  the supplier has to act (a new photo, an unlocked bundle, a new bundle)
 *   approved  every bundle is approved or rejected, at least one approved
 *   rejected  every bundle rejected
 */
export type BlockStage = 'draft' | 'review' | 'final' | 'supplier' | 'approved' | 'rejected';
export function blockStage(block: Pick<BlockLike, 'bundles' | 'sentAt'>): BlockStage {
  if (!block.sentAt) return 'draft';
  const c = blockCounts(block.bundles);
  if (c.review) return 'review';
  if (c.final) return 'final';
  if (c.retake || c.unlocked || c.draft) return 'supplier';
  if (c.approved) return 'approved';
  return 'rejected';
}
export const BLOCK_STAGE_ORDER: readonly BlockStage[] = ['review', 'final', 'supplier', 'draft', 'approved', 'rejected'];

// ── POs ─────────────────────────────────────────────────────────────────────

export const THICKNESSES = Object.freeze(['1.2 cm', '2 cm', '3 cm', '4 cm', '6 cm']);
export const FINISHES = Object.freeze(['Polished', 'Honed', 'Leathered', 'Brushed', 'Flamed', 'Sandblasted', 'Dual finish']);

/** "po 41872 " → "41872"; the one key a typed and an imported PO share (never two POs for one number). */
export const poKey = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const PO_PATTERN = /^[A-Z0-9][A-Z0-9 ./_-]{0,29}$/;

export type PoLineInput = { id?: string; material?: unknown; thickness?: unknown; finish?: unknown; slabs?: unknown; note?: unknown };
export type PoLine = { id: string; material: string; thickness: string; finish: string; slabs: number; note: string };
export type PoInput = {
  poNumber?: unknown; supplierId?: unknown; shipTo?: unknown; readyBy?: unknown; buyerId?: unknown;
  lines?: PoLineInput[]; note?: unknown;
};
export type PoProblems = Partial<Record<'poNumber' | 'supplierId' | 'shipTo' | 'readyBy' | 'lines' | 'note', string>> & { lineProblems?: Record<string, Record<string, string>> };

/**
 * A PO as typed (or filled from SPS) → what's saved, or the problems by field.
 * `newId` names a line that came without one. No prices, by design.
 */
export function cleanPo(body: PoInput, { newId, today }: { newId: () => string; today?: string }) {
  const problems: PoProblems = {};
  const poNumber = poKey(body.poNumber);
  if (!poNumber) problems.poNumber = 'Enter the PO #';
  else if (!PO_PATTERN.test(poNumber)) problems.poNumber = 'Letters, numbers, spaces and . / - _ only';
  const supplierId = String(body.supplierId ?? '').trim();
  if (!supplierId) problems.supplierId = 'Choose the supplier';
  const shipTo = clip(body.shipTo, 60);
  if (!shipTo) problems.shipTo = 'Choose where it ships to';
  const readyBy = String(body.readyBy ?? '').trim();
  if (readyBy && !isDay(readyBy)) problems.readyBy = 'Pick a real date';
  else if (readyBy && today && readyBy < shiftDay(today, -365)) problems.readyBy = 'That date is more than a year ago';
  const lineProblems: Record<string, Record<string, string>> = {};
  const lines: PoLine[] = [];
  const raw = Array.isArray(body.lines) ? body.lines.slice(0, 30) : [];
  raw.forEach((l, i) => {
    const id = /^[a-f0-9]{24}$/.test(String(l?.id || '')) ? String(l.id) : newId();
    const material = clip(l?.material, 80);
    const slabs = wholeNumber(l?.slabs);
    const lp: Record<string, string> = {};
    if (!material) lp.material = 'Enter the material';
    if (!(Number.isInteger(slabs) && slabs >= 1 && slabs <= 9999)) lp.slabs = 'Slabs: a whole number';
    if (Object.keys(lp).length) lineProblems[String(l?.id || i)] = lp;
    lines.push({ id, material, thickness: clip(l?.thickness, 20), finish: clip(l?.finish, 30), slabs: Number.isFinite(slabs) ? slabs : 0, note: clip(l?.note, 200) });
  });
  if (!lines.length) problems.lines = 'Add at least one material';
  else if (Object.keys(lineProblems).length) { problems.lines = 'Check the materials'; problems.lineProblems = lineProblems; }
  const note = clipText(body.note, 1500);
  const value = { poNumber, supplierId, shipTo, readyBy: readyBy || '', buyerId: String(body.buyerId ?? '').trim(), lines, note };
  return Object.keys(problems).length ? { problems } : { value, problems };
}

function shiftDay(day: string, by: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/** What changed on a PO, for its history ("ready by Nov 20 → Dec 4, Taj Mahal 240 → 260 slabs"). */
export function poChanges(before: { shipTo?: string; readyBy?: string; supplierName?: string; buyerName?: string; lines: PoLine[]; note?: string }, after: typeof before): string[] {
  const out: string[] = [];
  if ((before.supplierName || '') !== (after.supplierName || '')) out.push(`supplier ${before.supplierName || '—'} → ${after.supplierName || '—'}`);
  if ((before.shipTo || '') !== (after.shipTo || '')) out.push(`ship to ${before.shipTo || '—'} → ${after.shipTo || '—'}`);
  if ((before.readyBy || '') !== (after.readyBy || '')) out.push(`ready by ${before.readyBy || '—'} → ${after.readyBy || '—'}`);
  if ((before.buyerName || '') !== (after.buyerName || '')) out.push(`buyer ${before.buyerName || '—'} → ${after.buyerName || '—'}`);
  for (const l of after.lines) {
    const old = before.lines.find((x) => x.id === l.id);
    if (!old) out.push(`added ${l.material} (${l.slabs} slabs)`);
    else {
      const bits: string[] = [];
      if (old.material !== l.material) bits.push(`${old.material} → ${l.material}`);
      if (old.slabs !== l.slabs) bits.push(`${old.slabs} → ${l.slabs} slabs`);
      if (old.thickness !== l.thickness) bits.push(`${old.thickness || '—'} → ${l.thickness || '—'}`);
      if (old.finish !== l.finish) bits.push(`${old.finish || '—'} → ${l.finish || '—'}`);
      if (bits.length) out.push(`${l.material}: ${bits.join(', ')}`);
    }
  }
  for (const old of before.lines) if (!after.lines.some((l) => l.id === old.id)) out.push(`removed ${old.material}`);
  if ((before.note || '') !== (after.note || '')) out.push('note to the supplier');
  return out;
}

/** A line can't be removed (or its slabs cut below) once blocks were offered against it. */
export function lineRemovalProblem(before: PoLine[], after: PoLine[], blocksByLine: Record<string, number>): string | null {
  for (const old of before) {
    if (!after.some((l) => l.id === old.id) && blocksByLine[old.id]) {
      return `${old.material} already has ${blocksByLine[old.id]} block${blocksByLine[old.id] === 1 ? '' : 's'} offered, so it can’t be removed.`;
    }
  }
  return null;
}

// ── Coverage: how much of the PO is approved ────────────────────────────────

export type LineCoverage = { lineId: string; ordered: number; approved: number; final: number; review: number; supplier: number; offered: number; rejected: number };

/** Slabs per line by where they stand, from the blocks offered (drafts not counted). */
export function coverage(lines: PoLine[], blocks: (BlockLike & { lineId: string })[]): LineCoverage[] {
  return lines.map((l) => {
    const c: LineCoverage = { lineId: l.id, ordered: l.slabs, approved: 0, final: 0, review: 0, supplier: 0, offered: 0, rejected: 0 };
    for (const b of blocks) {
      if (b.lineId !== l.id || !b.sentAt) continue;
      for (const bu of b.bundles) {
        const s = Number(bu.slabs) || 0;
        if (bu.status === 'approved') c.approved += s;
        else if (bu.status === 'final') c.final += s;
        else if (bu.status === 'review') c.review += s;
        else if (bu.status === 'rejected') c.rejected += s;
        else c.supplier += s;
        if (bu.status !== 'rejected') c.offered += s;
      }
    }
    return c;
  });
}

export const isCovered = (cov: LineCoverage[]) => cov.length > 0 && cov.every((c) => c.approved >= c.ordered);

export type PoStatus = 'open' | 'closed' | 'cancelled';
/**
 *   cancelled / closed  as set by purchasing
 *   review              a block waits for step 1
 *   final               a block waits for step 2
 *   covered             every line approved in full ("Approved to load")
 *   supplier            waiting for the supplier (nothing offered yet, a new photo asked, more to offer)
 */
export type PoStage = 'cancelled' | 'closed' | 'review' | 'final' | 'covered' | 'supplier';
export function poStage(po: { status: PoStatus; lines: PoLine[] }, blocks: (BlockLike & { lineId: string })[]): PoStage {
  if (po.status === 'cancelled') return 'cancelled';
  if (po.status === 'closed') return 'closed';
  const stages = blocks.map(blockStage);
  if (stages.includes('review')) return 'review';
  if (stages.includes('final')) return 'final';
  if (isCovered(coverage(po.lines, blocks))) return 'covered';
  return 'supplier';
}

export const PO_STAGES: readonly { key: PoStage; label: string; colour: string }[] = [
  { key: 'review', label: 'Waiting for review', colour: 'wait' },
  { key: 'final', label: 'Final approval', colour: 'final' },
  { key: 'supplier', label: 'Waiting for supplier', colour: 'draft' },
  { key: 'covered', label: 'Approved to load', colour: 'ok' },
  { key: 'closed', label: 'Closed', colour: 'draft' },
  { key: 'cancelled', label: 'Cancelled', colour: 'miss' }
];
export const BLOCK_STAGES: readonly { key: BlockStage; label: string; colour: string }[] = [
  { key: 'review', label: 'Waiting for review', colour: 'wait' },
  { key: 'final', label: 'Final approval', colour: 'final' },
  { key: 'supplier', label: 'Waiting for supplier', colour: 'back' },
  { key: 'draft', label: 'Supplier preparing', colour: 'draft' },
  { key: 'approved', label: 'Approved to load', colour: 'ok' },
  { key: 'rejected', label: 'Rejected', colour: 'miss' }
];
export const BUNDLE_LABELS: Record<BundleStatus, { label: string; colour: string }> = {
  draft: { label: 'Not sent', colour: 'draft' },
  review: { label: 'Waiting for review', colour: 'wait' },
  final: { label: 'Final approval', colour: 'final' },
  approved: { label: 'Approved', colour: 'ok' },
  rejected: { label: 'Rejected', colour: 'miss' },
  retake: { label: 'New photo asked', colour: 'info' },
  unlocked: { label: 'Unlocked', colour: 'back' }
};

/**
 * The supplier's home groups (canvas "My POs"): what needs them first.
 *   needs_you  nothing offered on an open line yet, a new photo asked, an
 *              unlocked bundle, an unsent draft, or rejected slabs to replace
 *   waiting    something waits for Easy Stones
 *   approved   everything offered is approved and the PO is covered
 *   closed     closed or cancelled
 */
export type SupplierGroup = 'needs_you' | 'waiting' | 'approved' | 'closed';
export function supplierGroup(po: { status: PoStatus; lines: PoLine[] }, blocks: (BlockLike & { lineId: string })[]): SupplierGroup {
  if (po.status !== 'open') return 'closed';
  const stages = blocks.map(blockStage);
  if (stages.includes('supplier') || stages.includes('draft')) return 'needs_you';
  const cov = coverage(po.lines, blocks);
  if (isCovered(cov)) return stages.some((s) => s === 'review' || s === 'final') ? 'waiting' : 'approved';
  // Not covered: anything still with us counts as waiting; else it's theirs to offer more.
  if (stages.some((s) => s === 'review' || s === 'final')) {
    const short = cov.some((c) => c.approved + c.final + c.review < c.ordered);
    return short ? 'needs_you' : 'waiting';
  }
  return 'needs_you';
}

// ── Suppliers ───────────────────────────────────────────────────────────────

export type SupplierInput = { name?: unknown; spsName?: unknown; country?: unknown; language?: unknown; timeZone?: unknown; contactName?: unknown; email?: unknown; phone?: unknown; notes?: unknown };

export const isTimeZone = (tz: unknown) => {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

export function cleanSupplier(body: SupplierInput, languages: readonly string[]) {
  const problems: Record<string, string> = {};
  const name = clip(body.name, 80);
  if (!name) problems.name = 'Enter the supplier’s name';
  const email = clip(body.email, 120).toLowerCase();
  if (email && !isEmail(email)) problems.email = 'Enter a real email';
  const language = String(body.language || 'en');
  if (!languages.includes(language)) problems.language = 'Choose a language';
  const timeZone = String(body.timeZone || '');
  if (timeZone && !isTimeZone(timeZone)) problems.timeZone = 'Choose a time zone';
  const value = {
    name, spsName: clip(body.spsName, 80), country: clip(body.country, 60), language, timeZone,
    contactName: clip(body.contactName, 80), email, phone: clip(body.phone, 40), notes: clipText(body.notes, 1000)
  };
  return Object.keys(problems).length ? { problems } : { value, problems };
}

export function cleanLogin(body: { name?: unknown; email?: unknown; language?: unknown }, languages: readonly string[]) {
  const problems: Record<string, string> = {};
  const name = clip(body.name, 80);
  if (!name) problems.name = 'Enter the person’s name';
  const email = clip(body.email, 120).toLowerCase();
  if (!email) problems.email = 'Enter their email';
  else if (!isEmail(email)) problems.email = 'Enter a real email';
  const language = String(body.language || 'en');
  if (!languages.includes(language)) problems.language = 'Choose a language';
  return Object.keys(problems).length ? { problems } : { value: { name, email, language }, problems };
}

export const PASSWORD_MIN = 8;
export const passwordProblem = (pw: unknown) =>
  typeof pw !== 'string' || pw.length < PASSWORD_MIN ? 'short' : pw.length > 200 ? 'long' : '';

// ── Scorecard (Suppliers tab) ───────────────────────────────────────────────

const HOUR = 3_600_000;
const median = (list: number[]) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * A supplier's record over the blocks given (the route passes the last 180
 * days): bundles decided and the share rejected at either step, how long the
 * supplier takes from a PO being assigned to their first block (median hours)
 * and how long we take from a bundle being sent to its step-1 decision.
 */
export function scorecard(pos: { _id: unknown; assignedAt?: string | Date | null }[], blocks: { poId: unknown; firstSentAt?: string | Date | null; bundles: BundleLike[] }[]) {
  let decided = 0;
  let rejected = 0;
  let retakes = 0;
  const reviewHours: number[] = [];
  for (const b of blocks) {
    for (const bu of b.bundles) {
      const outcome = bu.step2?.decision === 'reject' || bu.step1?.decision === 'reject' ? 'reject' : bu.step2?.decision || bu.step1?.decision;
      if (bu.status === 'approved' || bu.status === 'rejected' || bu.status === 'final') {
        decided += 1;
        if (outcome === 'reject') rejected += 1;
      }
      if (bu.status === 'retake') retakes += 1;
      if (bu.sentAt && bu.step1?.at) reviewHours.push((new Date(bu.step1.at).getTime() - new Date(bu.sentAt).getTime()) / HOUR);
    }
  }
  const firstByPo = new Map<string, number>();
  for (const b of blocks) {
    if (!b.firstSentAt) continue;
    const t = new Date(b.firstSentAt).getTime();
    const k = String(b.poId);
    if (!firstByPo.has(k) || t < firstByPo.get(k)!) firstByPo.set(k, t);
  }
  const supplierHours: number[] = [];
  for (const po of pos) {
    const first = firstByPo.get(String(po._id));
    if (first && po.assignedAt) supplierHours.push((first - new Date(po.assignedAt).getTime()) / HOUR);
  }
  return {
    bundlesDecided: decided,
    rejectionRate: decided ? Math.round((rejected / decided) * 100) : null,
    retakes,
    supplierHours: median(supplierHours.filter((h) => h >= 0)),
    reviewHours: median(reviewHours.filter((h) => h >= 0))
  };
}

/** "3 h", "2 days", "—". */
export function hoursText(h: number | null | undefined): string {
  if (h == null) return '—';
  if (h < 1) return '< 1 h';
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}
