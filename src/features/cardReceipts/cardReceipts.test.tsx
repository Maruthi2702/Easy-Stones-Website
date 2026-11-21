// @vitest-environment jsdom
// Credit Card Receipts page render: accounting's month (tiles, list, a tile
// filtering it), the approver's Waiting for me with a lost receipt that can't
// be approved without a comment, a cardholder adding a receipt, and a login
// with no card. The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const CATEGORIES = [
  { _id: 'k1', name: 'travel_lunch', label: 'Travel Lunch', order: 0, active: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } },
  { _id: 'k2', name: 'customer_lunch', label: 'Customer Lunch', order: 1, active: true, fields: { customer: true, attendees: true, purpose: false, recurring: false } },
  { _id: 'k3', name: 'fuel', label: 'Fuel', order: 2, active: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } }
];
const exp = (id: string, o: Record<string, unknown> = {}) => ({
  id, userId: 'u1', holderName: 'Maruthi Ponugupati', cardId: 'c1', cardLabel: 'MARU92069', location: 'Seattle', date: '2026-10-03',
  merchant: "McDonald's", cents: 1432, subtotalCents: 1297, taxCents: 135, tipCents: null, category: 'travel_lunch', customerId: '', customerName: '',
  attendees: [], purpose: '', note: '', recurring: false, receiptUrl: 'https://res.cloudinary.com/x/r.webp', lostReason: '', status: 'approved',
  approval: null, sentBack: null, voided: null, createdAt: '2026-10-03T17:21:00Z', updatedAt: '2026-10-03T17:21:00Z', history: [], mine: true, canDecide: false, ...o
});
const EXPENSES = [
  exp('a'),
  exp('b', { merchant: 'JINYA Ramen Bar', cents: 11579, category: 'customer_lunch', customerId: 'cu1', customerName: 'Cascade Countertops', attendees: ['Maruthi Ponugupati', 'J. Alvarez'], status: 'waiting', date: '2026-10-09' }),
  exp('c', { merchant: 'Kashish Cuisine of India', cents: 5729, category: 'customer_lunch', status: 'draft' }),
  exp('d', { userId: 'u2', holderName: 'Dana Whitfield', cardLabel: 'DANA41008', location: 'Kent', merchant: 'Staples', cents: 8642, category: '', status: 'sent_back', mine: false, sentBack: { by: 'x', byName: 'Dee', at: '2026-10-07T00:00:00Z', comment: 'Pick a category' } })
];
const WAITING = [exp('w1', { userId: 'u2', holderName: 'Dana Whitfield', cardLabel: 'DANA41008', merchant: 'CHEVRON', cents: 12500, category: 'fuel', receiptUrl: '', lostReason: 'The pump didn’t print one', status: 'waiting', mine: false, canDecide: true })];
const fake = { card: true as boolean, posted: [] as { url: string; body: Record<string, unknown> }[] };
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
const answer = (url: string, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body || '{}'));
    fake.posted.push({ url: u, body });
    if (/\/approve$/.test(u)) return ok({ expense: { ...WAITING[0], status: 'approved', canDecide: false } });
    return ok({ expense: exp(body.id || 'new', { merchant: body.merchant, cents: Math.round(Number(body.total) * 100), date: body.date, status: body.category ? 'waiting' : 'draft' }) });
  }
  if (/\/me$/.test(u)) return ok({ user: { id: 'u1', name: 'Maruthi Ponugupati', location: 'Seattle' }, card: fake.card ? { _id: 'c1', userId: 'u1', label: 'MARU92069', issuer: 'amex', lastDigits: '92069', active: true } : null, categories: CATEGORIES, approverRoles: ['manager'], today: '2026-10-20' });
  if (/scope=waiting/.test(u)) return ok({ expenses: WAITING });
  if (/scope=all/.test(u)) return ok({ expenses: EXPENSES });
  if (/scope=mine/.test(u)) return ok({ expenses: EXPENSES.filter((e) => e.mine) });
  if (/customers\/dropdown/.test(u)) return ok([]);
  return ok({});
};
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string, init?: RequestInit) => answer(u, init), resetSessionExpiredGuard() {} }));

const { default: CardReceiptsPage } = await import('./CardReceiptsPage');
const { default: ReceiptPreview } = await import('./components/ReceiptPreview');

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const show = async (permissions: string[]) => { render(<CardReceiptsPage currentUser={{ _id: 'u1', displayName: 'Maruthi Ponugupati', permissions }} />); await settle(); };
const text = () => document.body.textContent || '';

