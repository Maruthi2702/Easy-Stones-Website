// @vitest-environment jsdom
// Supplier POs page render: the POs tab's tiles and list, the review queue,
// a block opened and approved as a whole block (what's posted), the
// same-person rule at step 2, and Incoming Material without supplier / PO.
// The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const META = {
  me: { id: 'u1', name: 'Ravi Shah' }, today: '2026-11-07',
  languages: [{ code: 'en', name: 'English', english: 'English' }, { code: 'pt', name: 'Português', english: 'Portuguese' }],
  countries: [{ name: 'Brazil', language: 'pt', timeZone: 'America/Sao_Paulo' }],
  reasons: { reject: ['cracks', 'color', 'other'], retake: ['dark', 'other'] }, thicknesses: ['2 cm', '3 cm'], finishes: ['Polished'],
  buyers: [{ id: 'u1', name: 'Ravi Shah' }], translation: false, sameStepAllowed: false, maxLogins: 1
};
const cov = (ordered: number, approved = 0, review = 0) => [{ lineId: 'L1', ordered, approved, final: 0, review, supplier: 0, offered: approved + review, rejected: 0 }];
const po = (id: string, o: Record<string, unknown> = {}) => ({
  id, poNumber: id, supplierId: 's1', supplierName: 'Pedras Vale Verde', supplierCountry: 'Brazil', shipTo: 'Seattle', readyBy: '2026-12-04',
  buyerId: 'u1', buyerName: 'Ravi Shah', lines: [{ id: 'L1', material: 'Taj Mahal Quartzite', thickness: '3 cm', finish: 'Polished', slabs: 56, note: '' }],
  note: null, source: 'typed', status: 'open', statusReason: '', assignedAt: '2026-11-01T00:00:00Z', coverage: cov(56),
  stage: 'supplier', blockStages: { review: 0, final: 0, supplier: 0, approved: 0, sent: 0 }, lastActivityAt: '2026-11-06T00:00:00Z',
  createdAt: null, updatedAt: null, createdBy: 'Ravi', draftBlocks: 0, ...o
});
const bundle = (n: number, status = 'review', o: Record<string, unknown> = {}) => ({
  id: `b${n}`, n, slabs: 8, photoUrl: `https://res.cloudinary.com/x/${n}.webp`, status, round: 1, reason: '', comment: null,
  step1: null, step2: null, previousPhotos: [], sentAt: '2026-11-06T10:00:00Z', photoAt: '2026-11-06T09:00:00Z', unlock: null, ...o
});
const counts = (bundles: { status: string; slabs: number }[]) => {
  const keys = ['draft', 'review', 'final', 'approved', 'rejected', 'retake', 'unlocked'];
  const c: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, bundles.filter((b) => b.status === k).length]));
  c.slabs = Object.fromEntries(keys.map((k) => [k, bundles.filter((b) => b.status === k).reduce((s, b) => s + b.slabs, 0)]));
  c.total = bundles.length;
  return c;
};
const block = (id: string, bundles: ReturnType<typeof bundle>[], o: Record<string, unknown> = {}) => ({
  id, poId: '41872', poNumber: '41872', supplierId: 's1', supplierName: 'Pedras Vale Verde', supplierCountry: 'Brazil', supplierTimeZone: 'America/Sao_Paulo',
  shipTo: 'Seattle', readyBy: '2026-12-04', poStatus: 'open', lineId: 'L1', material: 'Taj Mahal Quartzite', thickness: '3 cm', finish: 'Polished',
  blockNumber: '3317', size: { length: 124, height: 76, unit: 'in' }, note: { text: 'Bloco muito bonito', lang: 'pt', translations: { en: 'A very nice block' } },
  decisionNote: null, bundles, stage: 'review', counts: counts(bundles), decidable: { 1: bundles.filter((b) => b.status === 'review').map((b) => b.id), 2: [] },
  firstSentAt: '2026-11-06T10:00:00Z', sentAt: '2026-11-06T10:00:00Z', createdAt: null, updatedAt: '2026-11-06T10:00:00Z', history: [], ...o
});
const REVIEW = [block('k1', [1, 2, 3, 4, 5, 6, 7].map((n) => bundle(n)))];
const FINAL = [block('k2', [1, 2].map((n) => bundle(n, 'final', { step1: { decision: 'approve', by: 'u1', byName: 'Ravi Shah', at: '2026-11-06T12:00:00Z' } })), { stage: 'final', decidable: { 1: [], 2: [] } })];
const POS = [po('41872', { stage: 'review', coverage: cov(56, 0, 56), blockStages: { review: 1, final: 0, supplier: 0, approved: 0, sent: 1 } }), po('41858', { coverage: cov(240, 128) })];

