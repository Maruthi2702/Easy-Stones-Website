// Supplier POs' rules (src/utils/supplierBlocks.ts): sending a block, the two
// approval steps and the same-person rule, unlocking, where a block / PO
// stands, coverage, the supplier's home groups, PO cleaning and the scorecard.
import { describe, it, expect } from 'vitest';
import {
  sendProblems, applySend, withNewPhoto, decisionProblem, applyDecision, decidable, unlockProblem, blockStage, blockCounts,
  coverage, isCovered, poStage, supplierGroup, cleanPo, poKey, poChanges, lineRemovalProblem, parseSize, sizeText,
  cleanSupplier, cleanLogin, scorecard, hoursText, noteFor, slabsProblem, applyEntry, isStoredPhotoUrl, type BundleLike, type PoLine
} from './supplierBlocks';

const b = (n: number, o: Partial<BundleLike> = {}): BundleLike => ({ id: `b${n}`, n, slabs: 8, photoUrl: `https://x/${n}.webp`, status: 'draft', ...o });
const block = (bundles: BundleLike[], o: Record<string, unknown> = {}) => ({ blockNumber: '3317', size: { length: 124, height: 76, unit: 'in' as const }, bundles, sentAt: null, lineId: 'L1', ...o });
const RAVI = { id: 'ravi', name: 'Ravi Shah' };
const DANA = { id: 'dana', name: 'Dana Whitfield' };
const at = new Date('2026-11-06T18:00:00Z');

describe('sending a block', () => {
  it('needs a block #, a size and a photo + slab count on every bundle the supplier can change', () => {
    expect(sendProblems(block([b(1), b(2)])).ok).toBe(true);
    const bad = sendProblems(block([b(1, { photoUrl: '' }), b(2, { slabs: null })], { blockNumber: ' ', size: null }));
    expect(bad.ok).toBe(false);
    expect(bad.problems.block).toEqual({ blockNumber: 'blockNumber', size: 'size' });
    expect(bad.problems.bundles).toEqual({ b1: ['photo'], b2: ['slabs'] });
  });
  it('ignores bundles already with Easy Stones, and refuses when nothing is left to send', () => {
    expect(sendProblems(block([b(1, { status: 'review' }), b(2)])).toSend).toEqual(['b2']);
    expect(sendProblems(block([b(1, { status: 'approved' })])).problems.block.bundles).toBe('nothingToSend');
  });
  it('a bundle sent back for a new photo needs a photo taken after it was sent', () => {
    const sentAt = '2026-11-05T10:00:00Z';
    expect(sendProblems(block([b(1, { status: 'retake', sentAt, photoAt: '2026-11-05T09:00:00Z' })])).problems.bundles.b1).toEqual(['newPhoto']);
    expect(sendProblems(block([b(1, { status: 'retake', sentAt, photoAt: '2026-11-06T09:00:00Z' })])).ok).toBe(true);
  });
  it('sends every changeable bundle to step 1 with both steps cleared and the round counted', () => {
    const sent = applySend([b(1), b(2, { status: 'retake', round: 1, reason: 'dark', step1: { decision: 'retake', by: 'ravi', byName: 'Ravi', at } }), b(3, { status: 'final' })], at);
    expect(sent.map((x) => [x.status, x.round || 0, x.step1 ?? null, x.reason || ''])).toEqual([['review', 1, null, ''], ['review', 2, null, ''], ['final', 0, null, '']]);
  });
  it('keeps the photo a retake replaces', () => {
    const next = withNewPhoto(b(1, { status: 'retake' }), 'https://x/new.webp', at);
    expect(next.photoUrl).toBe('https://x/new.webp');
    expect(next.previousPhotos?.map((p) => p.url)).toEqual(['https://x/1.webp']);
    expect(withNewPhoto(b(1), 'https://x/again.webp', at).previousPhotos).toEqual([]);
  });
  it('checks slab counts', () => {
    expect(slabsProblem(8)).toBe('');
    expect(slabsProblem('9')).toBe('');
    expect(slabsProblem(0)).toBe('slabs');
    expect(slabsProblem('7.5')).toBe('slabs');
    expect(slabsProblem(null)).toBe('slabs');
  });
});