beforeEach(() => { fake.card = true; fake.posted = []; Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

describe('the Credit Card Receipts page', () => {
  it('shows accounting the month with tiles, and a tile filters the list', async () => {
    await show(['view_all_card_receipts', 'export_card_receipts']);
    expect(text()).toContain('October 2026 · All cardholders');
    expect(document.querySelector('.ccr-tile.is-total .ccr-tile-v')?.textContent).toBe('$273.82');
    expect(screen.getByText('Staples')).toBeTruthy();
    expect(text()).toContain('“Pick a category” · Dee');
    fireEvent.click(screen.getByRole('button', { name: /Draft/ }));
    expect(screen.queryByText('Staples')).toBeNull();
    expect(screen.getByText('Kashish Cuisine of India')).toBeTruthy();
    expect(screen.queryByLabelText('Add receipt')).toBeNull();
  });

  it('lets an approver open a lost receipt and approve it only with a comment', async () => {
    await show(['use_card_receipts', 'approve_card_receipts']);
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    expect(screen.getByText('CHEVRON')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Open CHEVRON/));
    expect(text()).toContain('“The pump didn’t print one”');
    const approve = screen.getByRole('button', { name: 'Approve receipt' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(document.getElementById('ccr-comment')!, { target: { value: 'Burlington delivery run. OK.' } });
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await settle();
    expect(fake.posted.at(-1)).toMatchObject({ body: { comment: 'Burlington delivery run. OK.' } });
    expect(fake.posted.at(-1)!.url).toMatch(/w1\/approve$/);
  });

  /** The round + asks how first; Lost Receipt goes straight to the form. */
  const openAdd = () => {
    fireEvent.click(screen.getByLabelText('Add receipt'));
    fireEvent.click(screen.getByRole('button', { name: /Lost Receipt/ }));
  };

  it('asks how to add a receipt: camera, photo, file or lost', async () => {
    await show(['use_card_receipts']);
    fireEvent.click(screen.getByLabelText('Add receipt'));
    for (const name of ['Open Camera', 'Upload Photo', 'Upload File', 'Lost Receipt']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
    expect(document.querySelector('.fm-footer')).toBeNull();
    // Open Camera: no camera in the test browser, so it says so and offers the phone camera.
    fireEvent.click(screen.getByRole('button', { name: /Open Camera/ }));
    expect(text()).toContain('The camera isn’t available here');
    fireEvent.click(screen.getByLabelText('Close camera'));
    expect(text()).toContain('Upload Photo');
  });

  it('turns a wrong file away in the window, before anything uploads', async () => {
    await show(['use_card_receipts']);
    fireEvent.click(screen.getByLabelText('Add receipt'));
    const input = document.querySelector('input[accept="application/pdf,image/*"]') as HTMLInputElement;
    const doc = new File(['x'], 'Statement.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    fireEvent.change(input, { target: { files: [doc] } });
    expect(text()).toContain('Statement.docx is a DOCX file');
    expect(text()).toContain('Upload Photo');
  });

  it('lets a cardholder add a receipt with the round +', async () => {
    await show(['use_card_receipts']);
    expect(screen.queryByRole('tab')).toBeNull();
    openAdd();
    // The form is the Bill details card, the category and a note; the pencil opens Edit bill details.
    expect(text()).toContain('Bill details');
    expect(document.getElementById('ccr-merchant')).toBeNull();
    fireEvent.click(screen.getByLabelText('Edit bill details'));
    expect(text()).toContain('Edit bill details');
    fireEvent.change(document.getElementById('ccr-merchant')!, { target: { value: 'SP PARK' } });
    fireEvent.change(document.getElementById('ccr-total')!, { target: { value: '12.85' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(text()).toContain('$12.85');
    expect(text()).toContain('SP PARK');
    expect(text()).not.toContain('Saves as a draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await settle();
    expect(fake.posted.at(-1)!.body).toMatchObject({ merchant: 'SP PARK', total: '12.85', date: '2026-10-20' });
    expect(text()).toContain('Saved as a draft');
  });

  it('puts ✕ on Edit bill details back to what the card showed, and "+ Add tip" opens it', async () => {
    await show(['use_card_receipts']);
    openAdd();
    fireEvent.click(screen.getByLabelText('Edit bill details'));
    fireEvent.change(document.getElementById('ccr-merchant')!, { target: { value: 'Typed then dropped' } });
    fireEvent.click(screen.getByLabelText('Close'));
    expect(text()).toContain('Bill details');
    expect(text()).not.toContain('Typed then dropped');
    fireEvent.click(screen.getByRole('button', { name: /Add tip/ }));
    expect(text()).toContain('Edit bill details');
    expect(document.getElementById('ccr-tip')).not.toBeNull();
  });

  it('sends someone to Edit bill details when a save is missing the merchant or total', async () => {
    await show(['use_card_receipts']);
    openAdd();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(text()).toContain('Edit bill details');
    expect(fake.posted.length).toBe(0);
  });

  it('tells someone with no card to ask accounting, and offers no +', async () => {
    fake.card = false;
    await show(['use_card_receipts']);
    expect(text()).toContain('You don’t have a company card set up yet');
    expect(screen.queryByLabelText('Add receipt')).toBeNull();
  });

  it('shows the receipt large, zooms with − / +, fits again, and hides', () => {
    const closed: string[] = [];
    render(<ReceiptPreview url="https://res.cloudinary.com/x/r.webp" onClose={() => closed.push('x')} />);
    const img = screen.getByAltText('The receipt') as HTMLImageElement;
    expect(img.style.width).toBe('100%');
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(img.style.width).toBe('200%');
    fireEvent.click(screen.getByLabelText(/Fit the width/));
    expect(img.style.width).toBe('100%');
    fireEvent.click(screen.getByLabelText('Hide the receipt'));
    expect(closed).toEqual(['x']);
  });
});

describe('the sub-category on Add / Edit receipt', () => {
  const GAS = {
    _id: 'k9', name: 'gas', label: 'Gas', order: 3, active: true, fields: { customer: false, attendees: false, purpose: false, recurring: false },
    subcategories: [
      { name: 'car', label: 'Car', active: true, isDefault: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } },
      { name: 'truck', label: 'Truck', active: true, isDefault: false, fields: { customer: false, attendees: false, purpose: false, recurring: false } },
      { name: 'van', label: 'Van', active: false, isDefault: false, fields: { customer: false, attendees: false, purpose: false, recurring: false } }
    ]
  };
  const FOOD = {
    _id: 'k10', name: 'food', label: 'Food', order: 4, active: true, fields: { customer: false, attendees: false, purpose: false, recurring: false },
    subcategories: [
      { name: 'travel_lunch', label: 'Travel Lunch', active: true, isDefault: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } },
      { name: 'customer_lunch', label: 'Customer Lunch', active: true, isDefault: false, fields: { customer: true, attendees: false, purpose: false, recurring: false } }
    ]
  };
  const open = async (expense: ReturnType<typeof exp>) => {
    const { default: ExpenseForm } = await import('./components/ExpenseForm');
    render(<ExpenseForm expense={expense as never} cardLabel="MARU92069" holderName="Maruthi Ponugupati" today="2026-10-20"
      categories={[...CATEGORIES, GAS, FOOD] as never} upload={async () => ({ url: '' })} onSave={async () => undefined} onClose={() => {}} />);
    await settle();
  };

  it('shows the type under a category that has them, and not under one that has none', async () => {
    await open(exp('g1', { category: 'gas', subcategory: 'truck', status: 'draft' }));
    expect(text()).toContain('Sub-category');
    expect(text()).toContain('Truck');
    cleanup();
    await open(exp('g2', { category: 'fuel', status: 'draft' }));
    expect(text()).not.toContain('Sub-category');
  });

  it('asks for the customer under Customer Lunch only', async () => {
    await open(exp('f1', { category: 'food', subcategory: 'customer_lunch', status: 'draft' }));
    expect(text()).toContain('Customer');
    expect(text()).not.toContain('Who attended');
    cleanup();
    await open(exp('f2', { category: 'food', subcategory: 'travel_lunch', status: 'draft' }));
    expect(document.getElementById('ccr-customer')).toBeNull();
  });

  it('still asks for the type when a draft has the category but not the type, without a hint line', async () => {
    await open(exp('g3', { category: 'gas', subcategory: '', status: 'draft' }));
    expect(text()).toContain('Sub-category');
    expect(text()).not.toContain('Still to do');
  });
});
