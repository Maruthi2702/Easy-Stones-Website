import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, History, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { t } from '../../../utils/supplierI18n';
import type { Decision } from '../../../utils/supplierBlocks';
import { bundleLabelOf } from '../supplierPosView';
import type { Bundle } from '../types';

export type Choice = { decision: Decision; reason?: string; comment?: string };

export type BundleViewerProps = {
  bundles: Bundle[];
  index: number;
  onIndex: (i: number) => void;
  /** Bundles this person may decide now; the others are shown only. */
  decidable: Set<string>;
  choices: Record<string, Choice>;
  onChoose: (bundleId: string, choice: Choice | null) => void;
  reasons: { reject: readonly string[]; retake: readonly string[] };
  onClose: () => void;
};

/**
 * A bundle's photo full screen, to look for cracks and colour before
 * deciding. Approve / Reject / New photo under it; a reject or new photo asks
 * why with one tap on a reason. Keys: A approve, R reject, N new photo,
 * ← → move, Z zoom, E the earlier photo, Esc close. Approving moves on to the
 * next bundle still to decide. Portaled at the forms' z-index (it opens over
 * the review drawer).
 */
export default function BundleViewer({ bundles, index, onIndex, decidable, choices, onChoose, reasons, onClose }: BundleViewerProps) {
  const b = bundles[index];
  // Zoom, the earlier photo and the reason question belong to the bundle on screen: moving on resets them.
  const [view, setView] = useState<{ at: number; zoom: boolean; earlier: boolean; asking: '' | 'reject' | 'retake' }>({ at: index, zoom: false, earlier: false, asking: '' });
  const here = view.at === index ? view : { at: index, zoom: false, earlier: false, asking: '' as const };
  const { zoom, earlier, asking } = here;
  const setZoom = (f: (z: boolean) => boolean) => setView({ ...here, zoom: f(zoom) });
  const setEarlier = (f: (e: boolean) => boolean) => setView({ ...here, earlier: f(earlier) });
  const setAsking = (a: '' | 'reject' | 'retake') => setView({ ...here, asking: a });
  const touch = useRef<{ x: number; y: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const canDecide = Boolean(b && decidable.has(b.id));
  const choice = b ? choices[b.id] : undefined;

  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);

  const nextUndecided = (from: number) => {
    for (let i = from + 1; i < bundles.length; i++) if (decidable.has(bundles[i]!.id) && !choices[bundles[i]!.id]) return i;
    return Math.min(bundles.length - 1, from + 1);
  };
  const choose = (c: Choice) => {
    if (!b) return;
    onChoose(b.id, c);
    setAsking('');
    if (c.decision === 'approve' && index < bundles.length - 1) onIndex(nextUndecided(index));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') { e.stopPropagation(); if (asking) setAsking(''); else onClose(); }
      else if (e.key === 'ArrowRight' && index < bundles.length - 1) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key.toLowerCase() === 'z') setZoom((z) => !z);
      else if (e.key.toLowerCase() === 'e' && b?.previousPhotos.length) setEarlier((v) => !v);
      else if (canDecide && e.key.toLowerCase() === 'a') choose({ decision: 'approve' });
      else if (canDecide && e.key.toLowerCase() === 'r') setAsking('reject');
      else if (canDecide && e.key.toLowerCase() === 'n') setAsking('retake');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!b) return null;
  const src = earlier && b.previousPhotos.length ? b.previousPhotos[b.previousPhotos.length - 1]!.url : b.photoUrl;
  const label = bundleLabelOf(b.status);
  const why = (key: string, kind: 'reject' | 'retake') => t('en', `${kind === 'reject' ? 'r' : 'p'}_${key}` as never);

  return createPortal(
    <div className="sp-viewer" role="dialog" aria-modal="true" aria-label={`Bundle ${b.n} photo`}>
      <header className="sp-viewer-h">
        <b>Bundle {b.n}</b>
        <span className="sp-viewer-sub">{b.slabs ? `${b.slabs} slabs` : ''} · {index + 1} of {bundles.length}{b.round > 1 ? ` · photo ${b.round}` : ''}</span>
        <span className={`sp-chip is-${choice ? (choice.decision === 'approve' ? 'ok' : choice.decision === 'reject' ? 'miss' : 'info') : label.colour}`}>
          {choice ? (choice.decision === 'approve' ? 'Approve' : choice.decision === 'reject' ? 'Reject' : 'New photo') : label.label}
        </span>
        <span className="sp-viewer-tools">
          {b.previousPhotos.length ? (
            <button type="button" className={`sp-viewer-btn${earlier ? ' is-on' : ''}`} onClick={() => setEarlier((v) => !v)} title="Earlier photo (E)">
              <History size={16} aria-hidden="true" /> {earlier ? 'Showing earlier photo' : 'Earlier photo'}
            </button>
          ) : null}
          <button type="button" className="sp-viewer-btn" onClick={() => setZoom((z) => !z)} aria-label={zoom ? 'Fit to screen' : 'Full size'} title="Zoom (Z)">
            {zoom ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
          </button>
          <button ref={closeRef} type="button" className="sp-viewer-btn is-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </span>
      </header>

      <div
        className={`sp-viewer-stage${zoom ? ' is-zoom' : ''}`}
        onTouchStart={(e) => { touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }; }}
        onTouchEnd={(e) => {
          const s = touch.current; touch.current = null;
          if (!s || zoom) return;
          const dx = e.changedTouches[0]!.clientX - s.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.changedTouches[0]!.clientY - s.y)) onIndex(Math.max(0, Math.min(bundles.length - 1, index + (dx < 0 ? 1 : -1))));
        }}
      >
        <button type="button" className="sp-viewer-nav is-prev" aria-label="Previous bundle" disabled={index === 0} onClick={() => onIndex(index - 1)}><ChevronLeft size={28} /></button>
        {src ? <img src={src} alt={`Bundle ${b.n}${earlier ? ', earlier photo' : ''}`} onClick={() => setZoom((z) => !z)} /> : <span className="sp-viewer-none">No photo</span>}
        <button type="button" className="sp-viewer-nav is-next" aria-label="Next bundle" disabled={index >= bundles.length - 1} onClick={() => onIndex(index + 1)}><ChevronRight size={28} /></button>
      </div>

      <footer className="sp-viewer-f">
        {canDecide ? (
          asking ? (
            <div className="sp-viewer-ask">
              <span className="sp-viewer-sub">{asking === 'reject' ? 'Why is it rejected?' : 'What’s wrong with the photo?'}</span>
              <div className="sp-reasons">
                {(asking === 'reject' ? reasons.reject : reasons.retake).filter((r) => r !== 'other').map((r) => (
                  <button key={r} type="button" className="sp-reason" onClick={() => choose({ decision: asking, reason: r })}>{why(r, asking)}</button>
                ))}
                <button type="button" className="sp-reason is-other" onClick={() => { onChoose(b.id, { decision: asking, reason: 'other', comment: '' }); setAsking(''); onClose(); }}>Other… (write it)</button>
                <button type="button" className="sp-viewer-btn" onClick={() => setAsking('')}>Back</button>
              </div>
            </div>
          ) : (
            <div className="sp-viewer-decide">
              <button type="button" className={`sp-dec is-ok${choice?.decision === 'approve' ? ' is-on' : ''}`} onClick={() => choose({ decision: 'approve' })}><Check size={18} /> Approve <kbd>A</kbd></button>
              <button type="button" className={`sp-dec is-miss${choice?.decision === 'reject' ? ' is-on' : ''}`} onClick={() => setAsking('reject')}><X size={18} /> Reject <kbd>R</kbd></button>
              <button type="button" className={`sp-dec is-info${choice?.decision === 'retake' ? ' is-on' : ''}`} onClick={() => setAsking('retake')}><RotateCcw size={18} /> New photo <kbd>N</kbd></button>
              {choice ? <button type="button" className="sp-viewer-btn" onClick={() => onChoose(b.id, null)}>Undo</button> : null}
              {choice && choice.decision !== 'approve' && choice.reason ? <span className="sp-viewer-sub">{why(choice.reason, choice.decision === 'reject' ? 'reject' : 'retake')}</span> : null}
            </div>
          )
        ) : (
          <span className="sp-viewer-sub">
            {b.step1 ? `Step 1: ${b.step1.decision === 'approve' ? 'approved' : b.step1.decision === 'reject' ? 'rejected' : 'new photo asked'} by ${b.step1.byName}. ` : ''}
            {b.step2 ? `Step 2: ${b.step2.decision === 'approve' ? 'final approval' : b.step2.decision === 'reject' ? 'rejected' : 'new photo asked'} by ${b.step2.byName}.` : ''}
            {!b.step1 && !b.step2 ? label.label : ''}
          </span>
        )}
      </footer>
    </div>,
    document.body
  );
}
