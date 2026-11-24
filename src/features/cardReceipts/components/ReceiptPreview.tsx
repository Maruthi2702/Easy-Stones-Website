import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Minus, Plus, X } from 'lucide-react';
import { isPdfUrl } from '../cardReceiptsView';
import { renderReceiptPdf } from '../receiptPdf';

const MIN = 100;
const MAX = 400;
const STEP = 50;
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, Math.round(z)));

/** A PDF receipt's pages, drawn here (see receiptPdf.ts); the pages are as wide as the zoom says, like the photo. */
function PdfPages({ url, zoom }: { url: string; zoom: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let current = true;
    setState('loading');
    renderReceiptPdf(url, () => current)
      .then((pages) => {
        if (!current) return;
        host.current?.replaceChildren(...pages);
        setState('ready');
      })
      .catch(() => { if (current) setState('failed'); });
    return () => { current = false; };
  }, [url]);
  return (
    <>
      {state === 'loading' ? <p className="ccr-pdf-note" role="status">Opening the PDF…</p> : null}
      {state === 'failed' ? (
        <p className="ccr-pdf-note" role="alert">
          This PDF can’t be shown here. <a href={url} target="_blank" rel="noreferrer">Open it in a new tab</a>
        </p>
      ) : null}
      <div ref={host} className="ccr-pdf-pages" style={{ width: `${zoom}%` }} />
    </>
  );
}

/**
 * The receipt shown large at the top of Add / Edit receipt (owner, 2026-11-05):
 * it stays pinned while the fields below scroll, so the date, total and
 * merchant can be read off it and typed in. − / + and a double tap zoom; two
 * fingers pinch on a phone; one finger (or the scroll wheel) moves around a
 * zoomed receipt. Its own scrolling never moves the form behind it.
 *
 * `variant="viewer"` (an opened receipt's "View full size", 2026-11-24): the same
 * zoomable image, but filling the window in place of the details — tall, not
 * pinned, a Back button instead of ✕, and no link out to another tab.
 */
export default function ReceiptPreview({ url, onClose, variant = 'pinned' }: { url: string; onClose: () => void; variant?: 'pinned' | 'viewer' }) {
  const viewer = variant === 'viewer';
  const [zoom, setZoom] = useState(MIN);
  const box = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  /** Zooms keeping the point under `at` (or the middle) where it was. */
  const zoomTo = (next: number, at?: { x: number; y: number }) => {
    const el = box.current;
    const to = clamp(next);
    if (!el || to === zoomRef.current) { zoomRef.current = to; setZoom(to); return; }
    const rect = el.getBoundingClientRect();
    const px = at ? at.x - rect.left : rect.width / 2;
    const py = at ? at.y - rect.top : rect.height / 2;
    const ratio = to / zoomRef.current;
    zoomRef.current = to;
    const left = (el.scrollLeft + px) * ratio - px;
    const top = (el.scrollTop + py) * ratio - py;
    setZoom(to);
    requestAnimationFrame(() => { el.scrollLeft = left; el.scrollTop = top; });
  };

  // Pinch: a non-passive listener, so the page itself doesn't zoom instead.
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    let start: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const mid = (t: TouchList) => ({ x: (t[0]!.clientX + t[1]!.clientX) / 2, y: (t[0]!.clientY + t[1]!.clientY) / 2 });
    const onStart = (e: TouchEvent) => { if (e.touches.length === 2) start = { dist: dist(e.touches), zoom: zoomRef.current }; };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !start) return;
      e.preventDefault();
      zoomTo(start.zoom * (dist(e.touches) / start.dist), mid(e.touches));
    };
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) start = null; };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // zoomTo reads only refs, so the listeners are set once.
  }, []);

  return (
    <div className={`ccr-preview${viewer ? ' is-viewer' : ''}`} role="region" aria-label="Receipt, large">
      <div className="ccr-preview-bar">
        {viewer ? (
          <button type="button" className="ccr-preview-back" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />Back to receipt</button>
        ) : <span className="ccr-preview-k">Receipt</span>}
        {viewer ? <span className="ccr-preview-k" /> : null}
        <button type="button" className="ccr-preview-btn" aria-label="Zoom out" onClick={() => zoomTo(zoom - STEP)} disabled={zoom <= MIN}><Minus size={16} /></button>
        <button type="button" className="ccr-preview-pct" onClick={() => zoomTo(MIN)} title="Fit the width" aria-label={`Zoom ${zoom}%. Fit the width`}>{zoom}%</button>
        <button type="button" className="ccr-preview-btn" aria-label="Zoom in" onClick={() => zoomTo(zoom + STEP)} disabled={zoom >= MAX}><Plus size={16} /></button>
        {viewer || isPdfUrl(url) ? null : <a className="ccr-preview-link" href={url} target="_blank" rel="noreferrer">Full size</a>}
        {viewer ? null : <button type="button" className="ccr-preview-btn is-close" aria-label="Hide the receipt" onClick={onClose}><X size={16} /></button>}
      </div>
      <div ref={box} className="ccr-preview-scroll" onDoubleClick={(e) => zoomTo(zoom > MIN ? MIN : 250, { x: e.clientX, y: e.clientY })}>
        {isPdfUrl(url)
          ? <PdfPages url={url} zoom={zoom} />
          : <img src={url} alt="The receipt" style={{ width: `${zoom}%` }} draggable={false} />}
      </div>
      {viewer ? <p className="ccr-preview-hint">Double-tap or pinch to zoom · ✕, Back or Esc go back</p> : null}
    </div>
  );
}
