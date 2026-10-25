import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * A side panel (charge, invoice, payment, carriers) over the page, with a
 * scrim. Esc and the scrim close it — unless a form (FormModal) is open on
 * top, which handles Esc itself.
 */
export function Drawer({ label, kicker, onClose, children, footer, wide = false }: {
  label: string; kicker: ReactNode; onClose: () => void; children?: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.fm-overlay, .fm-confirm')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { panelRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <>
      <div className="fr-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} tabIndex={-1} className={`fr-drawer${wide ? ' wide' : ''}`} aria-label={label}>
        <div className="fr-drawer-top">
          <span className="fr-grow">{kicker}</span>
          <button type="button" className="fr-close" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        <div className="fr-drawer-body">{children}</div>
        {footer ? <div className="fr-drawer-foot">{footer}</div> : null}
      </aside>
    </>
  );
}
