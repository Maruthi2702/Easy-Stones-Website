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
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  // Use UTC date directly to avoid timezone shift for pure dates (YYYY-MM-DD)
  return d.toISOString().split('T')[0];
};

export const formatDate = (dateString, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-US', options).format(date);
  } catch (e) {
    return '-';
  }
};
