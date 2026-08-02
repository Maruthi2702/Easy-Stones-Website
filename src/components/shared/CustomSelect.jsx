import React, { useState, useRef, useEffect } from 'react';
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
  style = {}
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

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

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
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
        className="custom-select-trigger"
        onClick={() => !disabled && setIsOpen(prev => !prev)}
        disabled={disabled}
      >
        <span className="custom-select-label">
          {selectedOpt ? selectedOpt.label : placeholder}
        </span>
        <ChevronDown size={15} className="custom-select-arrow" />
      </button>

      {isOpen && (
        <div className="custom-select-popover">
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
        </div>
      )}
    </div>
  );
};

export default CustomSelect;
