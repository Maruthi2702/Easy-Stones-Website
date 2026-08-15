import React, { useState } from 'react';

/**
 * A single editable figure in the report.
 *
 * Numbers are held as strings while being typed so a field can be genuinely
 * empty — a controlled number input forced to 0 makes you select-and-replace
 * every time you touch it, which is miserable on a form of thirty cells.
 */
export const ReportCell = ({
  value,
  onChange,
  disabled = false,
  derived = false,        // the system's answer; still editable
  align = 'right',
  width,
  placeholder = '',
  onKeyDown,
  className = '',
  type = 'number',
  title,
  ariaLabel,
  onFocus,
  onBlur
}) => (
  <input
    type="text"
    inputMode={type === 'number' ? 'decimal' : 'text'}
    /* no-capitalize: index.css title-cases every text input, which would
       turn "Shadow SJ MQ 3CM" into "Shadow Sj Mq 3Cm". */
    className={`dr-cell no-capitalize ${derived ? 'is-derived' : ''} ${align === 'left' ? 'is-left' : ''} ${className}`}
    style={width ? { width } : undefined}
    value={value === null || value === undefined ? '' : value}
    disabled={disabled}
    placeholder={placeholder || (type === 'number' ? '—' : '')}
    title={title}
    aria-label={ariaLabel}
    onChange={(e) => {
      const raw = e.target.value;
      if (type === 'number' && raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
      // Clearing a numeric field means "unsaid", not zero.
      onChange(type === 'number' && raw === '' ? null : raw);
    }}
    onKeyDown={onKeyDown}
    onFocus={(e) => { e.target.select(); onFocus?.(e); }}
    onBlur={onBlur}
  />
);

/** 1234.5 → "1,234.50" — matches the comma-and-cents style the total row and
 *  the PDF already use (see `money` in summaryFigures.js). Only applied while
 *  the field isn't being typed into, so the raw digits are what a keystroke
 *  ever edits. */
const formatMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v;
};

/** Money reads better with the symbol outside the box than inside the value. */
export const MoneyCell = ({ value, onChange, disabled = false, ariaLabel, onKeyDown }) => {
  const [focused, setFocused] = useState(false);
  const shown = !focused && value !== null && value !== undefined && value !== '' ? formatMoney(value) : value;
  return (
    <span className="dr-money">
      <span className={`dr-money-sign ${value === null || value === undefined ? 'is-unsaid' : ''}`}>$</span>
      <ReportCell
        value={shown}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={ariaLabel}
        onKeyDown={onKeyDown}
        width={100}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </span>
  );
};

export default ReportCell;
