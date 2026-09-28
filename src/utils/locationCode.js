// Short codes for branch locations (e.g. Seattle → SEA, Spokane → SPK).
// Shared by the server (validation on save) and the admin UI (input
// normalization + display) so both agree on what a valid code is.

export const LOCATION_CODE_PATTERN = /^[A-Z0-9]{2,5}$/;

// Returns { code, error }. An empty/blank input is valid and means "no code"
// (code: ''), since existing locations were created before codes existed.
export const normalizeLocationCode = (raw) => {
    const code = String(raw ?? '').trim().toUpperCase();
    if (!code) return { code: '', error: null };
    if (!LOCATION_CODE_PATTERN.test(code)) {
        return { code, error: 'Short code must be 2–5 letters or numbers (e.g. SEA, SPK, ATL)' };
    }
    return { code, error: null };
};

// "Seattle (SEA)" when a code is set, otherwise just "Seattle".
export const formatLocationLabel = (loc) => {
    if (!loc) return '';
    return loc.shortCode ? `${loc.name} (${loc.shortCode})` : loc.name;
};

// Looks up the short code for a location name (as stored on users,
// check-ins, reports, etc.), falling back to the name itself.
export const locationShortName = (locations, name) => {
    const match = (locations || []).find(l => l.name === name);
    return match?.shortCode || name;
};