describe('the two steps', () => {
  const inReview = [b(1, { status: 'review' }), b(2, { status: 'review' }), b(3, { status: 'final', step1: { decision: 'approve', by: 'ravi', byName: 'Ravi', at } })];
  it('step 1 decides bundles waiting for review only, with a reason for reject and a new photo', () => {
    expect(decisionProblem(1, inReview, [{ bundleId: 'b1', decision: 'approve' }], RAVI)).toBeNull();
    expect(decisionProblem(1, inReview, [{ bundleId: 'b3', decision: 'approve' }], RAVI)).toMatch(/isn’t waiting for review/);
    expect(decisionProblem(1, inReview, [{ bundleId: 'b1', decision: 'reject' }], RAVI)).toMatch(/Choose why for bundle 1/);
    expect(decisionProblem(1, inReview, [{ bundleId: 'b1', decision: 'reject', reason: 'dark' }], RAVI)).toMatch(/Choose why/);
    expect(decisionProblem(1, inReview, [{ bundleId: 'b1', decision: 'retake', reason: 'dark' }], RAVI)).toBeNull();
    expect(decisionProblem(1, inReview, [{ bundleId: 'b1', decision: 'reject', reason: 'other' }], RAVI)).toMatch(/Say what’s wrong/);
    expect(decisionProblem(1, inReview, [{ bundleId: 'b1', decision: 'approve' }, { bundleId: 'b1', decision: 'approve' }], RAVI)).toMatch(/twice/);
    expect(decisionProblem(1, inReview, [], RAVI)).toMatch(/at least one/);
  });
  it('nobody gives final approval to a bundle they approved in step 1', () => {
    expect(decisionProblem(2, inReview, [{ bundleId: 'b3', decision: 'approve' }], RAVI)).toMatch(/someone else/);
    expect(decisionProblem(2, inReview, [{ bundleId: 'b3', decision: 'approve' }], DANA)).toBeNull();
    expect(decisionProblem(2, inReview, [{ bundleId: 'b3', decision: 'approve' }], RAVI, true)).toBeNull();
    expect(decidable(inReview, 2, 'ravi').map((x) => x.id)).toEqual([]);
    expect(decidable(inReview, 2, 'dana').map((x) => x.id)).toEqual(['b3']);
    expect(decidable(inReview, 1, 'ravi').map((x) => x.id)).toEqual(['b1', 'b2']);
  });
  it('moves bundles: approve → final → approved; reject → rejected; new photo → retake', () => {
    const one = applyDecision(inReview[0]!, 1, { bundleId: 'b1', decision: 'approve' }, RAVI, at, null);
    expect(one.status).toBe('final');
    expect(one.step1).toMatchObject({ decision: 'approve', by: 'ravi', byName: 'Ravi Shah' });
    const two = applyDecision(one, 2, { bundleId: 'b1', decision: 'approve' }, DANA, at, null);
    expect(two.status).toBe('approved');
    expect(two.step2?.by).toBe('dana');
    const note = { text: 'Crack mid-slab', lang: 'en' };
    const rej = applyDecision(inReview[1]!, 1, { bundleId: 'b2', decision: 'reject', reason: 'cracks' }, RAVI, at, note);
    expect([rej.status, rej.reason, rej.comment]).toEqual(['rejected', 'cracks', note]);
    expect(applyDecision(one, 2, { bundleId: 'b1', decision: 'retake', reason: 'wet' }, DANA, at, null).status).toBe('retake');
  });
  it('unlocks approved bundles only, with a reason', () => {
    const list = [b(1, { status: 'approved' }), b(2, { status: 'final' })];
    expect(unlockProblem(list, ['b1'], 'Supplier swapped slab 3')).toBeNull();
    expect(unlockProblem(list, ['b1'], ' ')).toMatch(/Say why/);
    expect(unlockProblem(list, ['b2'], 'x')).toMatch(/isn’t approved/);
  });
});