const fake = { posted: [] as { url: string; body: Record<string, unknown> }[] };
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
const answer = (url: string, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body || '{}'));
    fake.posted.push({ url: u, body });
    if (/\/block-photos$/.test(u)) return ok({ url: `https://res.cloudinary.com/t/SupplierBlocks/${fake.posted.length}.webp` });
    if (/\/pos\/41872\/blocks$/.test(u)) return ok({ block: { ...REVIEW[0], id: body.id, blockNumber: body.blockNumber, enteredBy: 'Ravi Shah' } });
    if (/\/decide$/.test(u)) return ok({ block: { ...REVIEW[0], bundles: REVIEW[0]!.bundles.map((b) => ({ ...b, status: 'final' })), decidable: { 1: [], 2: [] }, stage: 'final' }, emailed: 0 });
    return ok({});
  }
  if (/\/meta$/.test(u)) return ok(META);
  if (/\/pos\?/.test(u)) return ok({ pos: POS });
  if (/\/pos\/41872$/.test(u)) return ok({ po: { ...POS[0], history: [], blocks: REVIEW } });
  if (/\/blocks\/k1$/.test(u)) return ok({ block: REVIEW[0] });
  if (/\/blocks\/k2$/.test(u)) return ok({ block: FINAL[0] });
  if (/queue=review/.test(u)) return ok({ blocks: REVIEW });
  if (/queue=final/.test(u)) return ok({ blocks: FINAL });
  if (/\/suppliers$/.test(u)) return ok({ suppliers: [{ id: 's1', name: 'Pedras Vale Verde', spsName: 'PEDRAS', country: 'Brazil', language: 'pt', timeZone: 'America/Sao_Paulo', contactName: '', email: '', phone: '', notes: '', active: true, logins: [], openPos: 2, score: { bundlesDecided: 20, rejectionRate: 10, retakes: 1, supplierHours: 30, reviewHours: 4 } }] });
  if (/\/incoming$/.test(u)) return ok({ items: [{ id: 'k9', material: 'Taj Mahal Quartzite', thickness: '3 cm', finish: 'Polished', blockNumber: '3317', size: { length: 124, height: 76, unit: 'in' }, shipTo: 'Seattle', readyBy: '2026-12-04', bundles: [{ n: 1, slabs: 8, photoUrl: 'https://x/1.webp' }], slabs: 8, approvedAt: '2026-11-06T00:00:00Z' }] });
  return ok({});
};
vi.mock('../../utils/attachmentFiles', () => ({ compressImage: async (f: File) => `data:image/jpeg;base64,${btoa(f.name)}` }));
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string, init?: RequestInit) => answer(u, init), resetSessionExpiredGuard() {} }));

const { default: SupplierPosPage } = await import('./SupplierPosPage');
const { default: IncomingMaterialPage } = await import('./incoming/IncomingMaterialPage');

const ALL = ['view_supplier_pos', 'manage_supplier_pos', 'review_supplier_blocks', 'final_approve_supplier_blocks', 'unlock_supplier_bundles', 'manage_suppliers'];
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const show = async (permissions = ALL) => { render(<SupplierPosPage currentUser={{ _id: 'u1', displayName: 'Ravi Shah', permissions }} locations={['Seattle', 'Kent']} />); await settle(); };
const text = () => document.body.textContent || '';

