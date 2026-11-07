import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Lock, Maximize2, RotateCcw, Unlock, X } from 'lucide-react';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';
import { FormPicker, SegmentedToggle } from '../../../components/shared/form/FormControls';
import { languageEnglish, t } from '../../../utils/supplierI18n';
import { noteFor, sizeText, type Step } from '../../../utils/supplierBlocks';
import { blockStageOf, bundleLabelOf, stepStrip, theirTime, timeAgo, whenText, dayText } from '../supplierPosView';
import BundleViewer, { type Choice } from './BundleViewer';
import { Chip } from './PoList';
import type { Block, Bundle, Meta } from '../types';

export type BlockReviewProps = {
  block: Block;
  meta: Meta;
  canReview: boolean;
  canFinal: boolean;
  canUnlock: boolean;
  /** "2 of 5" in the queue it was opened from. */
  position: { index: number; count: number } | null;
  onStep: (by: number) => void;
  onDecide: (step: Step, decisions: { bundleId: string; decision: Choice['decision']; reason?: string; comment?: string }[], note: string) => Promise<unknown>;
  onUnlock: () => void;
  onOpenPo: () => void;
  onClose: () => void;
};

const reasonLabel = (decision: string, reason?: string) => (reason ? t('en', `${decision === 'retake' ? 'p' : 'r'}_${reason}` as never) : '');
const decisionWord = (d: string) => (d === 'approve' ? 'approved' : d === 'reject' ? 'rejected' : 'new photo asked');

/**
 * A block opened from a queue, a PO or an email link. For someone who may
 * decide it, the step waiting for them: every bundle's photo with Approve /
 * Reject / New photo (a reason from the list, a comment if they like), or
 * the whole block at once; a message to the supplier, machine-translated
 * when that's switched on; Send when every bundle is decided. Step 2 shows
 * what step 1 decided, and never offers a bundle the same person approved.
 * Approved bundles show their lock; Unlock asks for a reason.
 */
