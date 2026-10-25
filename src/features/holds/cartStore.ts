import { useSyncExternalStore } from 'react';
import * as api from '../../api/holds';
import type { AddResult, Cart, CartState, CartToastState, CartView, Hold, ScanResult } from './types';
import type { Id } from '../../types/api';

/**
 * One cart, shared by the side-rail button, the cart drawer and the inventory
 * checkboxes (2026-10-10), so ticking a slab anywhere updates all three.
 * The server is the source of truth (src/holds/router.js); this keeps the
 * latest copy and the drawer's open/closed state.
 *
 * `reservationsTick` goes up whenever slabs were held, released or carted by
 * someone else (the 'slab_reservations_changed' socket event, see
 * src/features/salesShell/useSalesLiveUpdates.ts),
 * so screens showing slab locks know to refresh; `changedKeys` says which slabs
 * (empty = unknown, refresh everything).
 *
 * Ticking is instant: a slab being added or removed is in `pendingAdd` /
 * `pendingRemove` from the click until the server answers, and `cartKeys` (what
 * the checkboxes show) counts it as already done. The server's answer replaces
 * it; a refusal ("On Hold #12") just takes it back with a message. Your own
 * change comes back to you as a socket event too — it's recognised (`mine`) and
 * ignored, so a tick isn't followed by a second download of the cart and a
 * re-check of every slab on the list.
 */
let state: CartState = {
  cart: { customer: null, lines: [] },
  loaded: false,
  loading: false,
  error: '',
  open: false,
  expanded: false,
  view: 'cart',          // 'cart' | 'checkout'
  toast: null,           // { kind: 'added' | 'removed' | 'held' | 'error', text, undo?, holdId? }
  reservationsTick: 0,
  changedKeys: [],
  pendingAdd: new Set(),
  pendingRemove: new Set()
};
const listeners = new Set<() => void>();
const set = (patch: Partial<CartState> | ((s: CartState) => Partial<CartState>)) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toast = (t: CartToastState | null, ms = 5000) => {
  clearTimeout(toastTimer);
  set({ toast: t });
  if (t) toastTimer = setTimeout(() => set({ toast: null }), ms);
};

const take = (cart: Cart) => set({ cart, loaded: true, loading: false, error: '' });

/** Mark slabs as being added/removed (on) or settled (off). */
const pending = (kind: 'add' | 'remove', keys: string[], on: boolean) => set((s) => {
  const field = kind === 'add' ? 'pendingAdd' : 'pendingRemove';
  const next = new Set(s[field]);
  keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
  return { [field]: next };
});

/** The slab keys the checkboxes should show as in the cart: the server's, plus what's being added, minus what's being removed. */
export const cartKeysOf = (s: Pick<CartState, 'cart' | 'pendingAdd' | 'pendingRemove'>): Set<string> => {
  const keys = new Set(s.cart.lines.map((l) => l.slabKey));
  s.pendingAdd.forEach((k) => keys.add(k));
  s.pendingRemove.forEach((k) => keys.delete(k));
  return keys;
};

// Slabs this person just added or removed, so the socket echo of it is recognised.
const MINE_FOR_MS = 8000;
const mine = new Map<string, number>();
const markMine = (keys: string[]) => { const now = Date.now(); keys.forEach((k) => mine.set(k, now)); };
const isMine = (keys: string[]) => {
  const now = Date.now();
  for (const [k, at] of mine) if (now - at > MINE_FOR_MS) mine.delete(k);
  return keys.length > 0 && keys.every((k) => mine.has(k));
};

