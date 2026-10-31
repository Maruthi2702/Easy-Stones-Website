import type { Loose } from '../../types/records.ts';
/**
 * The one way the permit readers fetch: JSON, a timeout, three tries with a
 * growing pause, and a browser user agent (the county's firewall answers
 * anything else with an HTML error page). Server-only.
 */

export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const TIMEOUT_MS = 30000;
const TRIES = 3;

/**
 * `name` goes in error messages ("Whatcom County answered 503…"); `errorOf`
 * picks the source's own error out of a 200 answer, if it sends one there.
 */
export async function fetchJson(url: string, { fetchImpl, sleep, pauseMs, name, errorOf = () => null, init = {} }: Loose) {
  let lastError;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`${name} answered ${res.status} with something other than JSON`); }
      const problem = errorOf(data);
      if (!res.ok || problem) throw new Error(`${name} answered ${res.status}: ${problem || 'error'}`);
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < TRIES) await sleep(pauseMs * 4 * attempt);
    }
  }
  throw lastError;
}