describe('where a block and a PO stand', () => {
  it('a block: draft until sent; then review, final, supplier, approved, rejected', () => {
    expect(blockStage({ bundles: [b(1)], sentAt: null })).toBe('draft');
    expect(blockStage({ bundles: [b(1, { status: 'review' }), b(2, { status: 'final' })], sentAt: at })).toBe('review');
    expect(blockStage({ bundles: [b(1, { status: 'final' }), b(2, { status: 'retake' })], sentAt: at })).toBe('final');
    expect(blockStage({ bundles: [b(1, { status: 'approved' }), b(2, { status: 'retake' })], sentAt: at })).toBe('supplier');
    expect(blockStage({ bundles: [b(1, { status: 'approved' }), b(2, { status: 'rejected' })], sentAt: at })).toBe('approved');
    expect(blockStage({ bundles: [b(1, { status: 'rejected' })], sentAt: at })).toBe('rejected');
    expect(blockCounts([b(1, { status: 'approved' }), b(2, { status: 'approved', slabs: 7 })]).slabs.approved).toBe(15);
  });
  const lines: PoLine[] = [{ id: 'L1', material: 'Taj Mahal', thickness: '3 cm', finish: 'Polished', slabs: 16, note: '' }];
  it('coverage counts sent bundles by where they stand, per line', () => {
    const blocks = [
      block([b(1, { status: 'approved' }), b(2, { status: 'final' }), b(3, { status: 'rejected' })], { sentAt: at }),
      block([b(4)], { sentAt: null })
    ];
    expect(coverage(lines, blocks)[0]).toMatchObject({ ordered: 16, approved: 8, final: 8, review: 0, rejected: 8, offered: 16 });
    expect(isCovered(coverage(lines, blocks))).toBe(false);
    expect(isCovered(coverage(lines, [block([b(1, { status: 'approved' }), b(2, { status: 'approved' })], { sentAt: at })]))).toBe(true);
  });
  it('a PO: what waits on us first, then covered, else the supplier', () => {
    expect(poStage({ status: 'open', lines }, [])).toBe('supplier');
    expect(poStage({ status: 'open', lines }, [block([b(1, { status: 'review' })], { sentAt: at })])).toBe('review');
    expect(poStage({ status: 'open', lines }, [block([b(1, { status: 'approved' }), b(2, { status: 'approved' })], { sentAt: at })])).toBe('covered');
    expect(poStage({ status: 'cancelled', lines }, [])).toBe('cancelled');
  });
  it('the supplier’s groups: needs you, waiting for Easy Stones, approved to load, closed', () => {
    expect(supplierGroup({ status: 'open', lines }, [])).toBe('needs_you');
    expect(supplierGroup({ status: 'open', lines }, [block([b(1, { status: 'review' }), b(2, { status: 'review' })], { sentAt: at })])).toBe('waiting');
    // Half offered and waiting: the rest is still theirs to offer.
    expect(supplierGroup({ status: 'open', lines }, [block([b(1, { status: 'review' })], { sentAt: at })])).toBe('needs_you');
    expect(supplierGroup({ status: 'open', lines }, [block([b(1, { status: 'retake' }), b(2, { status: 'final' })], { sentAt: at })])).toBe('needs_you');
    expect(supplierGroup({ status: 'open', lines }, [block([b(1, { status: 'approved' }), b(2, { status: 'approved' })], { sentAt: at })])).toBe('approved');
    expect(supplierGroup({ status: 'closed', lines }, [])).toBe('closed');
  });
});

describe('POs', () => {
  let n = 0;
  const newId = () => `${String(++n).padStart(24, 'a')}`;
  it('cleans a typed PO: number upper-cased, a supplier, ship to, materials with slabs', () => {
    const { value } = cleanPo({ poNumber: ' po 41872 ', supplierId: 's1', shipTo: 'Seattle', readyBy: '2026-12-04', lines: [{ material: 'Taj Mahal Quartzite', thickness: '3 cm', slabs: '240' }], note: 'Wet photos please' }, { newId, today: '2026-11-07' });
    expect(value).toMatchObject({ poNumber: 'PO 41872', supplierId: 's1', shipTo: 'Seattle', readyBy: '2026-12-04', note: 'Wet photos please' });
    expect(value!.lines[0]).toMatchObject({ material: 'Taj Mahal Quartzite', thickness: '3 cm', slabs: 240 });
    const bad = cleanPo({ poNumber: '', lines: [{ material: '', slabs: 'x' }] }, { newId });
    expect(bad.problems).toMatchObject({ poNumber: 'Enter the PO #', supplierId: 'Choose the supplier', shipTo: 'Choose where it ships to', lines: 'Check the materials' });
    expect(cleanPo({ poNumber: '1', supplierId: 's', shipTo: 'Kent', lines: [] }, { newId }).problems.lines).toBe('Add at least one material');
    expect(cleanPo({ poNumber: '1', supplierId: 's', shipTo: 'Kent', readyBy: '2026-02-30', lines: [{ material: 'x', slabs: 1 }] }, { newId }).problems.readyBy).toBe('Pick a real date');
  });
  it('one key for typed and imported numbers', () => {
    expect(poKey(' 41872 ')).toBe('41872');
    expect(poKey('po  41872')).toBe('PO 41872');
  });
  it('says what changed, and refuses to drop a line that has blocks', () => {
    const before = { shipTo: 'Seattle', readyBy: '2026-11-20', lines: [{ id: 'L1', material: 'Taj', thickness: '3 cm', finish: '', slabs: 240, note: '' }] };
    const after = { shipTo: 'Kent', readyBy: '2026-12-04', lines: [{ id: 'L1', material: 'Taj', thickness: '3 cm', finish: '', slabs: 260, note: '' }, { id: 'L2', material: 'Fusion', thickness: '2 cm', finish: '', slabs: 40, note: '' }] };
    expect(poChanges(before, after)).toEqual(['ship to Seattle → Kent', 'ready by 2026-11-20 → 2026-12-04', 'Taj: 240 → 260 slabs', 'added Fusion (40 slabs)']);
    expect(lineRemovalProblem(after.lines, before.lines, { L2: 1 })).toMatch(/Fusion already has 1 block/);
    expect(lineRemovalProblem(after.lines, before.lines, {})).toBeNull();
  });
});

