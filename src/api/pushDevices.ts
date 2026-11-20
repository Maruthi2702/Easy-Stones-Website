import { API_URL } from '../config/api';
import { authFetch } from './authFetch';

/** This phone's push token (set once Apple hands it over); signing out removes it from the server. */
let currentToken = '';

export async function registerPushDevice(token: string): Promise<void> {
  currentToken = token;
  try { await authFetch(`${API_URL}/api/push-devices`, { method: 'POST', body: JSON.stringify({ token }) }); }
  catch (error) { console.error('Push device register:', error); }
}

/** Called before sign-out clears the session. Never throws and never waits long: signing out must not hang on this. */
export async function unregisterPushDevice(): Promise<void> {
  if (!currentToken) return;
  const token = currentToken; currentToken = '';
  try {
    await Promise.race([
      authFetch(`${API_URL}/api/push-devices`, { method: 'DELETE', body: JSON.stringify({ token }) }),
      new Promise(resolve => setTimeout(resolve, 2000))
    ]);
  } catch (error) { console.error('Push device unregister:', error); }
}
