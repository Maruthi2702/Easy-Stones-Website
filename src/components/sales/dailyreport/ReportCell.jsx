import React from 'react';

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
  ariaLabel
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
    onFocus={(e) => e.target.select()}
  />
);

/** Money reads better with the symbol outside the box than inside the value. */
export const MoneyCell = ({ value, onChange, disabled = false, ariaLabel, onKeyDown }) => (
  <span className="dr-money">
    <span className={`dr-money-sign ${value === null || value === undefined ? 'is-unsaid' : ''}`}>$</span>
    <ReportCell
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel}
      onKeyDown={onKeyDown}
      width={92}
    />
  </span>
);

export default ReportCell;
