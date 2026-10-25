// @vitest-environment jsdom
// Cart & Holds render: the Holds list (table and phone cards, status tabs),
// a hold's page with its tabs, forms and print preview, a read-only hold, the
// cart rail button and drawer (slabs, a held and a sold slab, checkout, empty,
// no Create hold). The API is a fake keyed on the URL; pdf.js can't run here.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const slab = (key: string, o: Record<string, unknown> = {}) => ({ slabKey: key, serial: key, product: 'Taj Mahal 3CM', bundle: 'B1', dimensions: '126 x 63', sfHundredths: 5500, ...o });
const lines = [{ ...slab('TM-1'), priceCentsPerSf: 2250, note: 'Book-matched' }, { ...slab('TM-2', { bundle: 'B2' }), priceCentsPerSf: null, note: '' }];
const totals = { slabs: 2, sfHundredths: 11000, pricedCents: 123750, missingPrices: 1, totalCents: null };
const hold = {
  _id: 'h1', number: 1042, version: 2, status: 'active', branch: 'Seattle', customer: { id: 'c1', name: 'Pacific Granite', phone: '206-555-0101' },
  job: 'Lee kitchen', chanceToClose: 50, notes: 'Friday visit', commissionNotes: '', createdBy: { name: 'Krish' }, createdAt: '2026-10-18T17:00:00Z',
  expiresOn: day(5), expiresAt: `${day(6)}T07:00:00Z`, lines, slabKeys: ['TM-1', 'TM-2'], totals,
  history: [{ _id: 'e1', action: 'created', by: { name: 'Krish' }, at: '2026-10-18T17:00:00Z' }]
};
const list = {
  items: [{ ...hold, products: [{ product: 'Taj Mahal 3CM', slabs: 2 }] }], total: 1, page: 1, limit: 50, scope: 'branch', scopes: ['mine', 'branch', 'all'],
  counts: { active: 1, expiring: 0, expired: 0, released: 0, converted: 0, all: 1 }
};
const cartLine = (key: string, o: Record<string, unknown> = {}) => ({ slabKey: key, note: '', slab: slab(key), inStock: true, lock: null, othersInCart: [], ...o });
let cart: { customer: unknown; lines: unknown[] } = { customer: null, lines: [] };
const fullCart = {
  customer: { id: 'c1', name: 'Pacific Granite' },
  lines: [cartLine('TM-5'), cartLine('TM-6', { slab: slab('TM-6', { bundle: 'B2' }) }), cartLine('BP-1', { lock: { holdNumber: 1043, by: 'Rita' } }), cartLine('GONE', { slab: null, inStock: false })]
};
const routes: [RegExp, () => unknown][] = [
  [/\/api\/holds\/cart/, () => cart],
  [/\/api\/holds\/meta/, () => ({ scopes: ['branch'], branches: ['Seattle', 'Spokane'], defaultBranch: 'Seattle', defaultExpiresOn: day(7) })],
  [/\/api\/holds\/h1\/pdf/, () => ({})],
  [/\/api\/holds\/h1/, () => hold],
  [/\/api\/holds(\?|$)/, () => list],
  [/\/api\/customers\/dropdown/, () => [{ _id: 'c1', company: 'Pacific Granite' }]],
  [/\/api\/admin\/locations/, () => [{ name: 'Seattle' }, { name: 'Spokane' }]]
];
const answer = (url: string) => {
  const hit = routes.find(([re]) => re.test(String(url)));
  return Promise.resolve(new Response(JSON.stringify(hit ? hit[1]() : []), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string) => answer(u), resetSessionExpiredGuard() {} }));
vi.mock('pdfjs-dist/legacy/build/pdf.min.mjs', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(new Error('No PDF in tests')) }) }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));

const { default: HoldsTab } = await import('./HoldsTab');
const { default: CartDrawer } = await import('./cart/CartDrawer');
const { CartRailButton, cartSnapshot, cartActions } = await import('./index');

const ALL = ['use_cart', 'view_own_holds', 'view_branch_holds', 'view_all_holds', 'create_holds', 'edit_hold_details', 'edit_hold_slabs',
  'edit_hold_prices', 'extend_holds', 'release_holds', 'print_holds', 'view_hold_history'];
