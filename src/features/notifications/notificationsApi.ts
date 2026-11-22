import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { ErrorBody } from '../../types/api';

/** Send Notification's calls to /api/push-send (src/routes/pushSend.ts). Each resolves the body or throws an Error to show as is. */
export type Person = { id: string; name: string; role: string; branch: string; phones: number };
export type SendResult = { asked: number; reached: number; noPhone: string[]; failed: number; line: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/push-send${path}`, init);
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  const data: ErrorBody = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Something went wrong (${res.status}).`);
  return data as T;
}

export const loadPeople = () => call<{ configured: boolean; people: Person[] }>('/people');
export const sendNotification = (userIds: string[], message: string) =>
  call<SendResult>('', { method: 'POST', body: JSON.stringify({ userIds, message }) });
