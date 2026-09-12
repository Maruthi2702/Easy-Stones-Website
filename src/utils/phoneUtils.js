/**
 * Digits of a US number, without the country code.
 *
 * Pasting from Google Maps (or a contact card) hands us "+1 253-380-2431",
 * which naively cleans to 11 digits and shifts the whole number one place
 * right — (125) 338-0243. No US area code starts with 1, so a leading 1 in
 * front of more than ten digits is always the country code, never the number.
 * @param {string} value - The raw phone number string.
 * @returns {string} Only numeric characters, country code dropped.
 */
const nationalDigits = (value) => {
    const cleaned = String(value).replace(/\D/g, '');
    return cleaned.length > 10 && cleaned.startsWith('1') ? cleaned.slice(1) : cleaned;
};

/**
 * Formats a raw phone number string into (XXX) XXX-XXXX format.
 * @param {string} value - The raw phone number string.
 * @returns {string} The formatted phone number.
 */
export const formatPhoneForDisplay = (value) => {
    if (!value) return '';
    const match = nationalDigits(value).match(/^(\d{3})(\d{3})(\d{4})$/);
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
    return nationalDigits(value);
};

/**
 * Formats a phone number as the user types.
 * @param {string} value - The current input value.
 * @returns {string} The auto-formatted value.
 */
export const formatPhoneInput = (value) => {
    if (!value) return '';
    const cleaned = nationalDigits(value);
    const len = cleaned.length;

    if (len === 0) return '';
    if (len <= 3) return cleaned;
    if (len <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
};
