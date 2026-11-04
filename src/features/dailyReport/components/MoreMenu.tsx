import React, { useState, useEffect, useRef } from 'react';
import { MoreHorizontal, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** `dividerBefore` draws a line above the item (View Log, under the exports). */
export type MoreItem = { key: string; icon: LucideIcon; label: string; hint?: string; onSelect: () => void; dividerBefore?: boolean };

/**
 * The report's ways out, behind one button.
 *
 * PDF, email, this branch's CSV and every branch's CSV were four buttons of
 * equal weight in the top bar, which buried the one button anybody presses —
 * Submit day — in a row of five that all looked the same. They are one menu
 * now: the bar carries the choice of report, and this carries what to do with
 * it. Since 2026-11-04 the menu is "More" and also holds View Log (the
 * day's submits, reopens and emails) under a line.
 *
 * items — [{ key, icon, label, hint, onSelect, dividerBefore }]
 */
const MoreMenu = ({ items, label = 'More' }: { items: MoreItem[]; label?: string }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="dr-menu" ref={wrap}>
      <button
        type="button"
        className={`dr-btn dr-btn--menu ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={14} /> {label}
        <ChevronDown size={13} className="dr-menu-caret" />
      </button>

      {open && (
        <div className="dr-menu-pop" role="menu">
          {items.map(item => (
            <React.Fragment key={item.key}>
              {item.dividerBefore && <div className="dr-menu-divider" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className="dr-menu-item"
                onClick={() => { setOpen(false); item.onSelect(); }}
              >
                <item.icon size={15} className="dr-menu-icon" />
                <span className="dr-menu-text">
                  <strong>{item.label}</strong>
                  {item.hint && <em>{item.hint}</em>}
                </span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

export default MoreMenu;
