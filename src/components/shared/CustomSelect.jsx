import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import './CustomSelect.css';

/**
 * Reusable CustomSelect component matching the Easy Stones dark/gold design system.
 * Replaces native browser <select> elements to avoid native macOS/Windows blue menus.
 */
const CustomSelect = ({
  value,
  onChange,
  options = [],
  placeholder = 'Select option...',
  className = '',
  disabled = false,
  style = {},
  // Swaps the default select-box button's class and content for a custom
  // trigger (an icon button, say) while this component still owns the
  // button element itself, and so its onClick — a render prop handing the
  // toggle function out to caller code reads as "may call this during
  // render" to the stricter hooks lint, even though it never does.
  triggerClassName,
  triggerContent,
  triggerTitle,
  triggerAriaLabel,
  // A small trigger (an icon button) shouldn't force the menu down to its own
  // width, and a trigger near a container's right edge needs the menu to hang
  // off its right side rather than its left or the menu runs off screen.
  menuWidth,
  menuAlign = 'left'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const containerRef = useRef(null);
  const popoverRef = useRef(null);

  // Normalize options array to [{ value, label, disabled }]
  const normalizedOptions = options.map(opt => {
    if (typeof opt === 'object' && opt !== null) {
      return {
        value: opt.value,
        label: opt.label !== undefined ? opt.label : opt.value,
        disabled: Boolean(opt.disabled),
        icon: opt.icon
      };
    }
    return { value: opt, label: String(opt), disabled: false };
  });

  const selectedOpt = normalizedOptions.find(o => String(o.value) === String(value));

  // The popover is portaled to <body> (see below), so it must be positioned
  // from the trigger's real screen coordinates rather than CSS position, and
  // repositioned on the trigger's own terms — a scrolling ancestor (a sidebar,
  // a modal body) clips an absolutely-positioned popover to its own box no
  // matter the z-index, which is what left the option list ending after the
  // first row with no way to reach the rest of it.
  const updateCoords = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const MENU_MAX = 220; // matches .custom-select-options max-height
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < MENU_MAX + 8 && rect.top > spaceBelow;
    const width = menuWidth || rect.width;
    const left = menuAlign === 'right' ? rect.right - width : rect.left;
    setCoords({
      // Clamped so a right-aligned menu off a trigger near the edge of a
      // narrow phone screen can't still run past the other edge.
      left: Math.min(Math.max(8, left), window.innerWidth - width - 8),
      width,
      top: openUpward ? null : rect.bottom + 4,
      bottom: openUpward ? window.innerHeight - rect.top + 4 : null
    });
  }, [menuWidth, menuAlign]);

  // Measured from the event handler that opens the menu, not from an effect
  // — an effect that measures and calls setState on mount cascades an extra
  // render on every open. Doing it here means coords is already correct in
  // the very first render where isOpen is true, so there is no flash. This
  // effect only keeps the trigger tracked as the page moves under it (a
  // scroll or a resize), which react-hooks correctly treats as an ordinary
  // subscription to an external system rather than the same anti-pattern.
  useEffect(() => {
    if (!isOpen) return;
    const onReposition = () => updateCoords();
    // capture:true — scroll events don't bubble, so this is the only way to
    // hear a scroll on some ancestor container rather than the window itself.
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [isOpen, updateCoords]);

  const toggleOpen = () => {
    if (disabled) return;
    if (!isOpen) updateCoords();
    setIsOpen(v => !v);
  };

  // Close dropdown on click outside — the popover no longer lives inside
  // containerRef in the real DOM once portaled, so it needs its own check.
  useEffect(() => {
    const handleClickOutside = (e) => {
      const inTrigger = containerRef.current?.contains(e.target);
      const inPopover = popoverRef.current?.contains(e.target);
      if (!inTrigger && !inPopover) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (optValue, isDisabled) => {
    if (isDisabled || disabled) return;
    if (onChange) {
      onChange({ target: { value: optValue } });
    }
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${isOpen ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
      style={style}
    >
      <button
        type="button"
        className={triggerClassName || 'custom-select-trigger'}
        onClick={toggleOpen}
        disabled={disabled}
        title={triggerTitle}
        aria-label={triggerAriaLabel}
        aria-expanded={triggerClassName ? isOpen : undefined}
      >
        {triggerContent || (
          <>
            <span className="custom-select-label">
              {selectedOpt ? selectedOpt.label : placeholder}
            </span>
            <ChevronDown size={15} className="custom-select-arrow" />
          </>
        )}
      </button>

      {isOpen && coords && createPortal(
        <div
          ref={popoverRef}
          className="custom-select-popover"
          style={{
            position: 'fixed',
            left: coords.left,
            width: coords.width,
            top: coords.top ?? 'auto',
            bottom: coords.bottom ?? 'auto'
          }}
        >
          <div className="custom-select-options">
            {normalizedOptions.map((opt, idx) => {
              const isSelected = String(opt.value) === String(value);
              return (
                <div
                  key={idx}
                  className={`custom-select-option ${isSelected ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}`}
                  onClick={() => handleSelect(opt.value, opt.disabled)}
                >
                  <span className="option-text">{opt.label}</span>
                  {isSelected && <Check size={14} className="option-check" />}
                </div>
              );
            })}
            {normalizedOptions.length === 0 && (
              <div className="custom-select-empty">No options available</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default CustomSelect;
