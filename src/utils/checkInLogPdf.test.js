import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildCheckInLogPdf } from './checkInLogPdf.js';

const visit = (i, extra = {}) => ({
  name: `Visitor ${i}`, phone: '(206) 555-0100', fabricatorCompany: 'Premier Quartz', location: 'Seattle',
  salesRep: 'Krish', createdAt: new Date(Date.UTC(2026, 9, 8, 18, 0) - i * 3600e3).toISOString(), ...extra
});
const pagesOf = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();

describe('buildCheckInLogPdf', () => {
  it('makes a one-page PDF that says when nothing matches', async () => {
    const bytes = await buildCheckInLogPdf({ list: [], total: 0, scope: 'Seattle · October 2026', generated: 'Generated now' });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(await pagesOf(bytes)).toBe(1);
  });

  it('runs onto more pages for a long list', async () => {
    const list = Array.from({ length: 80 }, (_, i) => visit(i));
    expect(await pagesOf(await buildCheckInLogPdf({ list, viewerZone: 'America/Los_Angeles' }))).toBeGreaterThan(1);
  });

  it("doesn't fail on characters the PDF font lacks (an emoji in a name)", async () => {
    const bytes = await buildCheckInLogPdf({ list: [visit(1, { name: 'José 😀 Núñez', fabricatorCompany: '石材 Co' })] });
    expect(await pagesOf(bytes)).toBe(1);
  });

  it('says when it stopped short of every match', async () => {
    const bytes = await buildCheckInLogPdf({ list: [visit(1)], total: 9000 });
    expect(await pagesOf(bytes)).toBe(1);
  });
});
