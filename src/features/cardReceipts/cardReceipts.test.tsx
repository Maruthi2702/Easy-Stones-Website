// @vitest-environment jsdom
// Credit Card Receipts page render: accounting's month (tiles, list, a tile
// filtering it), the approver's Waiting for me with a lost receipt that can't
// be approved without a comment, a cardholder adding a receipt, and a login
// with no card. The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';

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
// onStatement: a is on a bank statement line, b is not on one yet, the rest aren't known.
const EXPENSES = [
  exp('a', { onStatement: true }),
  exp('b', { merchant: 'JINYA Ramen Bar', cents: 11579, category: 'customer_lunch', customerId: 'cu1', customerName: 'Cascade Countertops', attendees: ['Maruthi Ponugupati', 'J. Alvarez'], status: 'waiting', date: '2026-10-09', onStatement: false }),
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
  conflict: false as boolean,
  /** Answered to ?scope=todo (every month); null = the month's own To-do ones. */
  todo: null as Record<string, unknown>[] | null,
  near: { charge: null, receipts: [] } as Record<string, unknown>,
  /** Every list URL asked for. */
  asked: [] as string[],
  /** What POST /attachments says the photo is already on (null = nothing). */
  duplicate: null as Record<string, unknown> | null
};
const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const answer = (url: string, init?: RequestInit) => {
  const u = String(url);
  if (!init?.method || init.method === 'GET') fake.asked.push(u);
  if (init?.method === 'POST' || init?.method === 'PUT') {
    const body = JSON.parse(String(init.body || '{}'));
    fake.posted.push({ url: u, body });
    if (fake.conflict) return ok({ message: 'Changed', changed: true }, 409);
    if (/\/attachments$/.test(u)) return ok({ url: '/api/card-receipts/files/img_1700000000001_0123456789abcdef01234567.pdf', duplicate: fake.duplicate });
    if (/\/scan$/.test(u)) return ok({ message: 'Reading is off' }, 503);
    if (/\/expenses\/remind\/preview$/.test(u)) {
      const g = (names: string[]) => ({ names, ids: names, self: false });
      return ok({ groups: { holder: g(['Maria Lopez']), managers: g([]), accounting: g([]), admins: g([]), approvers: g(['Ann Count', 'Ada Min']) },
        contact: { 'Maria Lopez': { email: true, phone: true }, 'Ann Count': { email: true, phone: false }, 'Ada Min': { email: true, phone: true } } });
    }
    if (/\/use-receipt$/.test(u)) return ok({ expense: exp('near1', { merchant: 'Sushi Kai', cents: 4518, date: '2026-10-21', status: 'waiting' }), replacedMissing: u.split('/expenses/')[1]!.split('/')[0] });
    if (/\/expenses\/remind$/.test(u)) return ok({ sent: { people: 3, receipts: 1 }, skipped: [{ id: 'c', merchant: 'Kashish Cuisine of India', reason: 'reminded today' }], noPhone: ['Dana Whitfield'], noEmail: [] });
    const which = fake.waiting.find((w) => u.includes(`/expenses/${w.id}/`)) || fake.waiting[0];
    if (/\/(approve|answer)$/.test(u)) return ok({ expense: { ...which, status: 'approved', canDecide: false, waitingReason: null, actions: NO_ACTIONS } });
    if (/\/expenses\/[^/]+\/(ask|ask\/withdraw|send-back|reopen|details|void)$/.test(u)) return ok({ expense: which });
    return ok({ expense: exp(body.id || 'new', { merchant: body.merchant, cents: Math.round(Number(body.total) * 100), date: body.date, status: body.category ? 'waiting' : 'draft' }) });
  }
  if (/\/me$/.test(u)) return ok({ user: { id: 'u1', name: 'Maruthi Ponugupati', location: 'Seattle' }, card: fake.card ? { _id: 'c1', userId: 'u1', label: 'MARU92069', issuer: 'amex', lastDigits: '92069', active: true } : null, categories: CATEGORIES, role: 'accounting', today: '2026-10-20' });
  if (/\/categories$/.test(u)) return ok({ categories: CATEGORIES });
  if (/scope=waiting/.test(u)) return ok({ expenses: fake.waiting });
  if (/scope=todo/.test(u)) return ok({ expenses: fake.todo ?? EXPENSES.filter((e) => e.mine && ['missing', 'draft', 'sent_back'].includes(String(e.status))) });
  if (/\/near-receipts$/.test(u)) return ok(fake.near);
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

beforeEach(() => { fake.card = true; fake.posted = []; fake.asked = []; fake.waiting = [WAITING_LOST]; fake.conflict = false; fake.todo = null; fake.duplicate = null; fake.near = { charge: null, receipts: [] }; Element.prototype.scrollIntoView = () => {}; localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

/** The one round Filters button (every screen size): opens the panel Queue, Card, Status, Statement, Category and People live in. */
const openFilters = () => { if (!document.querySelector('.lf-pop')) fireEvent.click(screen.getByRole('button', { name: /^Filters/ })); };
/** A panel dropdown's trigger by its field id (ccr-f-status …); opens its list. */
const field = (name: string) => { openFilters(); const t = document.getElementById(`ccr-f-${name}`) as HTMLElement; fireEvent.click(t); return t; };
const optionTexts = () => [...document.querySelectorAll('[role="option"]')].map((o) => (o.textContent || '').replace(/\s+/g, ' ').trim());
const pick = (name: string, choice: RegExp | string) => {
  field(name);
  fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => (typeof choice === 'string' ? o.textContent?.includes(choice) : choice.test(o.textContent || '')))!);
};

describe('the Credit Card Receipts page', () => {

  it('shows accounting the month with the money per status in the bar, and the Status dropdown filters the list', async () => {
    await show(['view_all_card_receipts', 'export_card_receipts']);
    expect(text()).toContain('October 2026 · All cardholders');
    // The tiles are gone: each status's money and the total sit beside the pager.
    expect(document.querySelector('.ccr-tile')).toBeNull();
    expect(document.querySelector('.ccr-pg-totals .is-total b')?.textContent).toBe('$273.82');
    expect(screen.getByText('Staples')).toBeTruthy();
    expect(text()).toContain('“Pick a category” · Dee');
    pick('status', 'Draft');
    expect(screen.queryByText('Staples')).toBeNull();
    expect(screen.getByText('Kashish Cuisine of India')).toBeTruthy();
    expect(document.getElementById('ccr-f-status')!.textContent).toContain('Draft');
    expect(screen.queryByLabelText('Add receipt')).toBeNull();
  });

  it('a Missing receipt row is green too: it is made from a line on the bank report', async () => {
    const before = EXPENSES.length;
    EXPENSES.push(exp('m2', { merchant: 'SHELL', status: 'missing', receiptUrl: '', category: '', onStatement: true }),
      exp('m3', { merchant: 'CHEVRON NOT KNOWN', status: 'missing', receiptUrl: '', category: '' }));
    try {
      await show(['view_all_card_receipts', 'export_card_receipts']);
      const rowOf = (merchant: string) => [...document.querySelectorAll('.ccr-table tbody tr')].find((r) => r.textContent?.includes(merchant))!;
      expect(rowOf('SHELL').className).toBe('is-ok');
      expect(rowOf('SHELL').getAttribute('title')).toBe('On the bank report, receipt still to upload');
      expect(rowOf('CHEVRON NOT KNOWN').className).toBe('');
    } finally {
      EXPENSES.length = before;
    }
  });

  it('colours each row by whether a bank statement line answers it, and filters by it', async () => {
    await show(['view_all_card_receipts', 'export_card_receipts']);
    const rowOf = (merchant: string) => [...document.querySelectorAll('.ccr-table tbody tr')].find((r) => r.textContent?.includes(merchant))!;
    // Matched = green; not on a statement yet and not known stay plain (owner: no colour for what isn't matched).
    expect(rowOf('Kashish').className).toBe('');
    expect(rowOf('JINYA').className).toBe('');
    expect(rowOf('JINYA').textContent).not.toContain('Not on statement');
    expect(rowOf('JINYA').getAttribute('title')).toBeNull();
    const green = [...document.querySelectorAll('.ccr-table tbody tr.is-ok')];
    expect(green).toHaveLength(1);
    expect(green[0]!.getAttribute('title')).toBe('Matched with a line on the statement');
    // The Statement dropdown counts and filters them.
    field('statement');
    const options = optionTexts();
    // Matched is the one green row; Not matched is everything else (4 receipts in all) — a not-checked one included.
    expect(options).toEqual(expect.arrayContaining([expect.stringMatching(/^Matched.*1/), expect.stringMatching(/^Not matched.*3/)]));
    fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.startsWith('Not matched'))!);
    expect(document.querySelectorAll('.ccr-table tbody tr')).toHaveLength(3);
    expect(document.querySelectorAll('.ccr-table tbody tr.is-ok')).toHaveLength(0);
    expect(screen.getByText('JINYA Ramen Bar')).toBeTruthy();
    expect(screen.getByText('Kashish Cuisine of India')).toBeTruthy();
    expect(document.getElementById('ccr-f-statement')!.textContent).toContain('Not matched');
  });

  it('puts every filter in the one Filters button, with a count beside each choice and Clear all', async () => {
    await show(['view_all_card_receipts', 'export_card_receipts']);
    // Nothing sits on the tab row any more.
    expect(document.querySelector('.ccr-tab-tools')).toBeNull();
    openFilters();
    // Card is a toggle: each bank with how many receipts it would show.
    const encore = screen.getByRole('radio', { name: /Encore/ });
    expect(screen.getByRole('radio', { name: /Amex/ }).textContent).toContain('4');
    expect(encore.textContent).toContain('0');
    // Card comes first, then Status and Category.
    const order = ['Card', 'Status', 'Category'].map((l) => [...document.querySelectorAll('.lf-group-label')].findIndex((b) => b.textContent === l));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // A pick with nothing behind it says so and lights the button; Clear all brings the list back.
    fireEvent.click(encore);
    expect(text()).toContain('Nothing matches');
    expect(screen.getByRole('button', { name: /^Filters/ }).className).toContain('is-active');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText('Staples')).toBeTruthy();
  });

  it('keeps the filters after a refresh until they are changed (Clear all forgets them)', async () => {
    await show(['view_all_card_receipts']);
    openFilters();
    fireEvent.click(screen.getByRole('radio', { name: /Encore/ }));
    expect(text()).toContain('Nothing matches');
    // A refresh: the page mounts again and reads what was kept.
    cleanup();
    await show(['view_all_card_receipts']);
    expect(text()).toContain('Nothing matches');
    expect(screen.getByRole('button', { name: /^Filters/ }).className).toContain('is-active');
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    cleanup();
    await show(['view_all_card_receipts']);
    expect(screen.getByText('Staples')).toBeTruthy();
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

  it('has the period in the Filters panel: Custom range is a button in the month calendar, From / To change nothing until Apply', async () => {
    await show(['view_all_card_receipts']);
    // Nothing on the tab row any more: no arrows, no Custom button.
    expect(screen.queryByLabelText('Previous month')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Custom$/ })).toBeNull();
    openFilters();
    // One field, no Month | Custom toggle.
    expect(screen.queryByRole('radio', { name: 'Custom' })).toBeNull();
    expect(document.getElementById('ccr-f-month')!.textContent).toContain('October 2026');
    const asked = fake.asked.length;
    fireEvent.click(document.getElementById('ccr-f-month')!);
    fireEvent.click(screen.getByRole('button', { name: 'Custom range…' }));
    await settle();
    // Picking Custom range alone asks nothing (the dashboard's Apply step), and the month field makes room for From / To.
    expect(fake.asked.length).toBe(asked);
    expect(document.getElementById('ccr-f-month')).toBeNull();
    expect(document.getElementById('ccr-range-from')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await settle();
    // Opens on the month on screen, up to today (Oct 20).
    expect(fake.asked.some((u) => /scope=all/.test(u) && /from=2026-10-01/.test(u) && /to=2026-10-20/.test(u) && !/month=/.test(u))).toBe(true);
    expect(text()).toContain('Oct 1 – Oct 20, 2026 · All cardholders');
    // While Custom is open the month field is not shown beside From / To.
    expect(document.getElementById('ccr-f-month')).toBeNull();
    expect(screen.getByRole('button', { name: /^Filters/ }).className).toContain('is-active');
    expect(screen.getByText('Staples')).toBeTruthy();
    // "Pick a month" brings the month field back.
    fireEvent.click(screen.getByRole('button', { name: 'Pick a month' }));
    await settle();
    expect(document.getElementById('ccr-f-month')).toBeTruthy();
    expect(text()).toContain('October 2026 · All cardholders');
    expect(fake.asked.filter((u) => /scope=all/.test(u) && /month=2026-10/.test(u)).length).toBeGreaterThan(0);
  });

  it('counts an earlier month as a filter and Clear all goes back to this month', async () => {
    await show(['view_all_card_receipts']);
    expect(screen.getByRole('button', { name: /^Filters/ }).className).not.toContain('is-active');
    openFilters();
    fireEvent.click(document.getElementById('ccr-f-month')!);
    fireEvent.click([...document.querySelectorAll('button')].find((b) => /^Sep/.test(b.textContent || '') || b.getAttribute('aria-label')?.startsWith('September'))!);
    await settle();
    expect(text()).toContain('September 2026');
    expect(screen.getByRole('button', { name: /^Filters/ }).className).toContain('is-active');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await settle();
    expect(text()).toContain('October 2026');
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
    for (const name of ['Open Camera', 'Upload', 'Lost Receipt']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
    expect(document.querySelector('.fm-footer')).toBeNull();
    // Open Camera: no camera in the test browser, so it says so and offers the phone camera.
    fireEvent.click(screen.getByRole('button', { name: /Open Camera/ }));
    expect(text()).toContain('The camera isn’t available here');
    fireEvent.click(screen.getByLabelText('Close camera'));
    expect(text()).toContain('A photo or PDF from your computer');
  });

  it('turns a wrong file away in the window, before anything uploads', async () => {
    await show(['use_card_receipts']);
    fireEvent.click(screen.getByLabelText('Add receipt'));
    const input = document.querySelector('input[accept="application/pdf,image/*"]') as HTMLInputElement;
    const doc = new File(['x'], 'Statement.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    fireEvent.change(input, { target: { files: [doc] } });
    expect(text()).toContain('Statement.docx is a DOCX file');
    expect(text()).toContain('A photo or PDF from your computer');
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

  it('shows a Missing receipt row’s date and total as the bank’s, not editable (review B10)', async () => {
    fake.waiting = [];
    fake.todo = [exp('miss2', { merchant: 'SHELL', cents: 4518, date: '2026-10-21', status: 'missing', receiptUrl: '', category: '' })];
    await show(['use_card_receipts']);
    fireEvent.click(document.querySelector('.ccr-todo') as HTMLElement);
    await settle();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add receipt' }));
    await settle();
    fireEvent.click(screen.getByLabelText('Edit bill details'));
    expect(text()).toContain('come from the bank’s statement');
    expect(document.querySelector('input#ccr-total')).toBeNull();
    expect(document.getElementById('ccr-total')?.textContent).toBe('$45.18');
    expect(document.getElementById('ccr-merchant')).not.toBeNull();
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
    // A row's Status says Waiting for approval, and under it the approvals (full words, since the column has the room).
    expect(text()).toContain('Waiting for approval');
    expect(document.querySelector('.ccr-stage-d')?.textContent).toContain('Accounting ✓');
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

  it('offers Void and Delete in ⋯ only with their switches, on a receipt that is not the viewer’s', async () => {
    await openWaiting(['use_card_receipts', 'approve_card_receipts', 'void_any_card_receipt', 'delete_card_receipts'], 'CHEVRON');
    expect(await menuItems()).toEqual(expect.arrayContaining(['Void receipt', 'Delete receipt…']));
    cleanup();
    await openWaiting(['use_card_receipts', 'approve_card_receipts'], 'CHEVRON');
    const plain = await menuItems();
    expect(plain).not.toContain('Void receipt');
    expect(plain).not.toContain('Delete receipt…');
  });

  it('puts Void and Delete in each row’s ⋯ and, for ticked receipts, in the header More menu', async () => {
    await show(['view_all_card_receipts', 'void_any_card_receipt', 'delete_card_receipts']);
    const rowMenus = screen.getAllByRole('button', { name: /^Actions for / });
    expect(rowMenus.length).toBeGreaterThan(0);
    fireEvent.click(rowMenus[0]!);
    await settle();
    expect([...document.querySelectorAll('.row-menu-popover [role="menuitem"]')].map((i) => i.textContent)).toEqual(expect.arrayContaining(['Void receipt', 'Delete receipt…']));
    fireEvent.keyDown(document, { key: 'Escape' });
    // Nothing ticked: the header menu has no bulk items (and no Export without its switch).
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    fireEvent.click(screen.getByLabelText(/Select Kashish/));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await settle();
    expect([...document.querySelectorAll('.row-menu-popover [role="menuitem"]')].map((i) => i.textContent)).toEqual(['Void 1 selected…', 'Delete 1 selected…']);
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
    // The queue is a field in the Filters panel, not a row on the page.
    expect(screen.queryByRole('radio', { name: /Asked of me/ })).toBeNull();
    field('queue');
    const options = optionTexts();
    for (const [label, n] of [['All', '3'], ['Needs Accounting', '1'], ['Needs second approval', '1'], ['Asked of me', '1']]) {
      expect(options.some((o) => o.startsWith(label!) && o.includes(n!))).toBe(true);
    }
    fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.startsWith('Asked of me'))!);
    expect(document.getElementById('ccr-f-queue')!.textContent).toContain('Asked of me');
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
    const box = (name: RegExp | string) => (screen.getByLabelText(name) as HTMLInputElement).checked;
    expect([box(/The cardholder/), box(/Branch managers/), box(/Accounting/), box(/Admins/), box(/Whoever still has to approve/)]).toEqual([true, false, false, false, true]);
    expect(text()).toContain('Ann Count, Ada Min');
    expect([box('Email'), box('Phone notification')]).toEqual([true, true]);
    fireEvent.change(document.getElementById('ccr-remind-message')!, { target: { value: 'Please finish these today' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to 3 people' }));
    await settle();
    const sent = fake.posted.at(-1)!;
    expect(sent.url).toMatch(/\/expenses\/remind$/);
    expect(new Set(sent.body.ids as string[])).toEqual(new Set(['b', 'c']));
    expect(sent.body).toMatchObject({
      to: { holder: true, managers: false, accounting: false, admins: false, approvers: true },
      email: true, push: true, message: 'Please finish these today'
    });
    expect(text()).toContain('3 people reminded about 1 receipt');
    expect(text()).toContain('Kashish Cuisine of India');
    expect(text()).toContain('reminded today');
    expect(text()).toContain('No phone with the app: Dana Whitfield (email only).');
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).find((b) => b.textContent === 'Close')!);
    await settle();
    expect(text()).not.toContain('selected');
  });

  it('does not repeat a missing receipt that is already on the month’s list', async () => {
    const before = EXPENSES.length;
    EXPENSES.push(exp('m1', { merchant: 'SHELL', status: 'missing', receiptUrl: '', category: '' }));
    try {
      fake.waiting = [];
      fake.todo = [EXPENSES[EXPENSES.length - 1]];
      await show(['use_card_receipts']);
      expect(document.querySelector('.ccr-banner')).toBeNull();
      expect(document.querySelector('.ccr-todos')).toBeNull();
      expect(text()).toContain('SHELL');
    } finally {
      EXPENSES.length = before;
    }
  });

  it('lists To do from an earlier month on a desktop too, so last month’s missing receipt isn’t hidden (review B1)', async () => {
    fake.waiting = [];
    fake.todo = [exp('sep1', { merchant: 'CHEVRON 0207730', date: '2026-09-30', status: 'missing', receiptUrl: '', category: '' })];
    await show(['use_card_receipts']);
    expect(document.querySelector('.ccr-banner')).toBeNull();
    expect(document.querySelector('.ccr-todos')?.textContent).toContain('From earlier months · 1');
    expect(document.querySelector('.ccr-todos')?.textContent).toContain('CHEVRON 0207730');
    expect(document.querySelector('.ccr-todos')?.textContent).toContain('09-30-2026');
    // Opening it works although September isn't the month on screen.
    fireEvent.click(document.querySelector('.ccr-todo') as HTMLElement);
    await settle();
    expect(screen.getByRole('dialog').textContent).toContain('CHEVRON 0207730');
  });

  it('offers a close receipt on a Missing receipt row, and "This is my receipt" uses it (review B2)', async () => {
    fake.waiting = [];
    fake.todo = [exp('miss1', { merchant: 'SUSHI KAI', cents: 4518, date: '2026-10-21', status: 'missing', receiptUrl: '', category: '' })];
    fake.near = { charge: { reference: 'R9', issuer: 'amex', date: '2026-10-21', cents: 4518, description: 'SUSHI KAI' },
      receipts: [{ id: 'near1', date: '2026-10-20', cents: 4500, merchant: 'Sushi Kai', status: 'approved', cardLabel: 'MARU92069', hasReceipt: true }] };
    await show(['use_card_receipts']);
    fireEvent.click(document.querySelector('.ccr-todo') as HTMLElement);
    await settle();
    expect(text()).toContain('Already uploaded this one?');
    expect(text()).toContain('Sushi Kai · $45.00');
    fireEvent.click(screen.getByRole('button', { name: 'This is my receipt' }));
    expect(text()).toContain('Its total becomes $45.18 and its date becomes 10-21-2026, and it goes back for approval. This Missing receipt goes away.');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, use it' }));
    await settle();
    expect(fake.posted.at(-1)).toEqual({ url: expect.stringMatching(/\/expenses\/miss1\/use-receipt$/), body: { receiptId: 'near1' } });
    expect(text()).toContain('Matched to the charge');
    expect(document.querySelector('.ccr-todos')).toBeNull();
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

describe('checks that never block (2026-11-24)', () => {
  it('reads Waiting for me and To do again when the page comes back into view, at most every 30 s', async () => {
    const now = vi.spyOn(Date, 'now');
    let clock = 1_000_000;
    now.mockImplementation(() => clock);
    try {
      await show(['use_card_receipts', 'approve_card_receipts']);
      const count = () => ({ waiting: fake.asked.filter((u) => /scope=waiting/.test(u)).length, todo: fake.asked.filter((u) => /scope=todo/.test(u)).length });
      const first = count();
      clock += 5_000;
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      await settle();
      expect(count()).toEqual(first);
      clock += 30_000;
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
      await settle();
      expect(count()).toEqual({ waiting: first.waiting + 1, todo: first.todo + 1 });
    } finally {
      now.mockRestore();
    }
  });

  it('says when subtotal, tax and tip don’t add up to the total, on the opened receipt', async () => {
    fake.waiting = [WAITING_SECOND];
    await show(['use_card_receipts', 'approve_card_receipts']);
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    fireEvent.click(screen.getByLabelText(/Open Home Depot/));
    expect(text()).toContain('Subtotal, tax and tip add up to $14.32, not the total of $189.00. Check them.');
    // Still approvable: it's a check, not a block.
    expect((screen.getByRole('button', { name: 'Approve receipt' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says so while the bill details are typed, and still saves', async () => {
    fake.waiting = [];
    await show(['use_card_receipts']);
    fireEvent.click(screen.getByLabelText('Add receipt'));
    fireEvent.click(screen.getByRole('button', { name: /Lost Receipt/ }));
    fireEvent.click(screen.getByLabelText('Edit bill details'));
    fireEvent.change(document.getElementById('ccr-merchant')!, { target: { value: 'Shell' } });
    fireEvent.change(document.getElementById('ccr-total')!, { target: { value: '43.20' } });
    fireEvent.change(document.getElementById('ccr-subtotal')!, { target: { value: '38.20' } });
    fireEvent.change(document.getElementById('ccr-tax')!, { target: { value: '3.00' } });
    expect(text()).toContain('add up to $41.20, not the total of $43.20');
    fireEvent.change(document.getElementById('ccr-tip')!, { target: { value: '2.00' } });
    expect(text()).not.toContain('add up to');
    fireEvent.change(document.getElementById('ccr-tip')!, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // Back on the form, the bill card says it too.
    expect(text()).toContain('add up to $41.20, not the total of $43.20');
  });

  it('warns when the photo is already on a receipt, sending the file’s fingerprint', async () => {
    fake.waiting = [];
    fake.duplicate = { seen: true, own: true, holderName: 'Maruthi Ponugupati', merchant: 'Chevron', date: '2026-10-03', cents: 4518, status: 'waiting' };
    await show(['use_card_receipts']);
    fireEvent.click(screen.getByLabelText('Add receipt'));
    const input = document.querySelector('input[accept="application/pdf,image/*"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7 receipt'], 'chevron.pdf', { type: 'application/pdf' })] } });
    await settle();
    const sent = fake.posted.find((p) => /\/attachments$/.test(p.url))!;
    expect(String(sent.body.hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(text()).toContain('This photo is already on your receipt (Chevron, $45.18, 10-03-2026, waiting for approval).');
  });
});

describe('on a phone (owner’s design, 2026-11-26)', () => {
  const phone = (on: boolean) => {
    window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  };
  beforeEach(() => phone(true));
  afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; });

  it('has the Customers header: search on its own row, the tabs, then Filters with the period beside it — and no Select button', async () => {
    fake.waiting = [];
    await show(['view_all_card_receipts', 'export_card_receipts']);
    expect(document.querySelector('.ccr-psearch input')).toBeTruthy();
    expect(document.querySelector('.ccr-more-sq')).toBeTruthy();
    const bar = document.querySelector('.ccr-fbar') as HTMLElement;
    expect(bar.querySelector('.lf-btn')).toBeTruthy();
    expect(bar.textContent).toContain('October 2026');
    // Not the old subtitle beside the title, and no Select button anywhere.
    expect(document.querySelector('.ccr-head .ccr-ttl-sub')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });

  it('lists receipts under a heading per day, holder and card ID first, with the status in words on the right', async () => {
    fake.waiting = [];
    await show(['view_all_card_receipts']);
    const day = screen.getByRole('region', { name: 'Fri, Oct 9' });
    // The day's total, and the row's own amount.
    expect(within(day).getAllByText('$115.79')).toHaveLength(2);
    const row = within(day).getByRole('button');
    expect(within(row).getByText('Maruthi Ponugupati')).toBeTruthy();
    expect(within(row).getByText('MARU92069')).toBeTruthy();
    expect(within(row).getByText('JINYA Ramen Bar')).toBeTruthy();
    expect(within(row).getByText('Waiting').className).toContain('is-wait');
    expect(document.querySelector('.ccr-pr .ccr-av')).toBeNull();
  });

  it('shows an earlier month’s missing receipt as one card with Upload receipt, in place of the banner and the To do grid', async () => {
    fake.waiting = [];
    fake.todo = [exp('m9', { merchant: 'CHEVRON', cents: 7103, status: 'missing', receiptUrl: '', category: '', date: '2026-10-12' })];
    await show(['use_card_receipts']);
    expect(screen.getByRole('region', { name: 'From earlier months' }).textContent).toContain('From earlier months · 1');
    expect(document.querySelector('.ccr-banner')).toBeNull();
    expect(document.querySelector('.ccr-todos')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Upload receipt' }));
    await settle();
    expect(screen.getByRole('dialog').textContent).toContain('CHEVRON');
  });

  it('approves from a row in Waiting for me in one tap', async () => {
    fake.waiting = [WAITING_SECOND];
    await show(['approve_card_receipts', 'view_all_card_receipts']);
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await settle();
    const sent = fake.posted.find((p) => /\/expenses\/w2\/approve$/.test(p.url));
    expect(sent).toBeTruthy();
    expect(sent!.body.comment).toBe('');
    expect(text()).toContain('Approved');
  });

  it('sends back from a row with a comment, and not without one', async () => {
    fake.waiting = [{ ...WAITING_SECOND, id: 'w4', actions: ACCOUNTING_ACTIONS }];
    await show(['approve_card_receipts', 'view_all_card_receipts']);
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await settle();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send back' }));
    await settle();
    expect(fake.posted.some((p) => /send-back$/.test(p.url))).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Comment/), { target: { value: 'Which customer was this for?' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send back' }));
    await settle();
    const sent = fake.posted.find((p) => /\/expenses\/w4\/send-back$/.test(p.url));
    expect(sent?.body.comment).toBe('Which customer was this for?');
  });

  it('leaves the desktop alone off a phone: the toolbar, not the phone header', async () => {
    phone(false);
    fake.waiting = [];
    await show(['use_card_receipts']);
    expect(document.querySelector('.ccr-psearch')).toBeNull();
    expect(document.querySelector('.ccr-fbar')).toBeNull();
    expect(document.querySelector('.ccr-tools')).toBeTruthy();
  });
});