export default function BlockReview({ block, meta, canReview, canFinal, canUnlock, position, onStep, onDecide, onUnlock, onOpenPo, onClose }: BlockReviewProps) {
  const steps: Step[] = [];
  if (canReview && block.counts.review) steps.push(1);
  if (canFinal && block.counts.final) steps.push(2);
  const [step, setStep] = useState<Step | null>(steps[0] ?? null);
  const [mode, setMode] = useState<'bundle' | 'block'>('bundle');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState('');
  const [writing, setWriting] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { lockPage(); return () => unlockPage(); }, []);
  // Another block (the arrows), or the same block answered back after Send.
  useEffect(() => {
    const next: Step[] = [];
    if (canReview && block.counts.review) next.push(1);
    if (canFinal && block.counts.final) next.push(2);
    setStep((s) => (s && next.includes(s) ? s : next[0] ?? null));
    setChoices({}); setNote(''); setWriting(false); setError(''); setMode('bundle');
  }, [block.id, block.updatedAt, canReview, canFinal, block.counts.review, block.counts.final]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && viewing === null) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, viewing]);

  const waitingStatus = step === 1 ? 'review' : step === 2 ? 'final' : '';
  const decidable = useMemo(() => new Set(step ? block.decidable[step] : []), [block, step]);
  const inStep = block.bundles.filter((b) => b.status === waitingStatus);
  const mineToDecide = inStep.filter((b) => decidable.has(b.id));
  const notMine = inStep.filter((b) => !decidable.has(b.id));
  const undecided = mineToDecide.filter((b) => !choices[b.id]);
  const needsReason = mineToDecide.find((b) => choices[b.id] && choices[b.id]!.decision !== 'approve' && !choices[b.id]!.reason);
  const needsComment = mineToDecide.find((b) => choices[b.id]?.reason === 'other' && !choices[b.id]?.comment?.trim());
  const counts = { approve: 0, reject: 0, retake: 0 };
  for (const b of mineToDecide) if (choices[b.id]) counts[choices[b.id]!.decision] += 1;
  const approvedSlabs = mineToDecide.filter((b) => choices[b.id]?.decision === 'approve').reduce((s, b) => s + (Number(b.slabs) || 0), 0);
  const choose = (id: string, c: Choice | null) => setChoices((all) => {
    const next = { ...all };
    if (c) next[id] = { ...all[id], ...c, comment: c.comment ?? all[id]?.comment ?? '' }; else delete next[id];
    return next;
  });
  const setAll = (c: Choice | null) => setChoices(() => (c ? Object.fromEntries(mineToDecide.map((b) => [b.id, { ...c }])) : {}));

  const send = async () => {
    if (!step) return;
    setBusy(true);
    setError('');
    try {
      await onDecide(step, mineToDecide.map((b) => ({ bundleId: b.id, ...choices[b.id]! })), note.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const st = blockStageOf(block.stage);
  const strip = stepStrip(block);
  const supplierNote = noteFor(block.note, 'en');
  const [showOriginal, setShowOriginal] = useState(false);
  const stepName = step === 1 ? 'Step 1 · Review' : 'Step 2 · Final approval';
  const sendLabel = undecided.length
    ? `Decide bundle${undecided.length === 1 ? '' : 's'} ${undecided.map((b) => b.n).join(', ')} first`
    : needsReason ? `Choose why for bundle ${needsReason.n}`
    : needsComment ? `Say what’s wrong with bundle ${needsComment.n}`
    : step === 2 && counts.approve === mineToDecide.length ? `Final approval · ${counts.approve} bundle${counts.approve === 1 ? '' : 's'}, ${approvedSlabs} slabs`
    : step === 1 && counts.approve === mineToDecide.length ? `Approve · ${counts.approve} bundle${counts.approve === 1 ? '' : 's'}, ${approvedSlabs} slabs`
    : 'Send decisions';
  const lockedApproved = block.bundles.filter((b) => b.status === 'approved');
  const languages = meta.translation ? 'Translated for the supplier automatically.' : 'The supplier reads it as you type it (translation isn’t switched on).';

  return (
    <>
      <div className="sp-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="sp-drawer is-wide fm-tokens" role="dialog" aria-modal="true" aria-label={`Block ${block.blockNumber}`}>
        <header className="sp-drawer-h">
          <div className="sp-drawer-ttl">
            <div className="sp-row"><h2>Block {block.blockNumber}</h2><Chip colour={st.colour}>{st.label}</Chip></div>
            <span className="sp-sub is-13">{block.material}{block.thickness ? ` ${block.thickness}` : ''}{block.finish ? ` · ${block.finish}` : ''}{block.size ? ` · ${sizeText(block.size)}` : ''}</span>
            <span className="sp-sub is-13">
              <button type="button" className="sp-link" onClick={onOpenPo}>PO {block.poNumber}</button> · {block.supplierName}{block.supplierCountry ? ` (${block.supplierCountry})` : ''}
              {block.supplierTimeZone ? ` · ${theirTime(block.supplierTimeZone)}` : ''} · ships to {block.shipTo}{block.readyBy ? `, ready by ${dayText(block.readyBy)}` : ''}
            </span>
          </div>
          <div className="sp-drawer-nav">
            {position && position.count > 1 ? (
              <>
                <span className="sp-sub">{position.index + 1} of {position.count}</span>
                <button type="button" className="sp-round is-small" aria-label="Previous block" onClick={() => onStep(-1)} disabled={position.index === 0}><ChevronLeft size={16} /></button>
                <button type="button" className="sp-round is-small" aria-label="Next block" onClick={() => onStep(1)} disabled={position.index >= position.count - 1}><ChevronRight size={16} /></button>
              </>
            ) : null}
            <button type="button" className="sp-x" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
          </div>
        </header>

        <div className="sp-drawer-b fm-sheet-body">
          <ol className="sp-steps" aria-label="Where this block is">
            <li className="is-done"><b>Offered</b><span>{timeAgo(strip.offered)}</span></li>
            <li className={strip.step1.done ? 'is-done' : block.counts.review ? 'is-now' : ''}><b>Step 1 · Review</b><span>{strip.step1.by || (block.counts.review ? 'waiting' : '—')}</span></li>
            <li className={strip.step2.done ? 'is-done' : block.counts.final ? 'is-now' : ''}><b>Step 2 · Final</b><span>{strip.step2.by || (block.counts.final ? 'waiting' : '—')}</span></li>
            <li className={strip.approved ? 'is-done' : ''}><b>Approved to load</b><span>{block.counts.approved ? `${block.counts.slabs.approved} slabs` : '—'}</span></li>
          </ol>

          {supplierNote ? (
            <div className="sp-note">
              <span className="sp-note-k">Note from {block.supplierName}</span>
              <span>{showOriginal ? supplierNote.original : supplierNote.text}</span>
              {supplierNote.foreign ? (
                <span className="sp-sub">
                  {supplierNote.translated ? `Translated from ${languageEnglish(supplierNote.fromLang)} · ` : `In ${languageEnglish(supplierNote.fromLang)} · `}
                  {supplierNote.translated ? <button type="button" className="sp-link" onClick={() => setShowOriginal((v) => !v)}>{showOriginal ? 'Show translation' : 'Show original'}</button> : null}
                </span>
              ) : null}
            </div>
          ) : null}

          {steps.length > 1 ? (
            <SegmentedToggle label="Step" value={step as Step} onChange={(s) => { setStep(s); setChoices({}); }}
              options={[{ value: 1 as Step, label: `Step 1 · ${block.counts.review} to review` }, { value: 2 as Step, label: `Step 2 · ${block.counts.final} for final approval` }]} />
          ) : null}

          {step && mineToDecide.length ? (
            <div className="sp-review-bar">
              <b>{stepName}</b>
              <span className="sp-sub">{mineToDecide.length} bundle{mineToDecide.length === 1 ? '' : 's'} to decide · click a photo to see it large (A / R / N to decide there)</span>
              <div className="sp-review-mode">
                <SegmentedToggle label="Decide" value={mode} onChange={(m) => { setMode(m); setChoices({}); }}
                  options={[{ value: 'bundle', label: 'Bundle by bundle' }, { value: 'block', label: 'Whole block' }]} />
              </div>
            </div>
          ) : step === 2 && notMine.length && !mineToDecide.length ? (
            <div className="sp-banner is-warn">You approved {notMine.length === 1 ? 'this bundle' : 'these bundles'} in step 1, so someone else gives the final approval.</div>
          ) : null}

          {step && mode === 'block' && mineToDecide.length ? (
            <WholeBlock bundles={mineToDecide} choices={choices} setAll={setAll} reasons={meta.reasons} />
          ) : null}

          <div className="sp-bundles">
            {block.bundles.map((b, i) => (
              <BundleCard
                key={b.id}
                bundle={b}
                decide={mode === 'bundle' && decidable.has(b.id)}
                faded={Boolean(step) && b.status !== waitingStatus}
                choice={choices[b.id]}
                onChoose={(c) => choose(b.id, c)}
                onView={() => setViewing(i)}
                reasons={meta.reasons}
              />
            ))}
          </div>

          {lockedApproved.length ? (
            <div className="sp-lock">
              <Lock size={16} aria-hidden="true" />
              <span>{lockedApproved.length} approved bundle{lockedApproved.length === 1 ? ' is' : 's are'} locked: the supplier may load {lockedApproved.length === 1 ? 'it' : 'them'} and can’t change {lockedApproved.length === 1 ? 'it' : 'them'}.</span>
              {canUnlock && block.poStatus === 'open' ? <button type="button" className="sp-btn is-small" onClick={onUnlock}><Unlock size={14} /> Unlock…</button> : null}
            </div>
          ) : null}

          {block.decisionNote ? (
            <div className="sp-note is-ours">
              <span className="sp-note-k">Last message to the supplier · {block.decisionNote.by}</span>
              <span>{block.decisionNote.text}</span>
            </div>
          ) : null}

          <details className="sp-history">
            <summary>History · {block.history.length}</summary>
            <ol>
              {[...block.history].reverse().map((h, i) => (
                <li key={i}><span className="sp-sub">{whenText(h.at)}</span> <b>{h.by}</b>{h.side === 'supplier' ? ' (supplier)' : ''} {h.action}{h.changes ? ` — ${h.changes}` : ''}</li>
              ))}
            </ol>
          </details>
        </div>

        {step && mineToDecide.length ? (
          <footer className="sp-drawer-f">
            {error ? <div className="sp-banner is-error" role="alert">{error}</div> : null}
            <div className="sp-tally">
              <span className="sp-chip is-ok">{counts.approve} approve</span>
              <span className="sp-chip is-miss">{counts.reject} reject</span>
              <span className="sp-chip is-info">{counts.retake} new photo</span>
              {undecided.length ? <span className="sp-sub">{undecided.length} to decide</span> : null}
            </div>
            {writing || note || counts.reject || counts.retake ? (
              <>
                <label htmlFor="sp-note">Message to {block.supplierName} <span className="sp-sub">(optional · {languages})</span></label>
                <textarea id="sp-note" rows={1} maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Bundle 6 has a crack across slab 3. Please retake 7 in daylight, wet." />
              </>
            ) : <button type="button" className="sp-link sp-self-start" onClick={() => setWriting(true)}>Add a message to {block.supplierName}</button>}
            <div className="sp-drawer-actions">
              <button type="button" className="sp-btn is-gold" disabled={busy || Boolean(undecided.length) || Boolean(needsReason) || Boolean(needsComment)} onClick={send}>
                {busy ? 'Sending…' : sendLabel}
              </button>
            </div>
          </footer>
        ) : null}
      </aside>

      {viewing !== null ? (
        <BundleViewer
          bundles={block.bundles}
          index={viewing}
          onIndex={setViewing}
          decidable={mode === 'bundle' ? decidable : new Set()}
          choices={choices}
          onChoose={choose}
          reasons={meta.reasons}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  );
}

function BundleCard({ bundle: b, decide, faded, choice, onChoose, onView, reasons }: {
  bundle: Bundle; decide: boolean; faded: boolean; choice?: Choice; onChoose: (c: Choice | null) => void; onView: () => void;
  reasons: { reject: readonly string[]; retake: readonly string[] };
}) {
  const label = bundleLabelOf(b.status);
  const kind = choice?.decision;
  const reasonList = kind === 'reject' ? reasons.reject : reasons.retake;
  return (
    <div className={`sp-bundle${faded ? ' is-faded' : ''}${kind ? ` is-${kind}` : ''}`}>
      <button type="button" className="sp-bphoto" onClick={onView} aria-label={`See bundle ${b.n} large`}>
        {b.photoUrl ? <img src={b.photoUrl} alt="" loading="lazy" /> : <span className="sp-bnone">No photo</span>}
        <span className="sp-bzoom" aria-hidden="true"><Maximize2 size={14} /></span>
        {b.round > 1 ? <span className="sp-bround">Photo {b.round}</span> : null}
        {b.status === 'approved' ? <span className="sp-block-lock" aria-label="Locked"><Lock size={13} /></span> : null}
      </button>
      <div className="sp-bmeta">
        <b>Bundle {b.n}</b><span className="sp-sub">{b.slabs ?? '—'} slabs</span>
        {!decide ? <span className={`sp-chip is-${label.colour}`}>{label.label}</span> : null}
      </div>
      {b.step1 && (b.status === 'final' || !decide) ? (
        <span className="sp-sub">Step 1: {decisionWord(b.step1.decision)} by {b.step1.byName}{b.step1.reason ? ` · ${reasonLabel(b.step1.decision, b.step1.reason)}` : ''}</span>
      ) : null}
      {b.step2 && !decide ? <span className="sp-sub">Step 2: {decisionWord(b.step2.decision)} by {b.step2.byName}{b.step2.reason ? ` · ${reasonLabel(b.step2.decision, b.step2.reason)}` : ''}</span> : null}
      {(b.status === 'rejected' || b.status === 'retake') && b.comment?.text ? <span className="sp-sub">“{b.comment.text}”</span> : null}
      {b.unlock && b.status === 'unlocked' ? <span className="sp-sub">Unlocked by {b.unlock.by}: {b.unlock.reason}</span> : null}
      {decide ? (
        <>
          <div className="sp-decide" role="group" aria-label={`Bundle ${b.n}`}>
            <button type="button" className={`sp-dbtn is-ok${kind === 'approve' ? ' is-on' : ''}`} aria-pressed={kind === 'approve'} onClick={() => onChoose(kind === 'approve' ? null : { decision: 'approve' })}><Check size={17} strokeWidth={2.4} /> Approve</button>
            <button type="button" className={`sp-dbtn is-miss${kind === 'reject' ? ' is-on' : ''}`} aria-pressed={kind === 'reject'} onClick={() => onChoose(kind === 'reject' ? null : { decision: 'reject', reason: '' })}><X size={15} /> Reject</button>
            <button type="button" className={`sp-dbtn is-info${kind === 'retake' ? ' is-on' : ''}`} aria-pressed={kind === 'retake'} onClick={() => onChoose(kind === 'retake' ? null : { decision: 'retake', reason: '' })} title="Ask for a new photo"><RotateCcw size={15} /> Photo</button>
          </div>
          {kind === 'reject' || kind === 'retake' ? (
            <div className="sp-why">
              <FormPicker id={`sp-why-${b.id}`} value={choice?.reason || null} placeholder={kind === 'reject' ? 'Why is it rejected?' : 'What’s wrong with the photo?'}
                onChange={(reason) => onChoose({ decision: kind, reason, comment: choice?.comment })} sheetTitle="Reason" keepInForm
                options={reasonList.map((r) => ({ value: r, label: reasonLabel(kind === 'reject' ? 'reject' : 'retake', r) }))} />
              <input className="fm-input" value={choice?.comment || ''} maxLength={500} aria-label={`Comment for bundle ${b.n}`}
                placeholder={choice?.reason === 'other' ? 'Say what’s wrong (needed)' : 'Comment (optional)'}
                onChange={(e) => onChoose({ decision: kind, reason: choice?.reason, comment: e.target.value })} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function WholeBlock({ bundles, choices, setAll, reasons }: { bundles: Bundle[]; choices: Record<string, Choice>; setAll: (c: Choice | null) => void; reasons: { reject: readonly string[]; retake: readonly string[] } }) {
  const first = choices[bundles[0]!.id];
  const same = bundles.every((b) => choices[b.id] && choices[b.id]!.decision === first?.decision && choices[b.id]!.reason === first?.reason);
  const kind = same ? first?.decision : undefined;
  const slabs = bundles.reduce((s, b) => s + (Number(b.slabs) || 0), 0);
  return (
    <div className="sp-whole">
      <span className="sp-sub">The same decision for all {bundles.length} bundles ({slabs} slabs) waiting:</span>
      <div className="sp-decide is-big">
        <button type="button" className={`sp-dbtn is-ok${kind === 'approve' ? ' is-on' : ''}`} onClick={() => setAll(kind === 'approve' ? null : { decision: 'approve' })}><Check size={16} /> Approve all</button>
        <button type="button" className={`sp-dbtn is-miss${kind === 'reject' ? ' is-on' : ''}`} onClick={() => setAll(kind === 'reject' ? null : { decision: 'reject', reason: '' })}><X size={16} /> Reject the block</button>
        <button type="button" className={`sp-dbtn is-info${kind === 'retake' ? ' is-on' : ''}`} onClick={() => setAll(kind === 'retake' ? null : { decision: 'retake', reason: '' })}><RotateCcw size={16} /> New photos</button>
      </div>
      {kind === 'reject' || kind === 'retake' ? (
        <div className="sp-why">
          <FormPicker id="sp-why-all" value={first?.reason || null} placeholder={kind === 'reject' ? 'Why is it rejected?' : 'What’s wrong with the photos?'} keepInForm sheetTitle="Reason"
            onChange={(reason) => setAll({ decision: kind, reason, comment: first?.comment })}
            options={(kind === 'reject' ? reasons.reject : reasons.retake).map((r) => ({ value: r, label: reasonLabel(kind, r) }))} />
          <input className="fm-input" value={first?.comment || ''} maxLength={500} aria-label="Comment for every bundle"
            placeholder={first?.reason === 'other' ? 'Say what’s wrong (needed)' : 'Comment (optional)'}
            onChange={(e) => setAll({ decision: kind, reason: first?.reason, comment: e.target.value })} />
        </div>
      ) : null}
    </div>
  );
}
