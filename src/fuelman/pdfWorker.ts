import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageRows } from './parserRows.ts';
import { parseReport } from './parseReport.ts';
import type { PdfPage } from './types.ts';
try {
  const pdf = await getDocument({ data: new Uint8Array(workerData), useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    if (pdf.numPages > 100) throw new Error('The PDF exceeds 100 pages');
    const pages: PdfPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), text = await page.getTextContent();
      if (text.items.length > 40000) throw new Error(`Page ${n} contains too much text`);
      const items = text.items.filter((v): v is Extract<typeof v, { str: string }> => 'str' in v);
      pages.push(pageRows(n, page.view[2]!, page.view[3]!, items));
    }
    parentPort!.postMessage({ ok: true, result: parseReport(pages) });
  } finally { await pdf.destroy(); }
} catch (error) { parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Cannot read this PDF' }); }
