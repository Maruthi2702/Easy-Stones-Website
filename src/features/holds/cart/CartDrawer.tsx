import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Maximize2, Minimize2, MoreHorizontal, AlertTriangle, Lock, Trash2 } from 'lucide-react';
import CartView from './CartView';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import CheckoutView from './CheckoutView';
import { FormLayerContext } from '../../../components/shared/form/formLayer';
import { useCustomerOptions } from '../../../api/customerOptions';
import { formatSf, holdTotals } from '../../../holds/holdRules';
import { HOLDS, can } from '../../../holds/permissions';
import { useCart, cartActions } from '../cartStore';
import { asLines, usable } from './cartLines';
import { CartToast } from './CartToast';
import type { Id } from '../../../types/api';
import type { CurrentUser } from '../../../types/records';
import '../../../components/shared/form/FormModal.css';
import './CartDrawer.css';

export { CartToast };

export type CartDrawerProps = { user: CurrentUser | null; onOpenHold?: (holdId: Id) => void };

/**
 * The cart (approved design, 2026-10-10): a drawer from the side rail that
 * expands to full width, with the hold checkout inside it. One cart per
 * person, saved on the server (src/holds/router.js); prices are typed at
 * checkout for now. This file is the drawer: its header, which slabs are
 * ticked, and the footer; the cart's list is CartView, the checkout
 * CheckoutView (+ useCheckout).
 */
export default function CartDrawer({ user, onOpenHold }: CartDrawerProps) {
  const { cart, open, expanded, view, loading, error } = useCart();
  const isPhone = useIsPhone();
  const { options: customers, loading: customersLoading } = useCustomerOptions();
  const [menuOpen, setMenuOpen] = useState(false);
  // Template pickers open their phone sheets here, above the drawer's footer (formLayer.js).
  const [layerEl, setLayerEl] = useState<HTMLElement | null>(null);
  const lines = useMemo(() => asLines(cart.lines), [cart.lines]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const seen = useRef<Set<string>>(new Set());

  // New usable lines start ticked; lines that left the cart drop out.
  useEffect(() => {
    // Worked out before the update: the updater runs later, after `seen` moves on.
    const fresh = lines.filter((l) => usable(l) && !seen.current.has(l.slabKey)).map((l) => l.slabKey);
    seen.current = new Set(lines.map((l) => l.slabKey));
    setSelected((s) => {
      const next = new Set([...s].filter((k) => lines.some((l) => l.slabKey === k && usable(l))));
      fresh.forEach((k) => next.add(k));
      return next;
    });
  }, [lines]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) cartActions.close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const chosen = lines.filter((l) => usable(l) && selected.has(l.slabKey));
  const chosenTotals = holdTotals(chosen);
  const canHold = can(user, HOLDS.CREATE);

  return createPortal(
    <div className="cd-layer">
      <div className="cd-scrim" onClick={() => cartActions.close()} aria-hidden="true" />
      <aside ref={setLayerEl} className={`cd fm-tokens${expanded && !isPhone ? ' is-expanded' : ''}`} role="dialog" aria-modal="true" aria-label={view === 'checkout' ? 'Create hold' : 'Cart'}>
        <FormLayerContext.Provider value={layerEl}>
        <header className="cd-head">
          <h2>{view === 'checkout' ? `Hold ${chosen.length} slab${chosen.length === 1 ? '' : 's'}` : 'Cart'}</h2>
          {view === 'cart' && !isPhone && (
            <button type="button" className="cd-icon" onClick={() => cartActions.setExpanded(!expanded)} aria-label={expanded ? 'Back to the drawer' : 'Expand cart to full width'} title={expanded ? 'Back to the drawer' : 'Expand'}>
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          {view === 'cart' && (
            <div className="cd-menu-wrap">
              <button type="button" className="cd-icon" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More">
                <MoreHorizontal size={17} />
              </button>
              {menuOpen && (
                <div className="cd-menu" role="menu">
                  <button type="button" role="menuitem" disabled={!lines.length} onClick={() => { setMenuOpen(false); cartActions.clear(); }}>
                    <Trash2 size={15} aria-hidden="true" />Clear cart
                  </button>
                </div>
              )}
            </div>
          )}
          <button type="button" className="fm-close" onClick={() => cartActions.close()} aria-label="Close cart" title="Close (Esc)">
            <X size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </header>

        {view === 'checkout' ? (
          <CheckoutView
            user={user}
            cart={cart}
            chosen={chosen}
            customers={customers}
            customersLoading={customersLoading}
            onBack={() => cartActions.setView('cart')}
            onDone={(hold) => cartActions.held(hold)}
          />
        ) : (
          <>
            <div className="cd-body">
              {error && <div className="cd-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</div>}
              {loading && !lines.length ? <div className="cd-empty">Loading your cart…</div> : (
                <CartView
                  cart={cart}
                  lines={lines}
                  selected={selected}
                  setSelected={setSelected}
                  expanded={expanded && !isPhone}
                  customers={customers}
                  customersLoading={customersLoading}
                />
              )}
            </div>
            <footer className="cd-foot">
              <CartToast onOpenHold={onOpenHold} placement="drawer" />
              <div className="cd-total">
                <span><b>{chosen.length} of {lines.length} slab{lines.length === 1 ? '' : 's'}</b> · {formatSf(chosenTotals.sfHundredths)}</span>
                <span className="cd-hint">Prices are entered at checkout</span>
              </div>
              {canHold && (
                <div className="cd-foot-actions">
                  <button type="button" className="fm-btn fm-btn-primary cd-grow" disabled={!chosen.length} onClick={() => cartActions.setView('checkout')}>
                    <Lock size={16} aria-hidden="true" />Hold {chosen.length ? `${chosen.length} slab${chosen.length === 1 ? '' : 's'}` : ''}
                  </button>
                </div>
              )}
            </footer>
          </>
        )}
        </FormLayerContext.Provider>
      </aside>
    </div>,
    document.body
  );
}

