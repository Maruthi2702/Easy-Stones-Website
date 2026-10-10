import { useEffect } from 'react';
import { ShoppingCart } from 'lucide-react';
import { useCart, cartActions } from './cartStore';
import { CART, can } from '../../../holds/permissions';
import './CartDrawer.css';

/**
 * The cart on the side rail (above the account button), for everyone with the
 * Use cart permission: its count, and a tap opens the cart drawer.
 */
export default function CartRailButton({ user }) {
  const { cart, loaded, open } = useCart();
  const allowed = can(user, CART.USE);

  useEffect(() => {
    if (allowed && !loaded) cartActions.load();
  }, [allowed, loaded]);

  if (!allowed) return null;
  const count = cart.lines.length;
  return (
    <button
      type="button"
      className={`side-nav-section cd-rail${open ? ' is-viewing' : ''}`}
      onClick={() => (open ? cartActions.close() : cartActions.open())}
      aria-label={`Cart, ${count} slab${count === 1 ? '' : 's'}`}
      title="Cart"
    >
      <span className="side-nav-section-icon"><ShoppingCart size={20} /></span>
      <span className="side-nav-section-label">Cart</span>
      {count > 0 && <span className="cd-rail-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}
