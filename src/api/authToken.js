// The staff JWT used to also live in localStorage, purely so a handful of
// call sites (the Socket.IO room-join handshake, a couple of direct fetches,
// the Google Calendar OAuth link) could read it as a plain string outside of
// authFetch. localStorage persists across reloads and tab closes and is
// readable by any script on the page — meaning any XSS anywhere on the site
// could read a live, fully-privileged session for its whole 6h lifetime, and
// the cookie's own `httpOnly` flag (which exists to prevent exactly that)
// bought nothing once the same token was duplicated into JS-readable storage.
//
// Kept in memory instead: gone the moment the tab reloads or closes, so
// there's nothing sitting on disk for a later, unrelated XSS to find. A fresh
// page load has nothing here until AuthContext's checkAuth() repopulates it
// by exchanging the still-valid httpOnly cookie for a token via
// GET /api/auth/token — the cookie itself remains the source of truth for
// every plain fetch (authenticate() on the server checks it first).
let token = null;

export function getAuthToken() {
  return token;
}

export function setAuthToken(value) {
  token = value || null;
}

export function clearAuthToken() {
  token = null;
}
