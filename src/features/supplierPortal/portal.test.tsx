// @vitest-environment jsdom
// The supplier portal render: sign in in the supplier's language, My POs
// grouped by what needs them, a block whose Send says what's missing, and
// a result read in Portuguese. fetch is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const ME = { name: 'Marcos', email: 'marcos@pvv.test', language: 'pt', supplierName: 'Pedras Vale Verde' };
const cov = (ordered: number, approved = 0, review = 0) => [{ lineId: 'L1', ordered, approved, final: 0, review, supplier: 0, offered: 0, rejected: 0 }];
const line = { id: 'L1', material: 'Patagonia Quartzite', thickness: '2 cm', finish: 'Polished', slabs: 56, note: '' };
const POS = [
  { id: 'p1', poNumber: '41858', shipTo: 'Seattle', readyBy: '2026-12-04', lines: [line], note: null, status: 'open', coverage: cov(56), group: 'needs_you', blocks: [], updatedAt: null, assignedAt: null },
  { id: 'p2', poNumber: '41872', shipTo: 'Seattle', readyBy: '', lines: [{ ...line, material: 'Taj Mahal Quartzite' }], note: null, status: 'open', coverage: cov(56, 0, 56), group: 'waiting', blocks: [{ id: 'k1', lineId: 'L1', blockNumber: '3317', stage: 'review' }], updatedAt: null, assignedAt: null }
];
const b = (n: number, o: Record<string, unknown> = {}) => ({ id: `b${n}`, n, slabs: 8, photoUrl: `https://x/${n}.webp`, status: 'draft', round: 0, decision: '', reason: '', comment: null, earlierPhoto: '', photoAt: null, sentAt: null, ...o });
const counts = (list: { status: string }[]) => ({ ...Object.fromEntries(['draft', 'review', 'final', 'approved', 'rejected', 'retake', 'unlocked'].map((k) => [k, list.filter((x) => x.status === k).length])), slabs: {}, total: list.length });
const DRAFT = { id: 'k2', poId: 'p1', poNumber: '41858', lineId: 'L1', material: 'Patagonia Quartzite', thickness: '2 cm', finish: 'Polished', blockNumber: '3305', size: { length: 124, height: 76, unit: 'in' }, note: null, decisionNote: null, bundles: [b(1), b(2, { photoUrl: '' })], stage: 'draft', counts: counts([b(1), b(2)]), sent: false, sentAt: null, updatedAt: null, poOpen: true };
const RESULT_BUNDLES = [
  b(1, { status: 'final', round: 1 }), b(6, { status: 'rejected', round: 1, decision: 'reject', reason: 'cracks', comment: { text: 'Crack across slab 3', lang: 'en', translations: { pt: 'Trinca na chapa 3' } } }),
  b(7, { status: 'retake', round: 1, decision: 'retake', reason: 'dark', sentAt: '2026-11-06T10:00:00Z', photoAt: '2026-11-06T09:00:00Z' })
];
const RESULT = { ...DRAFT, id: 'k1', blockNumber: '3317', bundles: RESULT_BUNDLES, stage: 'supplier', counts: counts(RESULT_BUNDLES), sent: true, sentAt: '2026-11-06T10:00:00Z',
  decisionNote: { text: 'Please retake 7 in daylight.', lang: 'en', translations: { pt: 'Refaça a foto do 7 com luz do dia.' } } };

const state = { signedIn: false };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  const u = String(url);
  if (/\/me$/.test(u) && (!init?.method || init.method === 'GET')) return state.signedIn ? json({ me: ME }) : json({ message: 'Sign in again.', code: 'signin' }, 401);
  if (/\/me$/.test(u)) return json({ me: ME });
  if (/\/sign-in$/.test(u)) return JSON.parse(String(init?.body)).password === 'right' ? json({ me: ME }) : json({ code: 'wrongPassword' }, 401);
  if (/\/pos$/.test(u)) return json({ pos: POS });
  if (/\/blocks\/k2$/.test(u)) return json({ block: DRAFT });
  if (/\/blocks\/k1$/.test(u)) return json({ block: RESULT });
  return json({});
});

const { default: SupplierPortal } = await import('./SupplierPortal');

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const open = async (path: string) => {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/supplier/*" element={<SupplierPortal />} /></Routes></MemoryRouter>);
  await settle();
};
const text = () => document.body.textContent || '';

beforeEach(() => { state.signedIn = false; localStorage.clear(); });
afterEach(cleanup);

describe('the supplier portal', () => {
  it('signs in in the language picked, and says a wrong password in it', async () => {
    await open('/supplier');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Português' }));
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'marcos@pvv.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await settle();
    expect(text()).toContain('E-mail e senha não conferem.');
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'right' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await settle();
    expect(screen.getByRole('heading', { name: 'Meus pedidos' })).toBeTruthy();
  });

  it('groups My POs by what needs the supplier', async () => {
    state.signedIn = true;
    await open('/supplier');
    const groups = [...document.querySelectorAll('.spx-group-h')].map((h) => h.textContent);
    expect(groups[0]).toContain('Precisa de você');
    expect(groups[1]).toContain('Aguardando a Easy Stones');
    expect(text()).toContain('0 de 56 chapas aprovadas');
  });

  it('a block’s Send says what’s missing', async () => {
    state.signedIn = true;
    await open('/supplier/block/k2');
    expect(text()).toContain('Bundle 1');
    expect(screen.getByRole('button', { name: 'Falta 1 foto' }).getAttribute('aria-disabled')).toBe('true');
    expect(text()).toContain('= 315 × 193 cm');
  });

  it('reads the result in Portuguese: reasons, the message, a new photo to take', async () => {
    state.signedIn = true;
    await open('/supplier/block/k1');
    expect(text()).toContain('Recusado · Trincas ou fissuras');
    expect(text()).toContain('“Trinca na chapa 3”');
    expect(text()).toContain('Nova foto pedida · Foto escura demais');
    expect(text()).toContain('Refaça a foto do 7 com luz do dia.');
    expect(text()).toContain('Oferecer outro bundle no lugar do 6');
    expect(text()).toContain('Tire uma nova foto');
    expect(text()).toContain('Bundles aprovados ficam travados.');
  });
});
