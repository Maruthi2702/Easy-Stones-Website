/**
 * Review S5 (2026-11-24): a data URL that says it is a PDF must start with the PDF header (`%PDF-`),
 * so a renamed file of another kind isn't stored as a receipt. Reads only the first few bytes.
 * Server side (uses Buffer); the browser's own checks are in receiptFile.ts.
 */
export function isRealPdfDataUrl(dataUrl: string): boolean {
  const marker = ';base64,';
  const at = dataUrl.indexOf(marker);
  if (!dataUrl.startsWith('data:application/pdf') || at < 0) return false;
  const head = dataUrl.slice(at + marker.length, at + marker.length + 16);
  return Buffer.from(head, 'base64').toString('latin1').startsWith('%PDF-');
}
