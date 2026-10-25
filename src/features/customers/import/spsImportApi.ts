/**
 * The SPS import's calls (src/routes/customerSpsImport.js), via authFetch. A
 * refused call throws an Error worded from the server's answer, with the
 * HTTP status, and the parsed answer on `body` when it was JSON.
 */
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import type { Loose } from '../../../types/records';

export const API = `${API_URL}/api/customers/sps-import/runs`;

/** An Error with the server's JSON answer on it (`body`), when there was one. */
export type CallError = Error & { body?: Loose };

const failure = async (res: Response): Promise<CallError> => {
    const text = await res.text();
    let said = '';
    try { const j = JSON.parse(text); said = j.message || j.error || ''; } catch { /* not JSON */ }
    const err: CallError = new Error(`${said || text.slice(0, 200) || res.statusText} (HTTP ${res.status})`);
    try { err.body = JSON.parse(text); } catch { /* not JSON */ }
    return err;
};

export const call = async (url: string, options?: RequestInit) => {
    const res = await authFetch(url, options);
    if (!res.ok) throw await failure(res);
    return res;
};

export const jsonCall = async (url: string, body?: unknown, method = 'POST') =>
    (await call(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json();

/** Downloads what `url` answers as `filename`. */
export const saveBlob = async (url: string, filename: string) => {
    const blob = await (await call(url)).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
