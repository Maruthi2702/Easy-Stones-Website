/**
 * Formats a raw phone number string into (XXX) XXX-XXXX format.
 * @param {string} value - The raw phone number string.
 * @returns {string} The formatted phone number.
 */
export const formatPhoneForDisplay = (value) => {
    if (!value) return '';
    const cleaned = value.toString().replace(/\D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    if (match) {
        return `(${match[1]}) ${match[2]}-${match[3]}`;
    }
    return value;
};

/**
 * Strips all non-numeric characters from a string.
 * @param {string} value - The input string.
 * @returns {string} Only numeric characters.
 */
export const stripPhone = (value) => {
    if (!value) return '';
    return value.toString().replace(/\D/g, '');
};

/**
 * Formats a phone number as the user types.
 * @param {string} value - The current input value.
 * @returns {string} The auto-formatted value.
 */
export const formatPhoneInput = (value) => {
    if (!value) return '';
    const cleaned = value.replace(/\D/g, '');
    const len = cleaned.length;

    if (len === 0) return '';
    if (len <= 3) return cleaned;
    if (len <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
};
