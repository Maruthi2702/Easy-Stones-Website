import { describe, expect, it } from 'vitest';
import { isRealPdfDataUrl } from './receiptPdf.ts';

const url = (bytes: string, type = 'application/pdf') => `data:${type};base64,${Buffer.from(bytes, 'latin1').toString('base64')}`;

describe('isRealPdfDataUrl', () => {
  it('accepts a file that starts with the PDF header', () => {
    expect(isRealPdfDataUrl(url('%PDF-1.7\n%âãÏÓ\n1 0 obj'))).toBe(true);
  });
  it('turns away another kind of file sent as a PDF', () => {
    expect(isRealPdfDataUrl(url('<html><script>alert(1)</script>'))).toBe(false);
    expect(isRealPdfDataUrl(url('PK\u0003\u0004 a zip'))).toBe(false);
    expect(isRealPdfDataUrl(url('  %PDF-1.4'))).toBe(false);
  });
  it('turns away an empty body, a missing base64 marker and a different type', () => {
    expect(isRealPdfDataUrl('data:application/pdf;base64,')).toBe(false);
    expect(isRealPdfDataUrl('data:application/pdf,%PDF-1.4')).toBe(false);
    expect(isRealPdfDataUrl(url('%PDF-1.4', 'image/png'))).toBe(false);
  });
});