export const cartActions = {
  async load() {
    set({ loading: true });
    try { take(await api.getCart() as Cart); } catch (err) { set({ loading: false, error: (err as Error).message }); }
  },
  open(view: CartView = 'cart') { set({ open: true, view }); if (!state.loaded) cartActions.load(); },
  close() { set({ open: false, view: 'cart', expanded: false }); },
  setExpanded(expanded: boolean) { set({ expanded }); },
  setView(view: CartView) { set({ view }); },
  dismissToast() { toast(null); },

  /** Tick or bundle from the inventory screen. */
  async add(slabKeys: string[]): Promise<AddResult | null> {
    const keys = [...new Set(slabKeys)];
    pending('add', keys, true);
    markMine(keys);
    try {
      const res = await api.addToCart(slabKeys) as AddResult;
      take(res.cart);
      if (res.added.length) {
        const n = res.cart.lines.length;
        toast({ kind: 'added', text: `${res.added.length === 1 ? res.added[0] : `${res.added.length} slabs`} added · cart has ${n} slab${n === 1 ? '' : 's'}` });
      } else if (res.skipped.length) {
        toast({ kind: 'error', text: `${res.skipped[0].slabKey}: ${res.skipped[0].reason}` });
      }
      return res;
    } catch (err) {
      toast({ kind: 'error', text: (err as Error).message });
      return null;
    } finally {
      pending('add', keys, false);
    }
  },

  async scan(code: string): Promise<ScanResult> {
    const res = await api.scanIntoCart(code) as ScanResult; // throws: the scan box shows the message
    take(res.cart);
    return res;
  },

  /** Remove with Undo. */
  async remove(slabKey: string, { silent = false }: { silent?: boolean } = {}) {
    const before = state.cart.lines.find((l) => l.slabKey === slabKey);
    pending('remove', [slabKey], true);
    markMine([slabKey]);
    try {
      take(await api.removeFromCart(slabKey) as Cart);
      if (!silent) toast({ kind: 'removed', text: `Removed ${slabKey}`, undo: before ? [slabKey] : null }, 6000);
    } catch (err) {
      toast({ kind: 'error', text: (err as Error).message });
    } finally {
      pending('remove', [slabKey], false);
    }
  },
  /** Several at once (a bundle ticked off): one request. */
  async removeMany(slabKeys: string[], { silent = false }: { silent?: boolean } = {}) {
    const keys = [...new Set(slabKeys)];
    if (!keys.length) return;
    const had = keys.filter((k) => state.cart.lines.some((l) => l.slabKey === k));
    pending('remove', keys, true);
    markMine(keys);
    try {
      take(await api.removeManyFromCart(keys) as Cart);
      if (!silent) toast({ kind: 'removed', text: keys.length === 1 ? `Removed ${keys[0]}` : `Removed ${keys.length} slabs`, undo: had.length ? had : null }, 6000);
    } catch (err) {
      toast({ kind: 'error', text: (err as Error).message });
    } finally {
      pending('remove', keys, false);
    }
  },
  async undo(slabKeys: string[]) {
    toast(null);
    await cartActions.add(slabKeys);
  },
  async clear() {
    try { take(await api.clearCart() as Cart); } catch (err) { toast({ kind: 'error', text: (err as Error).message }); }
  },
  /**
   * Choose (or clear) the cart's customer. The cart shows it at once — the name comes
   * from the picker — and the server's answer replaces it; a refusal puts the old one
   * back. Otherwise "Create hold" tapped right after picking opened with no customer.
   */
  async setCustomer(customerId: Id | null, name = '') {
    const before = state.cart.customer;
    set((s) => ({ cart: { ...s.cart, customer: customerId ? { id: customerId, name } : null } }));
    try {
      take(await api.setCartCustomer(customerId || null) as Cart);
    } catch (err) {
      set((s) => ({ cart: { ...s.cart, customer: before } }));
      toast({ kind: 'error', text: (err as Error).message });
    }
  },
  async setNote(slabKey: string, note: string) {
    try { take(await api.setCartNote(slabKey, note) as Cart); } catch (err) { toast({ kind: 'error', text: (err as Error).message }); }
  },

  /** After a hold was created from the cart. */
  held(hold: Hold) {
    set({ view: 'cart' });
    toast({ kind: 'held', text: `Hold #${hold.number} created for ${hold.customer?.name || 'the customer'}`, holdId: hold._id }, 8000);
    cartActions.load();
  },

  /**
   * Someone held, released or carted slabs: refresh what shows locks. Your own
   * change is skipped (it's already on screen), and a burst of events becomes one
   * refresh — the cart once, and only the slabs that changed.
   */
  reservationsChanged(slabKeys: string[] = []) {
    if (isMine(slabKeys)) { slabKeys.forEach((k) => mine.delete(k)); return; }
    slabKeys.forEach((k) => burst.keys.add(k));
    if (!slabKeys.length) burst.all = true;
    clearTimeout(burst.timer);
    burst.timer = setTimeout(flushBurst, BURST_MS);
  }
};

const BURST_MS = 250;
const burst: { keys: Set<string>; all: boolean; timer: ReturnType<typeof setTimeout> | undefined } = { keys: new Set(), all: false, timer: undefined };
const flushBurst = () => {
  const keys = burst.all ? [] : [...burst.keys];
  burst.keys = new Set();
  burst.all = false;
  set((s) => ({ reservationsTick: s.reservationsTick + 1, changedKeys: keys }));
  if (state.loaded && (!keys.length || state.cart.lines.some((l) => keys.includes(l.slabKey)))) cartActions.load();
};

export const useCart = (): CartState => useSyncExternalStore(subscribe, () => state);

/** Test hook: the current state without React. */
export const cartSnapshot = (): CartState => state;
