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
const NO_ACTIONS = { approve: null, sendBack: false, ask: false, withdrawAsk: false, answer: false, reopen: false, fillDetails: false };
const ACCOUNTING_ACTIONS = { ...NO_ACTIONS, approve: 'accounting', sendBack: true, ask: true };
const WAITING_LOST = exp('w1', {
  userId: 'u2', holderName: 'Dana Whitfield', cardLabel: 'DANA41008', merchant: 'CHEVRON', cents: 12500, category: 'fuel', receiptUrl: '',
  lostReason: 'The pump didn’t print one', status: 'waiting', mine: false, canDecide: true,
  chips: [{ key: 'accounting', label: 'Accounting', by: '', done: false }], waitingReason: 'accounting', actions: ACCOUNTING_ACTIONS
});
// A $150+ receipt Accounting approved; the second approval is still open.
const WAITING_SECOND = exp('w2', {
  userId: 'u3', holderName: 'Jo Park', cardLabel: 'JOPA12345', merchant: 'Home Depot', cents: 18900, status: 'waiting', mine: false, canDecide: true,
  approval: { by: 'm1', byName: 'Maria', at: '2026-10-10T00:00:00Z', comment: '', as: 'accounting' },
  chips: [{ key: 'accounting', label: 'Accounting', by: 'Maria', done: true }, { key: 'second', label: 'Manager or Admin', by: '', done: false }],
  waitingReason: 'second', actions: { ...NO_ACTIONS, approve: 'second' }
});
// A question asked of the viewer.
const WAITING_ASKED = exp('w3', {
  userId: 'u4', holderName: 'Sam Lee', cardLabel: 'SAML55555', merchant: 'Costco', cents: 21000, status: 'waiting', mine: false, canDecide: true,
  ask: { to: 'u1', toName: 'Maruthi Ponugupati', by: 'm1', byName: 'Maria', at: '2026-10-11T00:00:00Z', question: 'Was this for the Kent showroom?', answer: '', answeredAt: null },
  chips: [{ key: 'accounting', label: 'Accounting', by: '', done: false }, { key: 'second', label: 'Manager or Admin', by: '', done: false }],
  waitingReason: 'asked', actions: { ...NO_ACTIONS, answer: true }
});
const fake = {
  card: true as boolean,
  posted: [] as { url: string; body: Record<string, unknown> }[],
  waiting: [WAITING_LOST] as Record<string, unknown>[],
  conflict: false as boolean
};
const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const answer = (url: string, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST' || init?.method === 'PUT') {
    const body = JSON.parse(String(init.body || '{}'));
    fake.posted.push({ url: u, body });
    if (fake.conflict) return ok({ message: 'Changed', changed: true }, 409);
    if (/\/expenses\/remind$/.test(u)) return ok({ sent: { people: 3, receipts: 1 }, skipped: [{ id: 'c', merchant: 'Kashish Cuisine of India', reason: 'reminded today' }], noPhone: ['Dana Whitfield'], noEmail: [] });
    const which = fake.waiting.find((w) => u.includes(`/expenses/${w.id}/`)) || fake.waiting[0];
    if (/\/(approve|answer)$/.test(u)) return ok({ expense: { ...which, status: 'approved', canDecide: false, waitingReason: null, actions: NO_ACTIONS } });
    if (/\/expenses\/[^/]+\/(ask|ask\/withdraw|send-back|reopen|details|void)$/.test(u)) return ok({ expense: which });
    return ok({ expense: exp(body.id || 'new', { merchant: body.merchant, cents: Math.round(Number(body.total) * 100), date: body.date, status: body.category ? 'waiting' : 'draft' }) });
  }
  if (/\/me$/.test(u)) return ok({ user: { id: 'u1', name: 'Maruthi Ponugupati', location: 'Seattle' }, card: fake.card ? { _id: 'c1', userId: 'u1', label: 'MARU92069', issuer: 'amex', lastDigits: '92069', active: true } : null, categories: CATEGORIES, role: 'accounting', today: '2026-10-20' });
  if (/\/categories$/.test(u)) return ok({ categories: CATEGORIES });
  if (/scope=waiting/.test(u)) return ok({ expenses: fake.waiting });
  if (/\/ask-targets$/.test(u)) return ok({ people: [{ id: 'k1', name: 'Kim Branch', role: 'manager', branch: 'Kent' }] });
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