describe('sizes, suppliers and logins', () => {
  it('reads a size in inches or centimetres and shows both', () => {
    expect(parseSize('124', '76', 'in')).toEqual({ length: 124, height: 76, unit: 'in' });
    expect(parseSize('315', '193,5', 'cm')).toEqual({ length: 315, height: 193.5, unit: 'cm' });
    expect(parseSize('5', '76', 'in')).toBeNull();
    expect(sizeText({ length: 124, height: 76, unit: 'in' })).toBe('124 × 76 in · 315 × 193 cm');
    expect(sizeText({ length: 315, height: 193, unit: 'cm' })).toBe('315 × 193 cm · 124 × 76 in');
  });
  it('cleans a supplier and a login', () => {
    expect(cleanSupplier({ name: ' Pedras Vale Verde ', language: 'pt', timeZone: 'America/Sao_Paulo', email: 'Ana@PVV.com.br' }, ['en', 'pt']).value).toMatchObject({ name: 'Pedras Vale Verde', email: 'ana@pvv.com.br' });
    expect(cleanSupplier({ name: '', language: 'xx', timeZone: 'Mars/Base', email: 'nope' }, ['en']).problems).toEqual({ name: 'Enter the supplier’s name', language: 'Choose a language', timeZone: 'Choose a time zone', email: 'Enter a real email' });
    expect(cleanLogin({ name: 'Marcos', email: 'marcos@pvv.com.br', language: 'pt' }, ['en', 'pt']).value).toEqual({ name: 'Marcos', email: 'marcos@pvv.com.br', language: 'pt' });
    expect(cleanLogin({ name: '', email: '' }, ['en']).problems).toEqual({ name: 'Enter the person’s name', email: 'Enter their email' });
  });
  it('shows a note in the reader’s language, keeping the original', () => {
    const note = { text: 'O bundle 6 tem uma trinca', lang: 'pt', translations: { en: 'Bundle 6 has a crack' } };
    expect(noteFor(note, 'en')).toMatchObject({ text: 'Bundle 6 has a crack', original: 'O bundle 6 tem uma trinca', translated: true, foreign: true });
    expect(noteFor(note, 'pt')).toMatchObject({ text: 'O bundle 6 tem uma trinca', translated: false, foreign: false });
    expect(noteFor({ text: 'Sem tradução', lang: 'pt' }, 'en')).toMatchObject({ text: 'Sem tradução', translated: false, foreign: true });
    expect(noteFor(null, 'en')).toBeNull();
  });
});

