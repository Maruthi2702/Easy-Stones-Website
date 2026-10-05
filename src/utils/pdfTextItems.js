/**
 * Server-side: the text drawn on a PDF, with where each piece sits on its
 * page, for the packing-list reader in src/utils/packingListPdf.js.
 *
 * Node only — pdf.js is imported lazily so nothing on the client side pulls
 * it in, and so a failure to load it only costs the auto-fill, never the
 * upload it rides along with.
 *
 * Pages are stacked top to bottom in one coordinate space (page 2 sits below
 * page 1), so a multi-page packing list reads as one long page.
 */

// Text-only reads stop after this many pages; a packing list is one or two.
const MAX_PAGES = 10;
const PAGE_GAP = 10000;

export async function extractPdfTextItems(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0
  }).promise;

  try {
    const items = [];
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const { items: pageItems } = await page.getTextContent();
      const offset = (p - 1) * PAGE_GAP;
      for (const it of pageItems) {
        if (typeof it.str !== 'string') continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5] - offset });
      }
      page.cleanup();
    }
    return items;
  } finally {
    await doc.destroy();
  }
}
