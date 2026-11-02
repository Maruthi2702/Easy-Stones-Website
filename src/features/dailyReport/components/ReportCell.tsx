import React, { useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import type { Figure } from '../types';

export type ReportCellProps = {
  value: Figure | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  derived?: boolean;
  readOnly?: boolean;
  align?: 'left' | 'right';
  width?: number;
  placeholder?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  type?: 'number' | 'text';
  title?: string;
  ariaLabel?: string;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
};

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
  readOnly = false,       // the system's answer, and only the system's — see .is-readonly
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
}: ReportCellProps) => (
  <input
    type="text"
    inputMode={type === 'number' ? 'decimal' : 'text'}
    /* no-capitalize: index.css title-cases every text input, which would
       turn "Shadow SJ MQ 3CM" into "Shadow Sj Mq 3Cm". */
    className={`dr-cell no-capitalize ${derived ? 'is-derived' : ''} ${readOnly ? 'is-readonly' : ''} ${align === 'left' ? 'is-left' : ''} ${className}`}
    style={width ? { width } : undefined}
    value={value === null || value === undefined ? '' : value}
    disabled={disabled}
    readOnly={readOnly}
    // Out of the Tab order: the keyboard walks the figures someone can type.
    tabIndex={readOnly ? -1 : undefined}
    placeholder={placeholder || (type === 'number' ? '—' : '')}
    title={title}
    aria-label={ariaLabel}
    onChange={(e) => {
      if (readOnly) return;
      const raw = e.target.value;
      if (type === 'number' && raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
      // Clearing a numeric field means "unsaid", not zero.
      onChange(type === 'number' && raw === '' ? null : raw);
    }}
    onKeyDown={onKeyDown}
    onFocus={(e) => { if (!readOnly) e.target.select(); onFocus?.(e); }}
    onBlur={onBlur}
  />
);

/** 1234.5 → "1,234.50" — matches the comma-and-cents style the total row and
 *  the PDF already use (see `money` in summaryFigures.js). Only applied while
 *  the field isn't being typed into, so the raw digits are what a keystroke
 *  ever edits. */
const formatMoney = (v: Figure | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v;
};

/** Money reads better with the symbol outside the box than inside the value. */
// `readOnly` (opt-in): the system's figure (Payments from the Payments page),
// in the read-only cell style; a negative one (a Return) reads "−$2,000.00" in red.
export const MoneyCell = ({ value, onChange, disabled = false, ariaLabel, onKeyDown, readOnly = false }: Pick<ReportCellProps, 'value' | 'onChange' | 'disabled' | 'ariaLabel' | 'onKeyDown' | 'readOnly'>) => {
  const [focused, setFocused] = useState(false);
  const negative = readOnly && Number(value) < 0;
  const plain = negative ? Math.abs(Number(value)) : value;
  const shown = !focused && plain !== null && plain !== undefined && plain !== '' ? formatMoney(plain) : plain;
  return (
    <span className={`dr-money${negative ? ' is-negative' : ''}`}>
      <span className={`dr-money-sign ${value === null || value === undefined ? 'is-unsaid' : ''}`}>{negative ? '−$' : '$'}</span>
      <ReportCell
        value={shown}
        onChange={onChange}
        disabled={disabled}
        readOnly={readOnly}
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