beforeEach(() => { fake.card = true; fake.posted = []; fake.waiting = [WAITING_LOST]; fake.conflict = false; Element.prototype.scrollIntoView = () => {}; });
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

  it('puts a count beside every Filters choice and a live "Show N receipts" button', async () => {
    await show(['view_all_card_receipts', 'export_card_receipts']);
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog.textContent).toContain('Show 4 receipts');
    expect(dialog.textContent).toContain('Amex · 4');
    expect(dialog.textContent).toContain('Encore · 0');
    // Card comes first, the cardholder list last.
    const order = ['Card', 'Status', 'Category'].map((l) => dialog.textContent!.indexOf(l));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // A pick with nothing behind it says so and shows the badge.
    fireEvent.click(screen.getByText('Encore · 0'));
    await settle();
    expect(dialog.textContent).toContain('No receipts match');
    expect(dialog.querySelector('.lf-badge')?.textContent).toBe('1');
  });

  it('has one Export… item that opens a pop-up whose choices follow the two switches', async () => {
    const popup = async (permissions: string[]) => {
      await show(permissions);
      const more = screen.queryByRole('button', { name: 'More' });
      if (!more) { cleanup(); return null; }
      fireEvent.click(more);
      await settle();
      const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
      fireEvent.click(screen.getByText('Export…'));
      await settle();
      const out = {
        items,
        card: Boolean(document.getElementById('ccr-ex-bank')),
        months: Boolean(document.getElementById('ccr-ex-months')),
        format: Boolean(document.getElementById('ccr-ex-format')),
        text: text()
      };
      cleanup();
      return out;
    };
    const both = await popup(['view_all_card_receipts', 'export_card_receipts', 'export_all_card_receipts']);
    expect(both!.items).toEqual(['Export…']);
    expect(both).toMatchObject({ card: true, months: true, format: true });
    expect(both!.text).toContain('card-receipts-2026-10.xlsx');
    const monthOnly = await popup(['view_all_card_receipts', 'export_card_receipts']);
    expect(monthOnly).toMatchObject({ card: true, months: false, format: true });
    const allOnly = await popup(['view_all_card_receipts', 'export_all_card_receipts']);
    expect(allOnly).toMatchObject({ card: true, months: true, format: true });
    expect(allOnly!.text).toContain('card-receipts-all.xlsx');
    expect(await popup(['view_all_card_receipts'])).toBeNull();
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
    expect(fake.posted.at(-1)).toMatchObject({ body: { comment: 'Burlington delivery run. OK.', expectedUpdatedAt: '2026-10-03T17:21:00Z' } });
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
    fake.waiting = [];
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

describe('approvals, questions and reminders (2026-11-23)', () => {
  const openWaiting = async (permissions: string[], merchant: string) => {
    await show(permissions);
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    fireEvent.click(screen.getByLabelText(new RegExp(`Open ${merchant}`)));
    await settle();
  };
  const menuItems = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await settle();
    return [...document.querySelectorAll('.ccr-more-menu [role="menuitem"]')].map((i) => i.textContent);
  };

  it('shows the approvals as chips, short in the list and in full on the receipt', async () => {
    fake.waiting = [WAITING_SECOND];
    await show(['view_all_card_receipts', 'approve_card_receipts']);
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    expect(text()).toContain('Acct ✓ · Mgr –');
    fireEvent.click(screen.getByLabelText(/Open Home Depot/));
    await settle();
    expect(text()).toContain('Accounting ✓ Maria');
    expect(text()).toContain('Manager or Admin — waiting');
    expect(screen.getByRole('button', { name: 'Approve receipt' })).toBeTruthy();
  });

  it('asks the person a question went to for "Answer & approve", with the answer required', async () => {
    fake.waiting = [WAITING_ASKED];
    await openWaiting(['use_card_receipts'], 'Costco');
    expect(text()).toContain('Maria asked Maruthi Ponugupati: Was this for the Kent showroom?');
    expect(screen.queryByRole('button', { name: 'Approve receipt' })).toBeNull();
    const main = screen.getByRole('button', { name: 'Answer & approve' }) as HTMLButtonElement;
    expect(main.disabled).toBe(true);
    fireEvent.change(document.getElementById('ccr-answer')!, { target: { value: 'Yes, the Kent install.' } });
    expect(main.disabled).toBe(false);
    fireEvent.click(main);
    await settle();
    expect(fake.posted.at(-1)!.url).toMatch(/w3\/answer$/);
    expect(fake.posted.at(-1)!.body).toEqual({ answer: 'Yes, the Kent install.', expectedUpdatedAt: '2026-10-03T17:21:00Z' });
  });

  it('shows Waiting for me to someone without Approve only while a question is asked of them', async () => {
    fake.waiting = [WAITING_ASKED];
    await show(['use_card_receipts']);
    expect(screen.getByRole('tab', { name: /Waiting for me/ })).toBeTruthy();
    // No group filter for them: everything there is asked of them.
    expect(screen.queryByRole('radio', { name: /Asked of me/ })).toBeNull();
    cleanup();
    fake.waiting = [];
    await show(['use_card_receipts']);
    expect(screen.queryByRole('tab', { name: /Waiting for me/ })).toBeNull();
  });

  it('puts in ⋯ only what the receipt’s actions allow', async () => {
    await openWaiting(['use_card_receipts', 'approve_card_receipts', 'send_receipt_reminders'], 'CHEVRON');
    expect(await menuItems()).toEqual(['Send back', 'Ask manager / Admin…', 'Send reminder…']);
    cleanup();
    fake.waiting = [{ ...WAITING_LOST, actions: { ...NO_ACTIONS, approve: 'accounting', withdrawAsk: true }, ask: (WAITING_ASKED as Record<string, unknown>).ask }];
    await openWaiting(['use_card_receipts', 'approve_card_receipts'], 'CHEVRON');
    expect(await menuItems()).toEqual(['Withdraw question']);
  });

  it('asks a manager / Admin the server offers, with the question', async () => {
    await openWaiting(['use_card_receipts', 'approve_card_receipts'], 'CHEVRON');
    await menuItems();
    fireEvent.click(screen.getByRole('menuitem', { name: /Ask manager/ }));
    await settle();
    // The only person offered is picked already.
    expect(text()).toContain('Kim Branch');
    fireEvent.change(document.getElementById('ccr-ask-question')!, { target: { value: 'Was this a delivery run?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await settle();
    expect(fake.posted.at(-1)!.url).toMatch(/w1\/ask$/);
    expect(fake.posted.at(-1)!.body).toEqual({ to: 'k1', question: 'Was this a delivery run?', expectedUpdatedAt: '2026-10-03T17:21:00Z' });
  });

  it('says the receipt changed when the server answers 409 changed', async () => {
    fake.waiting = [WAITING_SECOND];
    await openWaiting(['use_card_receipts', 'approve_card_receipts'], 'Home Depot');
    fake.conflict = true;
    fireEvent.click(screen.getByRole('button', { name: 'Approve receipt' }));
    await settle();
    expect(text()).toContain('This receipt changed after you opened it. Look at it again.');
  });

  it('counts Waiting for me by why it waits, and filters by it', async () => {
    fake.waiting = [WAITING_LOST, WAITING_SECOND, WAITING_ASKED];
    await show(['use_card_receipts', 'approve_card_receipts']);
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    for (const label of ['All · 3', 'Needs Accounting · 1', 'Needs second approval · 1', 'Asked of me · 1']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('radio', { name: 'Asked of me · 1' }));
    await settle();
    expect(screen.getByText('Costco')).toBeTruthy();
    expect(screen.queryByText('CHEVRON')).toBeNull();
    expect(text()).toContain('Asked Maruthi');
  });

  it('ticks receipts, and Send reminder sends who and how for them', async () => {
    await show(['view_all_card_receipts', 'send_receipt_reminders']);
    // An approved receipt can't be ticked.
    expect(screen.queryByLabelText(/Select McDonald's/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Select Kashish/));
    fireEvent.click(screen.getByLabelText(/Select JINYA/));
    expect(text()).toContain('2 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }));
    expect(text()).toContain('3 selected');
    fireEvent.click(screen.getByLabelText(/Select Staples/));
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
    await settle();
    // A draft and a waiting one: the cardholder and whoever must approve start ticked.
    const box = (name: string) => (screen.getByLabelText(name) as HTMLInputElement).checked;
    expect([box('Cardholder'), box('Branch manager'), box('Accounting'), box('Admins'), box('Whoever must approve')]).toEqual([true, false, false, false, true]);
    expect([box('Email'), box('Phone notification')]).toEqual([true, true]);
    fireEvent.change(document.getElementById('ccr-remind-message')!, { target: { value: 'Please finish these today' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    const sent = fake.posted.at(-1)!;
    expect(sent.url).toMatch(/\/expenses\/remind$/);
    expect(new Set(sent.body.ids as string[])).toEqual(new Set(['b', 'c']));
    expect(sent.body).toMatchObject({
      to: { holder: true, managers: false, accounting: false, admins: false, approvers: true },
      email: true, push: true, message: 'Please finish these today'
    });
    expect(text()).toContain('Sent to 3 people about 1 receipt. Skipped 1: Kashish Cuisine of India (reminded today). No phone: Dana Whitfield (email only).');
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).find((b) => b.textContent === 'Close')!);
    await settle();
    expect(text()).not.toContain('selected');
  });

  it('tells a cardholder about their missing receipts', async () => {
    const before = EXPENSES.length;
    EXPENSES.push(exp('m1', { merchant: 'SHELL', status: 'missing', receiptUrl: '', category: '' }));
    try {
      fake.waiting = [];
      await show(['use_card_receipts']);
      expect(text()).toContain('You have 1 missing receipt in October 2026 — upload it.');
    } finally {
      EXPENSES.length = before;
    }
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

describe('a category that needs a note (2026-11-23)', () => {
  const TRAVEL = { _id: 'k11', name: 'travel', label: 'Travel', order: 5, active: true, fields: { customer: false, note: true, recurring: false }, subcategories: [] };
  const open = async (expense: ReturnType<typeof exp>) => {
    const { default: ExpenseForm } = await import('./components/ExpenseForm');
    render(<ExpenseForm expense={expense as never} cardLabel="MARU92069" holderName="Maruthi Ponugupati" today="2026-10-20"
      categories={[...CATEGORIES, TRAVEL] as never} upload={async () => ({ url: '' })} onSave={async () => undefined} onClose={() => {}} />);
    await settle();
  };
  const noteMark = () => document.getElementById('ccr-note')?.closest('.fm-field')?.querySelector('.fm-req');

  it('marks the Note required under that category only', async () => {
    await open(exp('t1', { category: 'travel', note: '', status: 'draft' }));
    expect(noteMark()).toBeTruthy();
    cleanup();
    await open(exp('t2', { category: 'fuel', note: '', status: 'draft' }));
    expect(document.getElementById('ccr-note')).toBeTruthy();
    expect(noteMark()).toBeFalsy();
  });

  it('is set in the category editor, which no longer offers Who attended or Business purpose', async () => {
    const { default: ReceiptCategoriesPage } = await import('./categories/ReceiptCategoriesPage');
    render(<ReceiptCategoriesPage currentUser={{ _id: 'u1', displayName: 'Karunakar', permissions: ['add_receipt_categories'] } as never} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Add category/ }));
    await settle();
    expect(text()).toContain('Required on every receipt in this category');
    expect(screen.getByLabelText('Note')).toBeTruthy();
    expect(screen.getByLabelText('Customer (from the customer list)')).toBeTruthy();
    expect(screen.getByLabelText('Can be marked recurring')).toBeTruthy();
    expect(text()).not.toContain('Who attended');
    expect(text()).not.toContain('Business purpose');
  });
});