beforeEach(() => { fake.posted = []; Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

describe('the Supplier POs page', () => {
  it('shows the open POs with their tiles, what waits on us first', async () => {
    await show();
    expect(text()).toContain('2 open · 128 of 296 slabs approved');
    const rows = [...document.querySelectorAll('.sp-table tbody tr')].map((r) => r.textContent || '');
    expect(rows[0]).toContain('41872');
    expect(rows[0]).toContain('Waiting for review');
    expect(rows[1]).toContain('128 / 240');
    expect(document.querySelector('.sp-fab')?.getAttribute('aria-label')).toBe('New PO');
  });

  it('opens a block from the review queue and approves the whole block in one go', async () => {
    await show();
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for review/ }));
    await settle();
    fireEvent.click(screen.getByText('Block 3317').closest('button')!);
    await settle();
    expect(text()).toContain('A very nice block');
    expect(text()).toContain('Translated from Portuguese');
    expect(screen.getByRole('button', { name: /Decide bundles 1, 2, 3, 4, 5, 6, 7 first/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Whole block' }));
    fireEvent.click(screen.getByRole('button', { name: /Approve all/ }));
    const send = screen.getByRole('button', { name: 'Approve · 7 bundles, 56 slabs' });
    fireEvent.click(send);
    await settle();
    const posted = fake.posted.find((p) => /\/blocks\/k1\/decide$/.test(p.url))!;
    expect(posted.body.step).toBe(1);
    expect((posted.body.decisions as unknown[]).length).toBe(7);
    expect(text()).toContain('Step 1 saved for 7 bundles');
  });

  it('a reject needs its reason before the decisions can go', async () => {
    await show();
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for review/ }));
    await settle();
    fireEvent.click(screen.getByText('Block 3317').closest('button')!);
    await settle();
    const cards = [...document.querySelectorAll('.sp-bundle')];
    cards.forEach((c, i) => fireEvent.click(c.querySelector(i === 5 ? '.sp-dbtn.is-miss' : '.sp-dbtn.is-ok')!));
    // Rejected with no reason yet: the button says so and stays off.
    const button = screen.getByRole('button', { name: 'Choose why for bundle 6' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(text()).toContain('6 approve');
    expect(text()).toContain('1 reject');
  });

  it('in Final approval, says someone else finalises what you approved in step 1', async () => {
    await show();
    fireEvent.click(screen.getByRole('tab', { name: /Final approval/ }));
    await settle();
    expect(text()).toContain('You approved these in step 1 — someone else gives the final approval.');
    fireEvent.click(screen.getByText('Block 3317').closest('button')!);
    await settle();
    expect(text()).toContain('so someone else gives the final approval');
    expect(screen.queryByRole('button', { name: /Final approval ·/ })).toBeNull();
  });

  it('adds a block for a supplier who emailed the photos: photos in name order, slabs for each, sent for review', async () => {
    await show();
    fireEvent.click(document.querySelector('.sp-table tbody tr')!);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Add block/ }));
    await settle();
    expect(text()).toContain('Add block for Pedras Vale Verde');
    expect(text()).toContain('Pedras Vale Verde has no portal login or email');
    fireEvent.change(document.getElementById('blockNumber')!, { target: { value: 'B-77' } });
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '320' } });
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '190,5' } });
    const files = ['IMG_0012.jpg', 'IMG_0002.jpg'].map((n) => new File(['x'], n, { type: 'image/jpeg' }));
    const many = document.querySelector('input[type=file][multiple]') as HTMLInputElement;
    await act(async () => { fireEvent.change(many, { target: { files } }); });
    await settle();
    fireEvent.change(document.getElementById('eachSlabs')!, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for review · 2 bundles' }));
    await settle();
    const sent = fake.posted.find((p) => /\/pos\/41872\/blocks$/.test(p.url))!;
    expect(sent.body).toMatchObject({ lineId: 'L1', blockNumber: 'B-77', length: '320', height: '190.5', unit: 'cm' });
    const bundles = sent.body.bundles as { slabs: number; photoUrl: string }[];
    expect(bundles.map((b) => b.slabs)).toEqual([8, 8]);
    // IMG_0002 was uploaded first (name order), so it's bundle 1.
    const uploads = fake.posted.filter((p) => /\/block-photos$/.test(p.url)).map((p) => atob(String(p.body.data).split(',')[1]!));
    expect(uploads).toEqual(['IMG_0002.jpg', 'IMG_0012.jpg']);
    expect(bundles[0]!.photoUrl).toMatch(/\/1\.webp$/);
    expect(bundles[1]!.photoUrl).toMatch(/\/2\.webp$/);
    expect(text()).toContain('Block B-77 sent for review');
  });

  it('shows a supplier’s record on the Suppliers tab', async () => {
    await show();
    fireEvent.click(screen.getByRole('tab', { name: 'Suppliers' }));
    await settle();
    const row = document.querySelector('.sp-table tbody tr')!.textContent || '';
    expect(row).toContain('Pedras Vale Verde');
    expect(row).toContain('No login');
    expect(row).toContain('10%');
    expect(document.querySelector('.sp-fab')?.getAttribute('aria-label')).toBe('Add supplier');
  });
});

describe('Incoming Material', () => {
  it('shows approved bundles without the supplier or the PO', async () => {
    render(<IncomingMaterialPage currentUser={{ _id: 'u2', permissions: ['view_incoming_material'] }} />);
    await settle();
    expect(text()).toContain('Taj Mahal Quartzite');
    expect(text()).toContain('8 slabs · 1 bundle · block 3317');
    expect(text()).not.toContain('Pedras');
    expect(text()).not.toContain('41872');
  });
});
