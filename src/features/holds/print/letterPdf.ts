/*
 * The letter's pages on screen (moved out of HoldPrintPreview, 2026-10-24):
 * pdf.js, loaded on first use, draws the PDF the server made as canvases.
 */

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.min.mjs');
let pdfjsPromise: Promise<Pdfjs> | null = null;
/** pdf.js, loaded the first time a preview opens (legacy build: older iPhones too). */
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

/** Draw every page of `blob` as canvases inside `host`. */
export async function renderPages(blob: Blob, host: HTMLElement | null, isCurrent: () => boolean) {
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
      await page.render({ canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport, canvas }).promise;
      if (!isCurrent()) return;
      canvases.push(canvas);
    }
    if (isCurrent()) (host as HTMLElement).replaceChildren(...canvases);
  } finally {
    doc.destroy();
  }
}
