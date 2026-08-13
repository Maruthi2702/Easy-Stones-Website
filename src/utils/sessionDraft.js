// Short-lived, per-tab scratch space for a form's in-progress state — used to
// survive the forced trip through /login when a session expires mid-edit.
// sessionStorage already clears itself when the tab closes; the TTL here is
// just belt-and-suspenders against a draft resurfacing long after it stopped
// being relevant.

const PREFIX = 'session_draft:';
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

export function saveDraft(key, data) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // storage full or unavailable — the draft is a convenience, not a guarantee
  }
}

export function loadDraft(key, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > maxAgeMs) {
      sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearDraft(key) {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // as above
  }
}
