import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Download, X, AlertTriangle, Loader2 } from 'lucide-react';
import { fetchHoldPdf } from '../../../api/holds';
import { LETTER_HIDE } from '../../../holds/holdLetter';
import type { Hold } from '../types';
import { renderPages } from './letterPdf';
import { printPdf, downloadPdf } from './letterOutput';
import './HoldPrintPreview.css';

/**
 * Print preview for the Hold Information Letter (after SPS's): the "Hide …"
 * boxes, then Print / Download PDF. The pages shown are the PDF itself, drawn
 * with pdf.js, so what's on screen is exactly what prints — there is one
 * letter (src/holds/holdPdf.ts), not a screen copy that could drift from it.
 * Drawing the pages is letterPdf.ts; printing and saving, letterOutput.ts.
 */

const HIDE_KEY = 'holdLetterHide';
/** The letter's "Hide …" boxes that are ticked ({ unitPrice: true, … }). */
type Hide = Record<string, boolean>;
const readHide = (): Hide => {
  try { return JSON.parse(localStorage.getItem(HIDE_KEY) as string) || {}; } catch { return {}; }
};
const saveHide = (hide: Hide) => {
  try { localStorage.setItem(HIDE_KEY, JSON.stringify(hide)); } catch { /* remembered for this visit only */ }
};

export default function HoldPrintPreview({ hold, onClose }: { hold: Hold; onClose: () => void }) {
  const [hide, setHide] = useState(readHide);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const pagesRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const seq = useRef(0);

  const holdKey = `${hold._id}:${hold.version}`;
  useEffect(() => {
    const n = ++seq.current;
    const isCurrent = () => n === seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const pdf = await fetchHoldPdf(hold, { hide });
        if (!isCurrent()) return;
        setBlob(pdf);
        await renderPages(pdf, pagesRef.current, isCurrent);
        if (isCurrent()) setError('');
      } catch (err) {
        if (isCurrent()) setError((err as Error).message || 'Couldn’t show the letter.');
      } finally {
        if (isCurrent()) setBusy(false);
      }
    }, 120);
    return () => clearTimeout(t);
    // The hold's id and version stand in for the hold itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdKey, hide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const html = document.documentElement.style;
    const before = html.overflow;
    html.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); html.overflow = before; };
  }, [onClose]);

  useEffect(() => () => frameRef.current?.remove(), []);

  const toggle = (key: string) => setHide((h) => {
    const next = { ...h, [key]: !h[key] };
    saveHide(next);
    return next;
  });

  const print = () => {
    if (!blob) return;
    printPdf(blob, frameRef);
  };

  const download = () => {
    if (!blob) return;
    downloadPdf(blob, `hold-${hold.number}.pdf`);
  };

  return createPortal(
    <div className="hp" role="dialog" aria-modal="true" aria-label={`Hold #${hold.number} print preview`}>
      <div className="hp-bar">
        <button type="button" className="hp-btn primary" onClick={print} disabled={!blob || busy}><Printer size={17} aria-hidden="true" />Print</button>
        <button type="button" className="hp-btn" onClick={download} disabled={!blob || busy}><Download size={17} aria-hidden="true" /><span className="hp-label">Download PDF</span></button>
        <span className="hp-title">Hold #{hold.number}</span>
        <button type="button" className="hp-close" onClick={onClose} aria-label="Close" title="Close"><X size={18} strokeWidth={2.4} aria-hidden="true" /></button>
      </div>
      <div className="hp-opts" role="group" aria-label="What the letter shows">
        {LETTER_HIDE.map((o) => {
          const implied = Boolean(hide.pricing) && (o.key === 'unitPrice' || o.key === 'totals');
          return (
            <label key={o.key} className={`hp-opt${implied ? ' implied' : ''}`}>
              <input type="checkbox" checked={Boolean(hide[o.key] || implied)} disabled={implied} onChange={() => toggle(o.key)} />
              {o.label}
            </label>
          );
        })}
      </div>
      <div className="hp-scroll">
        {error ? <div className="hp-error" role="alert"><AlertTriangle size={18} aria-hidden="true" />{error}</div> : null}
        <div ref={pagesRef} className={`hp-pages${busy ? ' is-busy' : ''}`} />
        {busy && !blob ? <div className="hp-loading"><Loader2 size={28} className="hp-spin" aria-label="Loading" /></div> : null}
      </div>
    </div>,
    document.body
  );
}
