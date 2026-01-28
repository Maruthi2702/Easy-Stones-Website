/**
 * Centralized date formatting utilities to handle local timezone offsets
 * for date and time inputs.
 */

export const toLocalISOString = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d - offset).toISOString();
};

export const formatForDateTimeInput = (date) => {
  const localISO = toLocalISOString(date);
  return localISO ? localISO.slice(0, 16) : '';
};

export const formatForDateInput = (date) => {
  const localISO = toLocalISOString(date);
  return localISO ? localISO.slice(0, 10) : '';
};
