// The cart store's behaviour that makes ticking feel instant and keeps the
// inventory screen quiet: a slab shows as in the cart the moment it is ticked,
// your own change's socket echo doesn't start a second download, a burst of
// events is one refresh, and the cart's customer shows as soon as it is picked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const api = {
  getCart: vi.fn(), addToCart: vi.fn(), removeFromCart: vi.fn(), removeManyFromCart: vi.fn(),
  setCartCustomer: vi.fn(), clearCart: vi.fn(), scanIntoCart: vi.fn(), setCartNote: vi.fn()
};
vi.mock('../../api/holds', () => api);

let store: typeof import('./cartStore');
const line = (slabKey: string) => ({ slabKey, note: '', slab: null, inStock: true, lock: null, othersInCart: [] });
const cartOf = (...keys: string[]) => ({ customer: null, lines: keys.map(line) });
const deferred = () => {
  let resolve!: (value: unknown) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

beforeEach(async () => {
  vi.resetModules();
  Object.values(api).forEach((fn) => fn.mockReset());
  vi.useFakeTimers();
  store = await import('./cartStore');
});
afterEach(() => vi.useRealTimers());

const keys = () => store.cartKeysOf(store.cartSnapshot());

describe('ticking', () => {
  it('shows the slab in the cart at once, before the server answers', async () => {
    const answer = deferred();
    api.addToCart.mockReturnValue(answer.promise);
    const done = store.cartActions.add(['A-1']);
    expect([...keys()]).toEqual(['A-1']);
    expect(store.cartSnapshot().cart.lines).toEqual([]); // the real cart is still the server's
    answer.resolve({ added: ['A-1'], skipped: [], cart: cartOf('A-1') });
    await done;
    expect([...keys()]).toEqual(['A-1']);
    expect(store.cartSnapshot().pendingAdd.size).toBe(0);
    expect(store.cartSnapshot().toast?.text).toMatch(/A-1 added · cart has 1 slab/);
  });

  it('takes it back, with the reason, when the server refuses', async () => {
    api.addToCart.mockResolvedValue({ added: [], skipped: [{ slabKey: 'A-1', reason: 'On Hold #12 (Maria)' }], cart: cartOf() });
    await store.cartActions.add(['A-1']);
    expect([...keys()]).toEqual([]);
    expect(store.cartSnapshot().toast).toMatchObject({ kind: 'error', text: 'A-1: On Hold #12 (Maria)' });
  });

  it('takes it back when the request fails', async () => {
    api.addToCart.mockRejectedValue(new Error('Couldn’t reach the server.'));
    await store.cartActions.add(['A-1']);
    expect([...keys()]).toEqual([]);
    expect(store.cartSnapshot().pendingAdd.size).toBe(0);
    expect(store.cartSnapshot().toast?.kind).toBe('error');
  });

  it('shows a removal at once too, and a bundle comes off in one request', async () => {
    api.addToCart.mockResolvedValue({ added: ['A-1', 'A-2', 'A-3'], skipped: [], cart: cartOf('A-1', 'A-2', 'A-3') });
    await store.cartActions.add(['A-1', 'A-2', 'A-3']);
    const answer = deferred();
    api.removeManyFromCart.mockReturnValue(answer.promise);
    const done = store.cartActions.removeMany(['A-1', 'A-2'], { silent: true });
    expect([...keys()]).toEqual(['A-3']);
    answer.resolve(cartOf('A-3'));
    await done;
    expect(api.removeManyFromCart).toHaveBeenCalledTimes(1);
    expect(api.removeManyFromCart).toHaveBeenCalledWith(['A-1', 'A-2']);
    expect(api.removeFromCart).not.toHaveBeenCalled();
    expect([...keys()]).toEqual(['A-3']);
  });
});

describe('socket events', () => {
  const ticks = () => store.cartSnapshot().reservationsTick;

  it('ignores the echo of your own change — no cart reload, no lock re-check', async () => {
    api.addToCart.mockResolvedValue({ added: ['A-1'], skipped: [], cart: cartOf('A-1') });
    api.getCart.mockResolvedValue(cartOf('A-1'));
    await store.cartActions.add(['A-1']);
    store.cartActions.reservationsChanged(['A-1']);
    vi.advanceTimersByTime(1000);
    expect(ticks()).toBe(0);
    expect(api.getCart).not.toHaveBeenCalled();
  });

  it('only ignores the first echo — a later change to the same slab by someone else counts', async () => {
    api.addToCart.mockResolvedValue({ added: ['A-1'], skipped: [], cart: cartOf('A-1') });
    api.getCart.mockResolvedValue(cartOf('A-1'));
    await store.cartActions.add(['A-1']);
    store.cartActions.reservationsChanged(['A-1']);
    store.cartActions.reservationsChanged(['A-1']);
    vi.advanceTimersByTime(300);
    expect(ticks()).toBe(1);
  });

  it('turns a burst of someone else’s events into one refresh of just those slabs', async () => {
    api.addToCart.mockResolvedValue({ added: ['A-1'], skipped: [], cart: cartOf('A-1') });
    api.getCart.mockResolvedValue(cartOf('A-1'));
    await store.cartActions.add(['A-1']);
    store.cartActions.reservationsChanged(['A-1']); // the echo of our own add: ignored
    api.getCart.mockClear();
    store.cartActions.reservationsChanged(['B-2']);
    store.cartActions.reservationsChanged(['B-3']);
    store.cartActions.reservationsChanged(['A-1']);
    expect(ticks()).toBe(0); // waiting to see if more come
    vi.advanceTimersByTime(300);
    expect(ticks()).toBe(1);
    expect(store.cartSnapshot().changedKeys.sort()).toEqual(['A-1', 'B-2', 'B-3']);
    expect(api.getCart).toHaveBeenCalledTimes(1); // A-1 is in the cart, so it is reloaded once
  });

  it('does not reload the cart for slabs that are not in it', async () => {
    api.getCart.mockResolvedValue(cartOf('A-1'));
    await store.cartActions.load();
    api.getCart.mockClear();
    store.cartActions.reservationsChanged(['Z-9']);
    vi.advanceTimersByTime(300);
    expect(ticks()).toBe(1);
    expect(api.getCart).not.toHaveBeenCalled();
  });

  it('refreshes everything when an event does not say which slabs', async () => {
    store.cartActions.reservationsChanged([]);
    vi.advanceTimersByTime(300);
    expect(store.cartSnapshot().changedKeys).toEqual([]);
    expect(ticks()).toBe(1);
  });
});

describe('the cart’s customer', () => {
  it('shows as soon as it is picked, so Create hold right after has it', async () => {
    const answer = deferred();
    api.setCartCustomer.mockReturnValue(answer.promise);
    const done = store.cartActions.setCustomer('c1', 'Bella Pietra');
    expect(store.cartSnapshot().cart.customer).toEqual({ id: 'c1', name: 'Bella Pietra' });
    answer.resolve({ ...cartOf(), customer: { id: 'c1', name: 'Bella Pietra' } });
    await done;
    expect(store.cartSnapshot().cart.customer).toEqual({ id: 'c1', name: 'Bella Pietra' });
  });

  it('puts the old customer back, with a message, if the server refuses', async () => {
    api.setCartCustomer.mockResolvedValueOnce({ ...cartOf(), customer: { id: 'c0', name: 'First' } });
    await store.cartActions.setCustomer('c0', 'First');
    api.setCartCustomer.mockRejectedValueOnce(new Error('That customer no longer exists.'));
    await store.cartActions.setCustomer('c1', 'Second');
    expect(store.cartSnapshot().cart.customer).toEqual({ id: 'c0', name: 'First' });
    expect(store.cartSnapshot().toast?.text).toBe('That customer no longer exists.');
  });

  it('clears at once', async () => {
    api.setCartCustomer.mockResolvedValue(cartOf());
    const done = store.cartActions.setCustomer(null);
    expect(store.cartSnapshot().cart.customer).toBeNull();
    await done;
  });
});
