import React, { useState, useEffect, useRef } from 'react';
import { Download, ChevronDown } from 'lucide-react';

/**
 * The report's ways out, behind one button.
 *
 * PDF, email, this branch's CSV and every branch's CSV were four buttons of
 * equal weight in the top bar, which buried the one button anybody presses —
 * Submit day — in a row of five that all looked the same. They are one menu
 * now: the bar carries the choice of report, and this carries what to do with
 * it.
 *
 * items — [{ key, icon, label, hint, onSelect }]
 */
const ExportMenu = ({ items, label = 'Export' }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
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
        <Download size={14} /> {label}
        <ChevronDown size={13} className="dr-menu-caret" />
      </button>

      {open && (
        <div className="dr-menu-pop" role="menu">
          {items.map(item => (
            <button
              key={item.key}
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
          ))}
        </div>
      )}
    </div>
  );
};

export default ExportMenu;
