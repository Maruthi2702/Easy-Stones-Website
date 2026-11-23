import { SERVER_URL } from '../config';

/**
 * Talks to the same endpoint as the website's /login page (`POST /api/customer/login`, which also answers staff), like the
 * iPhone app's SignInService.swift. The cookies the server sets land in the platform's shared cookie store, which the web view
 * reads (iOS: `sharedCookiesEnabled`; Android: one CookieManager), so the site opens already signed in.
 */
export type SignInResult =
  | { kind: 'signedIn' }
  /** A temporary password: the server gave only a setup session; the site opens on "Choose your password". */
  | { kind: 'needsPasswordSetup' }
  | { kind: 'refused'; message: string; wrongPassword: boolean }
  | { kind: 'offline' };

const WRONG_DETAILS = 'That didn’t match an account. Check both fields and try again.';

/** True when the saved cookies still sign someone in. */
export async function hasValidSession(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/api/user/me`, { credentials: 'include' });
    return res.status === 200;
  } catch { return false; }
}

export async function signIn(identifier: string, password: string): Promise<SignInResult> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/customer/login`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ email: identifier, password })
    });
  } catch { return { kind: 'offline' }; }
  const body = await res.json().catch(() => ({} as { setup?: boolean; message?: string }));
  if (res.ok) return { kind: 'signedIn' };
  if (body.setup === true) return { kind: 'needsPasswordSetup' };
  return { kind: 'refused', message: body.message || WRONG_DETAILS, wrongPassword: res.status === 401 };
}
