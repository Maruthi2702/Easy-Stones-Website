/**
 * Centralized date formatting utilities to handle local timezone offsets
 * for date and time inputs.
 */

// Returns a date object adjusted to local time but in ISO format (for datetime-local inputs)
export const toLocalISOString = (date) => {
  if (!date) return '';
  // We treat the date as "Floating Time at UTC"
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const pad = (num) => String(num).padStart(2, '0');
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const formatForDateTimeInput = (date) => {
  return toLocalISOString(date);
};

export const formatForDateInput = (date) => {
  if (!date) return '';
  
  if (typeof date === 'string') {
      // If it looks like an ISO string with time, split it directly to avoid timezone shift
      // This presumes the DB stores "Face Value" dates as UTC Midnight or similar
      if (date.includes('T')) {
          return date.split('T')[0];
      }
      // If it's already YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return date;
      }
  }
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  // Use UTC methods to ensure we get the date as stored/intended if it was created as UTC
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

export const formatDate = (dateString, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!dateString) return '-';
  try {
    // Generic handling: try to ensure we parse as local time
    // If it's YYYY-MM-DD, standard Date parsing treats it as UTC. 
    // We want to treat EVERYTHING as UTC face value.
    if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
       // It's already UTC midnight effectively
    }
    
    // Create date object
    const dateObj = new Date(dateString);
    if (isNaN(dateObj.getTime())) return '-';

    // Format using UTC to preserve "Face Value"
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(dateObj);
  } catch (e) {
    return '-';
  }
};
