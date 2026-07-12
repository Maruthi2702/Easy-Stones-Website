/**
 * Centralized date formatting utilities to handle local timezone offsets
 * for date and time inputs.
 */

// Helper to treat UTC strings as Local (stripping Z)
const parseAsLocal = (date) => {
    if (!date) return null;
    if (date instanceof Date) return date;
    if (typeof date === 'string') {
        if (date.endsWith('Z')) {
            return new Date(date.slice(0, -1));
        }
        // If it's a plain YYYY-MM-DD date string, parse it using local timezone components
        // to avoid UTC midnight shifting the day backwards in western timezones
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const [year, month, day] = date.split('-').map(Number);
            return new Date(year, month - 1, day);
        }
    }
    return new Date(date);
};

// Returns a date object adjusted to local time but in ISO format (for datetime-local inputs)
export const toLocalISOString = (date) => {
  if (!date) return '';
  const d = parseAsLocal(date);
  if (!d || isNaN(d.getTime())) return '';
  
  const pad = (num) => String(num).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const getLocalISOString = (date) => {
    if (!date) return '';
    const d = parseAsLocal(date);
    if (!d) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

export const formatForDateTimeInput = (date) => {
  return toLocalISOString(date);
};

export const formatForDateInput = (date) => {
  if (!date) return '';
  
  if (typeof date === 'string') {
      if (date.includes('T')) {
          // If it ends in Z, strip it to ensure we don't shift days
          if (date.endsWith('Z')) {
              return formatForDateInput(date.slice(0, -1));
          }
          return date.split('T')[0];
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return date;
      }
  }
  
  const d = parseAsLocal(date);
  if (!d || isNaN(d.getTime())) return '';
  
  // Use local methods
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

export const formatDate = (dateString, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!dateString) return '-';
  try {
    const dateObj = parseAsLocal(dateString);
    if (!dateObj || isNaN(dateObj.getTime())) return '-';

    // Format using local time
    return new Intl.DateTimeFormat('en-US', { ...options }).format(dateObj);
  } catch (e) {
    return '-';
  }
};
