import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { ErrorBody } from '../../types/api';
import type { UsageResponse, VoiceWord, VoiceWordInput } from '../../utils/assistantContract';

/**
 * Admin → Voice Assistant's calls to /api/assistant (src/routes/assistant.ts; the contract is src/utils/assistantContract.ts).
 * Each resolves the body or throws a `VoiceWordsError` whose message is fit to show; `status` lets a form tell a duplicate (409).
 */
export class VoiceWordsError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = 'VoiceWordsError'; this.status = status; }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/assistant${path}`, init);
  } catch {
    throw new VoiceWordsError('Couldn’t reach the server. Check your connection and try again.', 0);
  }
  const data: ErrorBody = await res.json().catch(() => ({}));
  if (!res.ok) throw new VoiceWordsError(data.message || data.error || `Something went wrong (${res.status}).`, res.status);
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const loadVoiceWords = async (): Promise<VoiceWord[]> => (await call<{ words: VoiceWord[] }>('/voice-words')).words;
export const addVoiceWord = (input: VoiceWordInput) => call<VoiceWord>('/voice-words', json('POST', input));
export const updateVoiceWord = (id: string, patch: Partial<VoiceWordInput>) => call<VoiceWord>(`/voice-words/${encodeURIComponent(id)}`, json('PATCH', patch));
export const deleteVoiceWord = (id: string) => call<{ ok: true }>(`/voice-words/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const loadUsage = (month: string) => call<UsageResponse>(`/usage?month=${encodeURIComponent(month)}`);
