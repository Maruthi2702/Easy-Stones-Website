import { useSyncExternalStore } from 'react';
import * as api from '../../../api/holds';

/**
 * One cart, shared by the side-rail button, the cart drawer and the inventory
 * checkboxes (2026-10-10), so ticking a slab anywhere updates all three.
 * The server is the source of truth (src/holds/router.js); this keeps the
 * latest copy and the drawer's open/closed state.
 *
 * `reservationsTick` goes up whenever slabs were held, released or carted by
 * anyone (the 'slab_reservations_changed' socket event, see SalesPage.jsx),
 * so screens showing slab locks know to refresh.
 */
let state = {
  cart: { customer: null, lines: [] },
  loaded: false,
  loading: false,
  error: '',
  open: false,
  expanded: false,
  view: 'cart',          // 'cart' | 'checkout'
  toast: null,           // { kind: 'added' | 'removed' | 'held' | 'error', text, undo?, holdId? }
  reservationsTick: 0
};
const listeners = new Set();
const set = (patch) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

let toastTimer = null;
const toast = (t, ms = 5000) => {
  clearTimeout(toastTimer);
  set({ toast: t });
  if (t) toastTimer = setTimeout(() => set({ toast: null }), ms);
};

const take = (cart) => set({ cart, loaded: true, loading: false, error: '' });

export const cartActions = {
  async load() {
    set({ loading: true });
    try { take(await api.getCart()); } catch (err) { set({ loading: false, error: err.message }); }
  },
  open(view = 'cart') { set({ open: true, view }); if (!state.loaded) cartActions.load(); },
  close() { set({ open: false, view: 'cart', expanded: false }); },
  setExpanded(expanded) { set({ expanded }); },
  setView(view) { set({ view }); },
  dismissToast() { toast(null); },

  /** Tick or bundle from the inventory screen. */
  async add(slabKeys) {
    try {
      const res = await api.addToCart(slabKeys);
      take(res.cart);
      if (res.added.length) {
        const n = res.cart.lines.length;
        toast({ kind: 'added', text: `${res.added.length === 1 ? res.added[0] : `${res.added.length} slabs`} added · cart has ${n} slab${n === 1 ? '' : 's'}` });
      } else if (res.skipped.length) {
        toast({ kind: 'error', text: `${res.skipped[0].slabKey}: ${res.skipped[0].reason}` });
      }
      return res;
    } catch (err) {
      toast({ kind: 'error', text: err.message });
      return null;
    }
  },

  async scan(code) {
    const res = await api.scanIntoCart(code); // throws: the scan box shows the message
    take(res.cart);
    return res;
  },

  /** Remove with Undo. */
  async remove(slabKey, { silent = false } = {}) {
    const before = state.cart.lines.find((l) => l.slabKey === slabKey);
    try {
      take(await api.removeFromCart(slabKey));
      if (!silent) toast({ kind: 'removed', text: `Removed ${slabKey}`, undo: before ? [slabKey] : null }, 6000);
    } catch (err) {
      toast({ kind: 'error', text: err.message });
    }
  },
  async undo(slabKeys) {
    toast(null);
    await cartActions.add(slabKeys);
  },
  async clear() {
    try { take(await api.clearCart()); } catch (err) { toast({ kind: 'error', text: err.message }); }
  },
  async setCustomer(customerId) {
    try { take(await api.setCartCustomer(customerId || null)); } catch (err) { toast({ kind: 'error', text: err.message }); }
  },
  async setNote(slabKey, note) {
    try { take(await api.setCartNote(slabKey, note)); } catch (err) { toast({ kind: 'error', text: err.message }); }
  },

  /** After a hold was created from the cart. */
  held(hold) {
    set({ view: 'cart' });
    toast({ kind: 'held', text: `Hold #${hold.number} created for ${hold.customer?.name || 'the customer'}`, holdId: hold._id }, 8000);
    cartActions.load();
  },

  /** Someone held, released or carted slabs: refresh what shows locks. */
  reservationsChanged(slabKeys = []) {
    set((s) => ({ reservationsTick: s.reservationsTick + 1 }));
    if (state.loaded && (!slabKeys.length || state.cart.lines.some((l) => slabKeys.includes(l.slabKey)))) cartActions.load();
  }
};

export const useCart = () => useSyncExternalStore(subscribe, () => state);

/** Test hook: the current state without React. */
export const cartSnapshot = () => state;
