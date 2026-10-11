import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildPermitsPdf } from './permitsPdf.js';

const permit = (i, extra = {}) => ({
  source: i % 2 ? 'bellingham' : 'whatcom', permitNumber: `SFR2026-${String(i).padStart(5, '0')}`, category: 'new_home',
  issuedOn: '2026-10-06', address: `${i} MAIN ST`, city: 'Ferndale', valuation: 300000 + i,
  description: 'Construct a new two-story single family residence with attached garage, covered porch and a detached shop building',
  contacts: [{ kind: 'contractor', company: 'KVF Construction', name: 'Vlad K', phone: '3607397535' }], ...extra
});
const pagesOf = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();

describe('buildPermitsPdf', () => {
  it('makes a one-page PDF that says when nothing matches', async () => {
    const bytes = await buildPermitsPdf({ items: [], total: 0, scope: 'Ferndale · All kinds of work · All dates', generated: 'Generated now' });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(await pagesOf(bytes)).toBe(1);
  });

  it('runs onto more pages for a long list', async () => {
    expect(await pagesOf(await buildPermitsPdf({ items: Array.from({ length: 60 }, (_, i) => permit(i)) }))).toBeGreaterThan(1);
  });

  it("doesn't fail on characters the PDF font lacks, or a permit with nothing filled in", async () => {
    const odd = permit(1, { address: '石材 Rd 😀', description: '', contacts: [] });
    expect(await pagesOf(await buildPermitsPdf({ items: [odd, { permitNumber: 'X' }] }))).toBe(1);
  });

  it('stops at its row cap and says so', async () => {
    const items = Array.from({ length: 1001 }, (_, i) => permit(i, { description: 'Short' }));
    const pages = await pagesOf(await buildPermitsPdf({ items, total: 1001 }));
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBe(await pagesOf(await buildPermitsPdf({ items: items.slice(0, 1000), total: 1001 })));
  });
});
