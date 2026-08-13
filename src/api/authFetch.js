// Drop-in replacement for fetch() when calling our own API. Attaches the auth
// header/cookie the same way every call site already does by hand, and —
// because a 401 from our API always means the session is gone, never "this
// one record is forbidden" (that's 403, left alone) — tells the rest of the
// app exactly once, no matter how many requests discover it at the same time.
//
// Deliberately does not change what a caller does with the response: it's
// still returned as-is, ok/status/json and all, so a function that already
// throws on failure still throws and one that already falls back to cache
// (several do, on purpose, for someone working out of signal) still does.

let sessionExpiredNotified = false;

/** Called after a successful login so the next expiry can be noticed again. */
export function resetSessionExpiredGuard() {
  sessionExpiredNotified = false;
}

function notifySessionExpired() {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  try {
    sessionStorage.setItem('auth_session_expired', '1');
  } catch {
    // storage unavailable — the redirect still happens, just without the notice
  }
  window.dispatchEvent(new CustomEvent('auth:session-expired'));
}

export async function authFetch(url, options = {}) {
  const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
  const headers = {
    ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const res = await fetch(url, { ...options, credentials: 'include', headers });

  if (res.status === 401) {
    notifySessionExpired();
  }

  return res;
}
