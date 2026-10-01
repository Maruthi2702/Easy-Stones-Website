import { describe, it, expect } from 'vitest';
import { isPdfSource } from './attachments.js';

describe('isPdfSource', () => {
  it('recognises an inline PDF', () => {
    expect(isPdfSource('data:application/pdf;base64,JVBERi0')).toBe(true);
  });

  it('recognises a hosted PDF, ignoring query strings and case', () => {
    expect(isPdfSource('https://res.cloudinary.com/x/raw/upload/v1/visits/pdf_1.pdf')).toBe(true);
    expect(isPdfSource('https://example.com/Quote.PDF?dl=1#page=2')).toBe(true);
  });

  it('treats images as images', () => {
    expect(isPdfSource('data:image/png;base64,iVBOR')).toBe(false);
    expect(isPdfSource('https://res.cloudinary.com/x/image/upload/v1/visits/img_1.webp')).toBe(false);
    expect(isPdfSource('/uploads/visits/img_1.webp')).toBe(false);
  });

  it('is false for nothing', () => {
    expect(isPdfSource('')).toBe(false);
    expect(isPdfSource(null)).toBe(false);
    expect(isPdfSource(undefined)).toBe(false);
  });
});
