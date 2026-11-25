import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';

type Props = { title: string; onClose: () => void; children: ReactNode };

/**
 * A phone's bottom drawer (claude.ai artifact "Add receipt on a phone", "A as a drawer"):
 * the page stays visible, dimmed, above it; a tap there, Esc, ✕ or dragging the handle down
 * closes it. Follows CLAUDE.md's phone rules: pinned to the screen (never sized from
 * `visualViewport`), the page locked, the whole screen covered behind it, and a drag outside
 * the drawer's own scrolling body moves nothing. Colours are the form template's `--fm-*`
 * tokens (`.fm-tokens`), so light and dark follow the app.
 */
export default function BottomDrawer({ title, onClose, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    lockPage();
    sheet.current?.focus({ preventScroll: true });
    return unlockPage;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A finger outside the drawer's body (the scrim, the handle) must not scroll the page behind.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      const body = (e.target as HTMLElement | null)?.closest?.('.ccr-drawer-body') as HTMLElement | null;
      if (body && body.scrollHeight > body.clientHeight) return;
      e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { y: e.clientY, t: e.timeStamp };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y));
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    const dist = Math.max(0, e.clientY - d.y);
    const speed = dist / Math.max(1, e.timeStamp - d.t);
    if (dist > 90 || (dist > 30 && speed > 0.6)) onClose();
    else setDy(0);
  };

  return createPortal(
    <div ref={root} className="ccr-drawer-root fm-tokens">
      <div className="ccr-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheet}
        className={`ccr-drawer${dragging ? ' is-dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div className="ccr-drawer-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <span className="ccr-drawer-handle" />
        </div>
        <div className="ccr-drawer-head">
          <h2>{title}</h2>
          <button type="button" className="ccr-drawer-x" aria-label="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="ccr-drawer-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