const userWith = (permissions: string[]) => ({ _id: 'u1', id: 'u1', name: 'Krish', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'], permissions });
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLElement;
const resetCart = () => {
  cartActions.dismissToast();
  Object.assign(cartSnapshot(), { cart: { customer: null, lines: [] }, loaded: false, loading: false, error: '', open: false, expanded: false, view: 'cart', toast: null, pendingAdd: new Set(), pendingRemove: new Set() });
};
const setPhone = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
};

beforeEach(() => { resetCart(); cart = { customer: null, lines: [] }; setPhone(false); window.history.replaceState({}, '', '/sales?tab=holds'); });
afterEach(() => cleanup());

describe('Holds list', () => {
  it('shows the holds as a table and as phone cards, with the tab counts', async () => {
    render(<HoldsTab currentUser={userWith(ALL)} />);
    await settle();
    expect(screen.getByRole('heading', { name: 'Holds' })).toBeTruthy();
    expect(document.querySelector('.hl-table .hl-num')?.textContent).toBe('#1042');
    expect(document.querySelector('.hl-ccard')?.textContent).toContain('Hold #1042');
    expect(screen.getByText('Lee kitchen')).toBeTruthy();
    expect(screen.getAllByText('1 without a price').length).toBe(2);
    expect(screen.getByRole('tab', { name: /Active/ }).textContent).toBe('Active1');
    expect(screen.getByRole('group', { name: 'Whose holds' }).textContent).toBe('MineMy branchesAll locations');
  });

  it('opens a hold from its row, and Back returns to the list', async () => {
    render(<HoldsTab currentUser={userWith(ALL)} />);
    await settle();
    fireEvent.click(document.querySelector('.hl-row') as Element);
    await settle();
    expect(window.location.search).toContain('hold=h1');
    expect(screen.getByRole('heading', { name: 'Hold #1042' })).toBeTruthy();
    fireEvent.click(document.querySelector('.hl-back') as Element);
    await settle();
    expect(document.querySelector('.hl-table')).toBeTruthy();
  });
});

describe('A hold', () => {
  const openHold = async (perms = ALL) => {
    window.history.replaceState({}, '', '/sales?tab=holds&hold=h1');
    render(<HoldsTab currentUser={userWith(perms)} />);
    await settle();
  };

  it('shows its slabs, prices and totals, then its notes and history', async () => {
    await openHold();
    expect(screen.getByText('Book-matched')).toBeTruthy();
    expect(screen.getByText('Total so far')).toBeTruthy();
    expect(screen.getByText('1 slab has no price yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByText('Friday visit')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /History/ }));
    expect(screen.getByText(/Krish ·/)).toBeTruthy();
  });

  it('opens Edit, Extend and Release, and the price editor', async () => {
    await openHold();
    fireEvent.click(button('Edit'));
    expect(screen.getByText('Commission notes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Close/ }));
    await settle();
    fireEvent.click(button('Extend'));
    expect(screen.getByText('Now held until')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Close/ }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Release hold/ }));
    expect(screen.getByText('Customer passed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Close/ }));
    await settle();
    fireEvent.click(button('Edit prices'));
    expect(screen.getByLabelText('Price per SF for every Taj Mahal 3CM slab')).toBeTruthy();
    expect(button('Save prices')).toBeTruthy();
  });

  it('ticks slabs into the selection bar', async () => {
    await openHold();
    fireEvent.click(screen.getByLabelText('Select TM-1'));
    expect(screen.getByRole('region', { name: 'Selected slabs' }).textContent).toContain('1 selected');
    fireEvent.click(button('Remove from hold'));
    expect(screen.getByText('Remove 1 slab from Hold #1042?')).toBeTruthy();
  });

  it('shows the print preview (here, pdf.js fails and says so)', async () => {
    await openHold();
    fireEvent.click(button('Print'));
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    await settle();
    expect(screen.getByRole('dialog', { name: 'Hold #1042 print preview' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('No PDF in tests');
  });

  it('is read-only for someone who can only see it', async () => {
    await openHold(['view_own_holds']);
    expect(screen.getByRole('heading', { name: 'Hold #1042' })).toBeTruthy();
    expect(button('Edit')).toBeUndefined();
    expect(button('Extend')).toBeUndefined();
    expect(document.querySelector('.hl-chk')).toBeNull();
    expect(screen.queryByRole('tab', { name: /History/ })).toBeTruthy(); // the API sent it
  });

  it('renders on a phone', async () => {
    setPhone(true);
    await openHold();
    expect(screen.getByRole('heading', { name: 'Hold #1042' })).toBeTruthy();
  });
});

describe('The cart', () => {
  it('counts the slabs on the rail and opens the drawer', async () => {
    cart = fullCart;
    const user = userWith(ALL);
    render(<><CartRailButton user={user} /><CartDrawer user={user} /></>);
    await settle();
    expect(document.querySelector('.cd-rail-badge')?.textContent).toBe('4');
    fireEvent.click(screen.getByRole('button', { name: 'Cart, 4 slabs' }));
    await settle();
    const drawer = screen.getByRole('dialog', { name: 'Cart' });
    expect(drawer.textContent).toContain('On Hold #1043 · Rita');
    expect(drawer.textContent).toContain('No longer in stock');
    expect(drawer.textContent).toContain('From 2 bundles (B1, B2) · colour may vary');
    expect(drawer.textContent).toContain('2 of 4 slabs');
    fireEvent.click(button('Hold 2 slabs'));
    await settle();
    expect(screen.getByRole('dialog', { name: 'Create hold' }).textContent).toContain('Create Hold');
    expect(screen.getByRole('radiogroup', { name: 'Hold until' })).toBeTruthy();
  });

  it('says when the cart is empty', async () => {
    render(<CartDrawer user={userWith(ALL)} />);
    act(() => cartActions.open());
    await settle();
    expect(screen.getByText('Your cart is empty')).toBeTruthy();
  });

  it('has no Hold button without Create hold', async () => {
    cart = fullCart;
    render(<CartDrawer user={userWith(['use_cart'])} />);
    act(() => cartActions.open());
    await settle();
    expect(screen.getByText('Prices are entered at checkout')).toBeTruthy();
    expect(document.querySelector('.cd-foot-actions')).toBeNull();
  });

  it('is not on the rail without Use cart', async () => {
    render(<CartRailButton user={userWith(['view_own_holds'])} />);
    await settle();
    expect(document.querySelector('.cd-rail')).toBeNull();
  });
});
