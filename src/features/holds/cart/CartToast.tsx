import { Check, AlertTriangle, X } from 'lucide-react';
import { useCart, cartActions } from '../cartStore';
import type { Id } from '../../../types/api';

/**
 * "Added · Open cart", "Removed · Undo", "Hold #12 created · Open hold".
 * One on the page (placement "page", shown while the drawer is closed) and
 * one in the drawer's footer (placement "drawer", shown while it's open).
 */
export function CartToast({ onOpenHold, placement = 'page' }: { onOpenHold?: (holdId: Id) => void; placement?: 'page' | 'drawer' }) {
  const { toast, open } = useCart();
  if (!toast || (placement === 'page') === open) return null;
  return (
    <div className={`cd-toast${open ? ' in-drawer' : ''}${toast.kind === 'error' ? ' is-error' : ''}`} role="status">
      {toast.kind === 'added' && <Check size={17} aria-hidden="true" className="cd-toast-ok" />}
      {toast.kind === 'error' && <AlertTriangle size={17} aria-hidden="true" />}
      <span className="cd-toast-text">{toast.text}</span>
      {toast.undo && <button type="button" className="cd-toast-btn gold" onClick={() => cartActions.undo(toast.undo as string[])}>Undo</button>}
      {toast.kind === 'added' && !open && <button type="button" className="cd-toast-btn gold" onClick={() => { cartActions.dismissToast(); cartActions.open(); }}>Open cart</button>}
      {toast.kind === 'held' && onOpenHold && <button type="button" className="cd-toast-btn gold" onClick={() => { cartActions.dismissToast(); cartActions.close(); onOpenHold(toast.holdId as Id); }}>Open hold</button>}
      <button type="button" className="cd-toast-x" onClick={() => cartActions.dismissToast()} aria-label="Dismiss"><X size={15} aria-hidden="true" /></button>
    </div>
  );
}
