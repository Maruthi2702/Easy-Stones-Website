import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import './RowMenu.css';

/**
 * A "⋯" button that opens a small menu of a row's actions, so a table row
 * shows one button however many actions it grows.
 *
 * items: [{ key, label, icon: LucideIcon, onClick, danger?, title?, divider? }]
 *   `divider: true` draws a line above that item.
 *
 * The menu is portalled to <body> and positioned from the button, so a table's
 * scrolling wrapper can't clip it. It closes on a pick, Escape, a click
 * outside, or any scroll/resize (it would otherwise float away from its row).
 * Its z-index matches CustomSelect's popover (see CLAUDE.md, shared components).
 */
const MENU_WIDTH = 200;

export default function RowMenu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight || items.length * 40;
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    const below = r.bottom + 4;
    const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, r.top - menuHeight - 4) : below;
    setPos({ top, left });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`row-menu-btn ${open ? 'open' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="row-menu-popover"
          role="menu"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH }}
        >
          {items.map(({ key, label: text, icon: Icon, onClick, danger, title, divider }) => (
            <React.Fragment key={key}>
              {divider && <div className="row-menu-divider" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className={`row-menu-item ${danger ? 'danger' : ''}`}
                title={title}
                onClick={() => { setOpen(false); onClick(); }}
              >
                {Icon && <Icon size={15} />}
                {text}
              </button>
            </React.Fragment>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