describe('the scorecard', () => {
  it('rejection rate over decided bundles, and median hours each side takes', () => {
    const pos = [{ _id: 'p1', assignedAt: '2026-11-01T00:00:00Z' }, { _id: 'p2', assignedAt: '2026-11-02T00:00:00Z' }];
    const step = (decision: 'approve' | 'reject', iso: string) => ({ decision, by: 'r', byName: 'R', at: iso });
    const blocks = [
      { poId: 'p1', firstSentAt: '2026-11-01T10:00:00Z', bundles: [
        b(1, { status: 'approved', sentAt: '2026-11-01T10:00:00Z', step1: step('approve', '2026-11-01T14:00:00Z'), step2: step('approve', '2026-11-02T00:00:00Z') }),
        b(2, { status: 'rejected', sentAt: '2026-11-01T10:00:00Z', step1: step('reject', '2026-11-01T12:00:00Z') }),
        b(3, { status: 'retake' })
      ] },
      { poId: 'p2', firstSentAt: '2026-11-03T00:00:00Z', bundles: [b(4, { status: 'final', sentAt: '2026-11-03T00:00:00Z', step1: step('approve', '2026-11-03T06:00:00Z') })] }
    ];
    expect(scorecard(pos, blocks)).toEqual({ bundlesDecided: 3, rejectionRate: 33, retakes: 1, supplierHours: 17, reviewHours: 4 });
    expect(scorecard([], [])).toEqual({ bundlesDecided: 0, rejectionRate: null, retakes: 0, supplierHours: null, reviewHours: null });
    expect([hoursText(null), hoursText(0.4), hoursText(17), hoursText(72)]).toEqual(['—', '< 1 h', '17 h', '3 days']);
  });
});

describe('purchasing entering a block for its supplier', () => {
  const CDN = (x: string) => `https://res.cloudinary.com/es/SupplierBlocks/${x}.webp`;
  const hex = (n: number) => n.toString(16).padStart(24, '0');

  it('only takes photos we stored', () => {
    expect(isStoredPhotoUrl(CDN('a'))).toBe(true);
    expect(isStoredPhotoUrl('https://evil.test/a.jpg')).toBe(false);
    expect(isStoredPhotoUrl('data:image/jpeg;base64,xx')).toBe(false);
  });

  it('a new block: every bundle numbered in order, as drafts ready to send', () => {
    const { bundles, problem } = applyEntry([], [{ id: hex(1), slabs: 8, photoUrl: CDN('1') }, { id: hex(2), slabs: '7', photoUrl: CDN('2') }], at);
    expect(problem).toBeNull();
    expect(bundles.map((x) => [x.n, x.slabs, x.status])).toEqual([[1, 8, 'draft'], [2, 7, 'draft']]);
    expect(sendProblems({ ...block(bundles) }).ok).toBe(true);
  });

  it('a new photo for a retake keeps the old one; locked bundles can’t change; untouched ones stay', () => {
    const sent = '2026-11-05T10:00:00Z';
    const start = [b(1, { status: 'final', round: 1 }), b(2, { status: 'retake', round: 1, sentAt: sent, photoAt: sent }), b(3, { status: 'rejected', round: 1 })];
    const ok = applyEntry(start, [{ id: 'b2', slabs: 8, photoUrl: CDN('new') }, { id: hex(9), slabs: 5, photoUrl: CDN('9') }], at);
    expect(ok.problem).toBeNull();
    const b2 = ok.bundles.find((x) => x.id === 'b2')!;
    expect(b2.photoUrl).toBe(CDN('new'));
    expect(b2.previousPhotos?.map((p) => p.url)).toEqual(['https://x/2.webp']);
    expect(ok.bundles.find((x) => x.id === hex(9))).toMatchObject({ n: 4, status: 'draft' });
    expect(ok.bundles.find((x) => x.id === 'b1')).toBe(start[0]);
    expect(sendProblems(block(ok.bundles, { sentAt: sent })).toSend).toEqual(['b2', hex(9)]);
    expect(applyEntry(start, [{ id: 'b1', slabs: 9 }], at).problem).toMatch(/Bundle 1 is with Easy Stones/);
    expect(applyEntry(start, [{ id: 'b2', photoUrl: 'https://evil.test/x.jpg' }], at).problem).toMatch(/didn’t upload/);
  });

  it('a draft never sent and left out is removed; a retake left out still needs its new photo', () => {
    const start = [b(1, { status: 'draft' }), b(2, { status: 'retake', round: 1, sentAt: '2026-11-05T10:00:00Z', photoAt: '2026-11-05T09:00:00Z' })];
    const { bundles } = applyEntry(start, [], at);
    expect(bundles.map((x) => x.id)).toEqual(['b2']);
    expect(sendProblems(block(bundles, { sentAt: '2026-11-05T10:00:00Z' })).problems.bundles.b2).toEqual(['newPhoto']);
  });

  it('refuses a bundle listed twice and more than 20', () => {
    expect(applyEntry([], [{ id: hex(1) }, { id: hex(1) }], at).problem).toMatch(/twice/);
    expect(applyEntry([], Array.from({ length: 21 }, (_, i) => ({ id: hex(i + 1) })), at).problem).toMatch(/up to 20/);
  });
});
