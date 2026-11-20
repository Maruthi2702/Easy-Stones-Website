import { API_URL } from '../config/api';

/**
 * One sign-in screen for staff and suppliers (2026-11-19, the iOS app has one
 * login). Staff are tried first; only when the staff sign-in says "invalid
 * credentials" is the supplier portal asked, with the same text as an email.
 * The two sessions stay separate: this only sets the portal's own cookie
 * (scoped to /api/supplier-portal), never a staff session, so no staff route
 * accepts it (src/services/supplierSession.ts).
 *
 *   'ok'       the supplier is signed in — go to /supplier
 *   'nomatch'  no supplier login with that email and password
 *   a string   the supplier's own reason (locked, turned off) — show it
 */
export async function trySupplierSignIn(identifier: string, password: string): Promise<'ok' | 'nomatch' | string> {
  const email = identifier.trim().toLowerCase();
  // A supplier's login is an email; anything else can't be one.
  if (!email.includes('@')) return 'nomatch';
  try {
    const response = await fetch(`${API_URL}/api/supplier-portal/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    if (response.ok) return 'ok';
    const data = await response.json().catch(() => ({}));
    if (response.status === 423 || response.status === 403) return String(data?.message || 'This login is turned off.');
    return 'nomatch';
  } catch {
    return 'nomatch';
  }
}
