/*
 * A PDF receipt shown inside the app (2026-11-24): pdf.js, loaded the first time one is opened,
 * draws each page as a canvas. The browser's own PDF viewer can't be used in a frame — the
 * receipt file route answers with `sandbox` (it must), and iOS shows only page 1 of a framed PDF.
 * Same loader as the Hold letter's preview (features/holds/print/letterPdf.ts, a different module).
 */

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.min.mjs');
let pdfjsPromise: Promise<Pdfjs> | null = null;
function loadPdfjs(): Promise<Pdfjs> {
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

/** Widest a drawn page gets, in canvas pixels: sharp at 400 % zoom without a huge bitmap. */
const MAX_PAGE_PX = 2200;
const MAX_PAGES = 20;

/**
 * Fetches the PDF at `url` and returns one canvas per page (first MAX_PAGES). Throws when the
 * file can't be read — a cross-origin address without CORS headers, say — so the caller can offer
 * "Open in a new tab" instead.
 */
export async function renderReceiptPdf(url: string, isCurrent: () => boolean): Promise<HTMLCanvasElement[]> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`The file answered ${res.status}.`);
  const data = new Uint8Array(await res.arrayBuffer());
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  try {
    const canvases: HTMLCanvasElement[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n += 1) {
      if (!isCurrent()) return [];
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.5, MAX_PAGE_PX / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.className = 'ccr-pdf-page';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Receipt, page ${n} of ${doc.numPages}`);
      await page.render({ canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport, canvas }).promise;
      canvases.push(canvas);
    }
    return canvases;
  } finally {
    doc.destroy();
  }
}
