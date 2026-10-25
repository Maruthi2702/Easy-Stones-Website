// Cart & Holds (MIGRATION_NOTES.md §4, step B). What other code imports: the
// cart store (the side rail, the phone tab bar, the inventory checkboxes and
// the live-updates socket share it), slab locks, the hold link and the rail
// button. Two files are imported by path instead, so their stylesheets keep
// their place in the CSS order: the shell lazy-loads HoldsTab.tsx (its own
// chunk) and imports cart/CartDrawer.tsx where it always did — through here
// the drawer's form styles would load with the side rail, earlier than before.
export { useCart, cartActions, cartKeysOf, cartSnapshot } from './cartStore';
export { default as useSlabLocks } from './useSlabLocks';
export { openHoldLink, useHoldLink } from './holdLink';
export { default as CartRailButton } from './cart/CartRailButton';
export type { Cart, CartLine, CartState, SlabLock } from './types';
