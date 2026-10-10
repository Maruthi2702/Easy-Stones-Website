import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Download, X, AlertTriangle, Loader2 } from 'lucide-react';
import { fetchHoldPdf } from '../../../api/holds';
import { LETTER_HIDE } from '../../../holds/holdLetter';
import './HoldPrintPreview.css';

/**
 * Print preview for the Hold Information Letter (after SPS's): the "Hide …"
 * boxes, then Print / Download PDF. The pages shown are the PDF itself, drawn
 * with pdf.js, so what's on screen is exactly what prints — there is one
 * letter (src/holds/holdPdf.js), not a screen copy that could drift from it.
 */

const HIDE_KEY = 'holdLetterHide';
const readHide = () => {
  try { return JSON.parse(localStorage.getItem(HIDE_KEY)) || {}; } catch { return {}; }
};
const saveHide = (hide) => {
  try { localStorage.setItem(HIDE_KEY, JSON.stringify(hide)); } catch { /* remembered for this visit only */ }
};

// Safari (and every iPhone/iPad browser) can't print a PDF from inside the
// page; it opens in its own tab there, where Print / Share does the rest.
const printsInTab = () => {
  const ua = navigator.userAgent;
  const iOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg/.test(ua);
  return iOS || safari;
};

let pdfjsPromise = null;
/** pdf.js, loaded the first time a preview opens (legacy build: older iPhones too). */
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.min.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    }).catch((err) => { pdfjsPromise = null; throw err; });
  }
  return pdfjsPromise;
}

/** Draw every page of `blob` as canvases inside `host`. */
async function renderPages(blob, host, isCurrent) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const canvases = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.className = 'hp-page';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
      if (!isCurrent()) return;
      canvases.push(canvas);
    }
    if (isCurrent()) host.replaceChildren(...canvases);
  } finally {
    doc.destroy();
  }
}

export default function HoldPrintPreview({ hold, onClose }) {
  const [hide, setHide] = useState(readHide);
  const [blob, setBlob] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const pagesRef = useRef(null);
  const frameRef = useRef(null);
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
        if (isCurrent()) setError(err.message || 'Couldn’t show the letter.');
      } finally {
        if (isCurrent()) setBusy(false);
      }
    }, 120);
    return () => clearTimeout(t);
    // The hold's id and version stand in for the hold itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdKey, hide]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const html = document.documentElement.style;
    const before = html.overflow;
    html.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); html.overflow = before; };
  }, [onClose]);

  useEffect(() => () => frameRef.current?.remove(), []);

  const toggle = (key) => setHide((h) => {
    const next = { ...h, [key]: !h[key] };
    saveHide(next);
    return next;
  });

  const print = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    if (printsInTab()) {
      window.open(url, '_blank');
      return;
    }
    frameRef.current?.remove();
    const frame = document.createElement('iframe');
    frame.className = 'hp-print-frame';
    frame.title = 'Print';
    frame.src = url;
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank'); }
    };
    document.body.appendChild(frame);
    frameRef.current = frame;
  };

  const download = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hold-${hold.number}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
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
